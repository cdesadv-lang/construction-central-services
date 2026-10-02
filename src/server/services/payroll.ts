import type { Tx } from "@/lib/db";
import { D, r2, sum } from "@/lib/money";
import { calcPayrollLine } from "@/lib/extracts";
import { unprocessable } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { EGYPT_2026_RULES, PayrollRulesError, toPayrollRules, validatePayrollRules, type PayrollRules } from "@/lib/payroll-rules";
import { assertCompany, requirePerm, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { z } from "zod";

export const STATUTORY_SOURCE_NOTE = "Law 148/2019 + NOSI 2026 limits (2,700/16,700); Income Tax Law 91/2005 as amended by Law 7/2024; Martyrs' Fund: Law 16/2018 art. 8 (Law 4/2021); UHI: Law 2/2018 art. 40";
export const STATUTORY_SOURCE_NOTE_2025 = "Law 148/2019 + NOSI 2025 limits (2,300/14,500); Income Tax Law 91/2005 as amended by Law 7/2024; Martyrs' Fund: Law 16/2018 art. 8 (Law 4/2021); UHI: Law 2/2018 art. 40";
const utcDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function rulesData(rules: PayrollRules) {
  const { brackets, highIncomeSchedules, ...r } = rules;
  return { ...r, brackets: brackets as object[], highIncomeSchedules: highIncomeSchedules as object[] };
}

/** Statutory defaults for a new company: the 2026 version (effective 1 Jan 2026). */
export async function createDefaultPayrollSettings(tx: Tx, companyId: string, version: { effectiveFrom?: string; rules?: PayrollRules; sourceNote?: string } = {}) {
  const effectiveFrom = utcDate(version.effectiveFrom ?? "2026-01-01");
  return tx.payrollSettings.upsert({
    where: { companyId_effectiveFrom: { companyId, effectiveFrom } },
    create: { companyId, effectiveFrom, ...rulesData(version.rules ?? EGYPT_2026_RULES), sourceNote: version.sourceNote ?? STATUTORY_SOURCE_NOTE },
    update: {},
  });
}

/** The rules version in force on `date` (latest effectiveFrom <= date; the earliest version if none yet). */
export async function payrollRulesVersion(tx: Tx, companyId: string, date: Date) {
  return (
    (await tx.payrollSettings.findFirst({ where: { companyId, effectiveFrom: { lte: date } }, orderBy: { effectiveFrom: "desc" } })) ??
    (await tx.payrollSettings.findFirst({ where: { companyId }, orderBy: { effectiveFrom: "asc" } }))
  );
}

/** Effective payroll rules for a company on a date (statutory defaults when not configured). */
export async function getPayrollRules(tx: Tx, companyId: string, date: Date = new Date()): Promise<PayrollRules> {
  const row = await payrollRulesVersion(tx, companyId, date);
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
  martyrsFundPct: z.coerce.number().min(0).max(100).default(EGYPT_2026_RULES.martyrsFundPct),
  uhiEnabled: z.boolean().default(false),
  uhiEmployeePct: z.coerce.number().min(0).max(100).default(EGYPT_2026_RULES.uhiEmployeePct),
  uhiEmployerPct: z.coerce.number().min(0).max(100).default(EGYPT_2026_RULES.uhiEmployerPct),
  uhiEmployerMin: z.coerce.number().min(0).default(EGYPT_2026_RULES.uhiEmployerMin),
  brackets: z.array(bracket).min(1).max(30),
  highIncomeSchedules: z.array(z.object({ minIncome: z.coerce.number().min(0), maxIncome: z.union([z.coerce.number().positive(), z.null()]).optional().transform((v) => v ?? null), brackets: z.array(bracket).min(1).max(30) })).max(20),
  /** YYYY-MM-DD; omitted = update the version in force today */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD").optional(),
  sourceNote: z.string().max(500).optional().nullable(),
});

const versionOut = (row: Record<string, any>) => ({ id: row.id, effectiveFrom: iso(row.effectiveFrom), sourceNote: row.sourceNote ?? null, updatedAt: row.updatedAt, rules: toPayrollRules(row) }); // eslint-disable-line @typescript-eslint/no-explicit-any

/** All versions plus the one effective on `date` (default today). */
export async function readPayrollSettings(ctx: Ctx, companyId: string, date?: string | null) {
  requirePerm(ctx, "payroll", "view");
  assertCompany(ctx, companyId);
  const on = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? utcDate(date) : new Date();
  const versions = await prisma.payrollSettings.findMany({ where: { companyId }, orderBy: { effectiveFrom: "asc" } });
  const eff = await payrollRulesVersion(prisma, companyId, on);
  return {
    configured: versions.length > 0,
    date: iso(on),
    rules: toPayrollRules(eff as unknown as Record<string, unknown> | null),
    effectiveId: eff?.id ?? null,
    effectiveFrom: eff ? iso(eff.effectiveFrom) : null,
    sourceNote: eff?.sourceNote ?? null,
    updatedAt: eff?.updatedAt ?? null,
    versions: versions.map(versionOut),
    defaults: EGYPT_2026_RULES,
  };
}

/** Create/update a rules version (payroll:approve), keyed by effective date. Validated and audit-logged. */
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
  await prisma.$transaction(async (tx) => {
    const current = effectiveFrom ? null : await payrollRulesVersion(tx, companyId, new Date());
    const eff = effectiveFrom ? utcDate(effectiveFrom) : (current?.effectiveFrom ?? utcDate(`${new Date().getUTCFullYear()}-01-01`));
    const before = await tx.payrollSettings.findUnique({ where: { companyId_effectiveFrom: { companyId, effectiveFrom: eff } } });
    const data = { ...rulesData(rules as PayrollRules), sourceNote: sourceNote === undefined ? (before?.sourceNote ?? null) : sourceNote, updatedById: ctx.user.id };
    const row = await tx.payrollSettings.upsert({ where: { companyId_effectiveFrom: { companyId, effectiveFrom: eff } }, create: { companyId, effectiveFrom: eff, ...data }, update: data });
    await audit(tx, ctx, { action: before ? "UPDATE" : "CREATE", entity: "PayrollSettings", entityId: row.id, companyId, before, after: row });
  });
  return readPayrollSettings(ctx, companyId, effectiveFrom ?? null);
}

/** Delete a rules version (payroll:approve); the last remaining version cannot be deleted. */
export async function deletePayrollSettingsVersion(ctx: Ctx, companyId: string, id: string) {
  requirePerm(ctx, "payroll", "approve");
  assertCompany(ctx, companyId);
  await prisma.$transaction(async (tx) => {
    const row = await tx.payrollSettings.findFirst({ where: { id, companyId } });
    if (!row) throw unprocessable("Rules version not found");
    if ((await tx.payrollSettings.count({ where: { companyId } })) <= 1) throw unprocessable("The only rules version cannot be deleted");
    await tx.payroll.updateMany({ where: { rulesId: id }, data: { rulesId: null } });
    await tx.payrollSettings.delete({ where: { id } });
    await audit(tx, ctx, { action: "DELETE", entity: "PayrollSettings", entityId: id, companyId, before: row });
  });
  return readPayrollSettings(ctx, companyId);
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
  // the rules version in force on the first day of the payroll month
  const version = await payrollRulesVersion(tx, companyId, from);
  const rules = toPayrollRules(version as unknown as Record<string, unknown> | null);
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
    const c = {
      ...ce, gross, deductions: r2(deductions), insurance: back(ce.insurance), companyInsurance: back(ce.companyInsurance), tax: back(ce.tax),
      healthInsurance: back(ce.healthInsurance), companyHealthInsurance: back(ce.companyHealthInsurance), martyrsFund: back(ce.martyrsFund),
    };
    c.net = r2(c.gross.minus(c.deductions).minus(c.insurance).minus(c.healthInsurance).minus(c.martyrsFund).minus(c.tax));
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
      healthInsurance: c.healthInsurance,
      companyHealthInsurance: c.companyHealthInsurance,
      martyrsFund: c.martyrsFund,
      tax: c.tax,
      gross: c.gross,
      net: c.net,
      allocations,
    });
  }
  if (!lines.length) throw unprocessable("No eligible employees for this payroll (none found or already included in another payroll this month)");
  const totalGross = sum(lines.map((l) => l.gross));
  const totalNet = sum(lines.map((l) => l.net));
  return { lines, totalGross, totalNet, totalDeductions: totalGross.minus(totalNet), rulesId: version?.id ?? null };
}
