/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { calcPayrollLine } from "@/lib/extracts";
import { EGYPT_2026_RULES } from "@/lib/payroll-rules";
import { readPayrollSettings, savePayrollSettings } from "@/server/services/payroll";
import { company, create, ctxFor, expectApiError } from "../helpers";

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
    expect(await prisma.payrollSettings.count()).toBe(await prisma.company.count());
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
});
