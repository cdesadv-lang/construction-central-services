import type { Tx } from "@/lib/db";
import { D, r2, sum } from "@/lib/money";
import { calcPayrollLine } from "@/lib/extracts";
import { unprocessable } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { EGYPT_2026_RULES, PayrollRulesError, toPayrollRules, validatePayrollRules, type PayrollRules } from "@/lib/payroll-rules";
import { assertCompany, requirePerm, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { z } from "zod";

export const STATUTORY_SOURCE_NOTE = "Law 148/2019 + NOSI 2026 limits; Income Tax Law 91/2005 as amended by Law 7/2024";

/** Statutory defaults for a new company. */
export async function createDefaultPayrollSettings(tx: Tx, companyId: string) {
  const { brackets, highIncomeSchedules, ...r } = EGYPT_2026_RULES;
  return tx.payrollSettings.upsert({
    where: { companyId },
    create: { companyId, ...r, brackets: brackets as object[], highIncomeSchedules: highIncomeSchedules as object[], sourceNote: STATUTORY_SOURCE_NOTE },
    update: {},
  });
}

/** Effective payroll rules for a company (statutory defaults when not configured). */
export async function getPayrollRules(tx: Tx, companyId: string): Promise<PayrollRules> {
  const row = await tx.payrollSettings.findUnique({ where: { companyId } });
  return toPayrollRules(row as unknown as Record<string, unknown> | null);
}

const bracket = z.object({ upTo: z.union([z.coerce.number().positive(), z.null()]).optional().transform((v) => v ?? null), rate: z.coerce.number().min(0).max(100) });
export const payrollSettingsSchema = z.object({
  employeeInsPct: z.coerce.number().min(0).max(100),
  companyInsPct: z.coerce.number().min(0).max(100),
  insMinWage: z.coerce.number().min(0),
  insMaxWage: z.coerce.number().min(0),
  personalExemption: z.coerce.number().min(0),
  overtimeMultiplier: z.coerce.number().min(1).max(10),
  hoursPerMonth: z.coerce.number().int().min(1).max(744),
  daysPerMonth: z.coerce.number().int().min(1).max(31),
  deductionsReduceTaxable: z.boolean().default(true),
  brackets: z.array(bracket).min(1).max(30),
  highIncomeSchedules: z.array(z.object({ minIncome: z.coerce.number().min(0), maxIncome: z.union([z.coerce.number().positive(), z.null()]).optional().transform((v) => v ?? null), brackets: z.array(bracket).min(1).max(30) })).max(20),
  effectiveFrom: z.coerce.date().optional(),
  sourceNote: z.string().max(500).optional().nullable(),
});

export async function readPayrollSettings(ctx: Ctx, companyId: string) {
  requirePerm(ctx, "payroll", "view");
  assertCompany(ctx, companyId);
  const row = await prisma.payrollSettings.findUnique({ where: { companyId } });
  return { configured: !!row, rules: toPayrollRules(row as unknown as Record<string, unknown> | null), effectiveFrom: row?.effectiveFrom ?? null, sourceNote: row?.sourceNote ?? null, updatedAt: row?.updatedAt ?? null, defaults: EGYPT_2026_RULES };
}

/** Update payroll rules (payroll:approve). Validated and audit-logged. */
export async function savePayrollSettings(ctx: Ctx, companyId: string, body: unknown) {
  requirePerm(ctx, "payroll", "approve");
  assertCompany(ctx, companyId);
  const d = payrollSettingsSchema.parse(body);
  const { effectiveFrom, sourceNote, ...rules } = d;
  try {
    validatePayrollRules(rules as PayrollRules);
  } catch (e) {
    if (e instanceof PayrollRulesError) throw unprocessable(e.message);
    throw e;
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.payrollSettings.findUnique({ where: { companyId } });
    const data = { ...rules, brackets: rules.brackets as object[], highIncomeSchedules: rules.highIncomeSchedules as object[], sourceNote: sourceNote ?? null, updatedById: ctx.user.id, ...(effectiveFrom ? { effectiveFrom } : {}) };
    const row = await tx.payrollSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
    await audit(tx, ctx, { action: "UPDATE", entity: "PayrollSettings", entityId: row.id, companyId, before, after: row });
    return { configured: true, rules: toPayrollRules(row as unknown as Record<string, unknown>), effectiveFrom: row.effectiveFrom, sourceNote: row.sourceNote, updatedAt: row.updatedAt, defaults: EGYPT_2026_RULES };
  });
}

/**
 * Builds payroll lines for the month. A payroll is run per salary currency: only employees paid in `fx.currency`
 * are included; amounts are in that currency, while social insurance and salary tax are computed on the EGP
 * equivalent at `fx.rate` (the statutory limits and brackets are in EGP) and converted back.
 */
export async function buildPayrollLines(tx: Tx, companyId: string, month: string, projectId?: string | null, excludePayrollId?: string, fx: { currency?: string; rate?: unknown } = {}) {
  const currency = fx.currency ?? "EGP";
  const rate = currency === "EGP" ? D(1) : D(fx.rate as never);
  if (!rate.greaterThan(0)) throw unprocessable(`Exchange rate for ${currency} must be greater than zero`);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const already = await tx.payrollLine.findMany({
    where: { payroll: { companyId, month, status: { not: "CANCELLED" }, ...(excludePayrollId ? { id: { not: excludePayrollId } } : {}) } },
    select: { employeeId: true },
  });
  const done = new Set(already.map((a) => a.employeeId));
  const employees = await tx.employee.findMany({
    where: { companyId, status: { in: ["ACTIVE", "ON_LEAVE"] }, salaryCurrency: currency, ...(projectId ? { projectId } : {}) },
    include: { allocations: true, adjustments: { where: { month } }, attendance: { where: { date: { gte: from, lte: to } } } },
    orderBy: { code: "asc" },
  });
  const rules = await getPayrollRules(tx, companyId);
  const lines = [];
  for (const e of employees) {
    if (done.has(e.id)) continue;
    const adj = (t: string) => sum(e.adjustments.filter((a) => a.type === t).map((a) => a.amount));
    const hourly = D(e.basicSalary).div(rules.hoursPerMonth);
    const otHours = sum(e.attendance.map((a) => a.overtimeHours));
    const absentDays = e.attendance.filter((a) => a.status === "ABSENT").length;
    const overtime = r2(adj("OVERTIME").plus(otHours.mul(hourly).mul(rules.overtimeMultiplier)));
    const deductions = r2(adj("DEDUCTION").plus(D(e.basicSalary).div(rules.daysPerMonth).mul(absentDays)));
    const egp = (v: unknown) => r2(D(v as never).mul(rate));
    const back = (v: unknown) => (currency === "EGP" ? r2(D(v as never)) : r2(D(v as never).div(rate)));
    const ce = calcPayrollLine({
      basic: egp(e.basicSalary),
      allowances: egp(e.allowances),
      overtime: egp(overtime),
      bonuses: egp(adj("BONUS")),
      deductions: egp(deductions),
      insuranceSalary: egp(e.insuranceSalary),
    }, rules);
    // amounts in the payroll currency; gross/deductions stay exact, statutory items are converted back from EGP
    const gross = r2(D(e.basicSalary).plus(D(e.allowances)).plus(overtime).plus(adj("BONUS")));
    const c = { ...ce, gross, deductions: r2(deductions), insurance: back(ce.insurance), companyInsurance: back(ce.companyInsurance), tax: back(ce.tax) };
    c.net = r2(c.gross.minus(c.deductions).minus(c.insurance).minus(c.tax));
    const allocations = e.allocations.length
      ? e.allocations.map((a) => ({ projectId: a.projectId, percent: Number(a.percent) }))
      : [{ projectId: e.projectId ?? null, percent: 100 }];
    lines.push({
      employeeId: e.id,
      employeeName: e.name,
      basic: r2(e.basicSalary),
      allowances: r2(e.allowances),
      overtime,
      bonuses: r2(adj("BONUS")),
      deductions: c.deductions,
      insurance: c.insurance,
      companyInsurance: c.companyInsurance,
      tax: c.tax,
      gross: c.gross,
      net: c.net,
      allocations,
    });
  }
  if (!lines.length) throw unprocessable("No eligible employees for this payroll (none found or already included in another payroll this month)");
  const totalGross = sum(lines.map((l) => l.gross));
  const totalNet = sum(lines.map((l) => l.net));
  return { lines, totalGross, totalNet, totalDeductions: totalGross.minus(totalNet) };
}
