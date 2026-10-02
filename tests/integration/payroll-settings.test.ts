/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { calcPayrollLine } from "@/lib/extracts";
import { EGYPT_2026_RULES } from "@/lib/payroll-rules";
import { readPayrollSettings, savePayrollSettings } from "@/server/services/payroll";
import { accountIdByKey } from "@/server/services/accounting";
import { deletePayrollSettingsVersion } from "@/server/services/payroll";
import { company, create, ctxFor, expectApiError, submitApprovePost } from "../helpers";

let hr: Ctx, cfo: Ctx, companyId: string;
const createdPayrolls: string[] = [];

beforeAll(async () => {
  hr = await ctxFor("hr@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  companyId = (await company("UNITED")).id;
});

afterAll(async () => {
  await prisma.payrollLine.deleteMany({ where: { payrollId: { in: createdPayrolls } } });
  await prisma.approvalRequest.deleteMany({ where: { docId: { in: createdPayrolls } } });
  await prisma.payroll.deleteMany({ where: { id: { in: createdPayrolls } } });
  await savePayrollSettings(cfo, companyId, EGYPT_2026_RULES);
});

describe("payroll settings", () => {
  it("every seeded company has the statutory defaults", async () => {
    const s = await readPayrollSettings(hr, companyId);
    expect(s.configured).toBe(true);
    expect(s.rules).toEqual(EGYPT_2026_RULES);
    expect(s.effectiveFrom).toBe("2026-01-01");
    expect(s.versions.map((v: any) => v.effectiveFrom)).toEqual(["2025-01-01", "2026-01-01"]);
    expect(s.versions[0].rules.insMaxWage).toBe(14_500);
    expect((await readPayrollSettings(hr, companyId, "2025-06-01")).rules.insMaxWage).toBe(14_500);
    for (const c of await prisma.company.findMany()) expect(await prisma.payrollSettings.count({ where: { companyId: c.id } })).toBeGreaterThan(0);
  });

  it("only payroll:approve may change the rules; invalid tables are rejected", async () => {
    await expectApiError(savePayrollSettings(hr, companyId, EGYPT_2026_RULES), 403);
    await expectApiError(savePayrollSettings(cfo, companyId, { ...EGYPT_2026_RULES, brackets: [{ upTo: 50_000, rate: 0 }, { upTo: 10_000, rate: 10 }, { upTo: null, rate: 20 }] }), 422);
    await expectApiError(savePayrollSettings(cfo, companyId, { ...EGYPT_2026_RULES, insMinWage: 20_000 }), 422);
    const viewer = await ctxFor("viewer@ccs.local");
    await expectApiError(readPayrollSettings(viewer, companyId), 403); // viewer has no access to UNITED
  });

  it("payroll calculation uses the company's saved rules and changes are audit-logged", async () => {
    const custom = { ...EGYPT_2026_RULES, employeeInsPct: 10, companyInsPct: 20, insMaxWage: 50_000, personalExemption: 0, brackets: [{ upTo: 60_000, rate: 0 }, { upTo: null, rate: 10 }], highIncomeSchedules: [] };
    const saved = await savePayrollSettings(cfo, companyId, custom);
    expect(saved.rules.employeeInsPct).toBe(10);
    expect(await prisma.auditLog.count({ where: { entity: "PayrollSettings", companyId, action: "UPDATE" } })).toBeGreaterThan(0);

    const pr = await create(hr, "payrolls", { companyId, month: "2026-12" });
    createdPayrolls.push(pr.id);
    const raw = await prisma.payrollLine.findMany({ where: { payrollId: pr.id } });
    const emps = new Map((await prisma.employee.findMany({ where: { id: { in: raw.map((l) => l.employeeId) } } })).map((e) => [e.id, e]));
    const lines = raw.map((l) => ({ ...l, employee: emps.get(l.employeeId)! }));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const exp = calcPayrollLine({ basic: l.basic, allowances: l.allowances, overtime: l.overtime, bonuses: l.bonuses, deductions: l.deductions, insuranceSalary: l.employee.insuranceSalary }, saved.rules);
      expect(Number(l.insurance)).toBe(exp.insurance.toNumber());
      expect(Number(l.companyInsurance)).toBe(exp.companyInsurance.toNumber());
      expect(Number(l.tax)).toBe(exp.tax.toNumber());
      expect(Number(l.net)).toBe(exp.net.toNumber());
    }
    const one = lines.find((l) => Number(l.employee.insuranceSalary) > 0)!;
    expect(Number(one.insurance)).toBe(Math.round(Math.min(Number(one.employee.insuranceSalary), 50_000) * 10) / 100);
  });

  it("versions are effective-dated: a payroll uses the version in force on the 1st of its month", async () => {
    const v = { ...EGYPT_2026_RULES, insMaxWage: 30_000, martyrsFundPct: 0.05, uhiEnabled: true, effectiveFrom: "2026-11-01", sourceNote: "test version" };
    const saved = await savePayrollSettings(cfo, companyId, v);
    expect(saved.versions.length).toBe(3);
    expect(saved.effectiveFrom).toBe("2026-11-01");
    expect((await readPayrollSettings(hr, companyId, "2026-10-31")).effectiveFrom).toBe("2026-01-01");
    const nov = await create(hr, "payrolls", { companyId, month: "2026-11" });
    const version = await prisma.payrollSettings.findFirstOrThrow({ where: { companyId, effectiveFrom: new Date("2026-11-01") } });
    expect(nov.rulesId).toBe(version.id);
    const lines = await prisma.payrollLine.findMany({ where: { payrollId: nov.id } });
    const insured = lines.filter((l) => Number(l.insurance) > 0);
    expect(insured.every((l) => Number(l.healthInsurance) > 0 && Number(l.companyHealthInsurance) >= 50)).toBe(true);
    for (const l of lines) expect(Math.abs(Number(l.martyrsFund) - Number(l.gross) * 0.0005)).toBeLessThan(0.006);
    for (const l of lines) expect(Number(l.net)).toBeCloseTo(Number(l.gross) - Number(l.deductions) - Number(l.insurance) - Number(l.healthInsurance) - Number(l.martyrsFund) - Number(l.tax), 2);
    // posting: Martyrs' Fund to its own payable; UHI with social insurance (collected by NOSI); employer UHI is a cost
    await submitApprovePost(hr, "payrolls", nov.id);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "PAYROLL", sourceId: nov.id }, include: { lines: true } });
    const sumBy = (id: string) => je.lines.filter((x) => x.accountId === id).reduce((s, x) => s + Number(x.credit) - Number(x.debit), 0);
    const tot = (k: keyof (typeof lines)[number]) => lines.reduce((s, l) => s + Number(l[k] as any), 0);
    expect(sumBy(await accountIdByKey(prisma, companyId, "MARTYRS_FUND_PAYABLE"))).toBeCloseTo(tot("martyrsFund"), 2);
    expect(sumBy(await accountIdByKey(prisma, companyId, "INSURANCE_PAYABLE"))).toBeCloseTo(tot("insurance") + tot("companyInsurance") + tot("healthInsurance") + tot("companyHealthInsurance"), 2);
    expect(Number(je.totalDebit)).toBeCloseTo(tot("gross") + tot("companyInsurance") + tot("companyHealthInsurance"), 2);
    // delete the version; the last remaining version cannot be deleted
    const after = await deletePayrollSettingsVersion(cfo, companyId, version.id);
    expect(after.versions.length).toBe(2);
    await expectApiError(deletePayrollSettingsVersion(hr, companyId, after.versions[0].id), 403);
    const central = await prisma.company.findFirstOrThrow({ where: { payrollSettings: { some: {} }, NOT: { id: companyId } }, include: { payrollSettings: true }, orderBy: { code: "asc" } });
    if (central.payrollSettings.length === 1) await expectApiError(deletePayrollSettingsVersion(await ctxFor("admin@ccs.local"), central.id, central.payrollSettings[0].id), 422);
  });
});
