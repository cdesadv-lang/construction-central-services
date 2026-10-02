import { describe, expect, it } from "vitest";
import { calcPayrollLine } from "@/lib/extracts";
import { EGYPT_2025_RULES, EGYPT_2026_RULES, annualSalaryTax, insurableWage, toPayrollRules, validatePayrollRules, PayrollRulesError } from "@/lib/payroll-rules";

describe("Egyptian salary tax (Law 7/2024 schedules)", () => {
  it.each([
    [0, 0],
    [40_000, 0],
    [100_000, 9_750], // 0 + 1,500 + 2,250 + 6,000
    [600_000, 124_750], // still standard schedule (> 600k starts the high-income schedules)
    [650_000, 141_250], // 10% from the first pound up to 55k, 25% above 400k
    [750_000, 169_000],
    [850_000, 197_500],
    [1_000_000, 240_000],
    [1_500_000, 382_500],
  ])("annual taxable %d -> tax %d", (income, tax) => {
    expect(annualSalaryTax(income, EGYPT_2026_RULES)).toBe(tax);
  });
});

describe("social insurance wage limits (NOSI 2026)", () => {
  it("clamps the insurable wage to [2,700, 16,700]; 0 = not insured", () => {
    expect(insurableWage(1_000)).toBe(2_700);
    expect(insurableWage(10_000)).toBe(10_000);
    expect(insurableWage(50_000)).toBe(16_700);
    expect(insurableWage(0)).toBe(0);
  });
});

describe("payroll line with statutory rules", () => {
  it("20,000 gross / 20,000 insurance salary", () => {
    const r = calcPayrollLine({ basic: 20_000, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 20_000 });
    expect(r.insurableWage.toNumber()).toBe(16_700);
    expect(r.insurance.toNumber()).toBe(1_837);
    expect(r.companyInsurance.toNumber()).toBe(3_131.25);
    expect(r.annualTaxable.toNumber()).toBe(197_956); // (20,000 - 1,837) x 12 - 20,000
    expect(r.tax.toNumber()).toBe(2_445.1); // 29,341.20 / 12
    expect(r.martyrsFund.toNumber()).toBe(10); // 5/10,000 of 20,000
    expect(r.healthInsurance.toNumber()).toBe(0); // UHI off by default
    expect(r.net.toNumber()).toBe(15_707.9); // 20,000 - 1,837 - 2,445.10 - 10
  });
  it("universal health insurance: employee 1%, employer 4% (min 50) of the insurable wage; employee share reduces taxable", () => {
    const rules = { ...EGYPT_2026_RULES, uhiEnabled: true };
    const r = calcPayrollLine({ basic: 20_000, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 20_000 }, rules);
    expect(r.healthInsurance.toNumber()).toBe(167);
    expect(r.companyHealthInsurance.toNumber()).toBe(668);
    expect(r.annualTaxable.toNumber()).toBe(197_956 - 167 * 12);
    expect(r.net.toNumber()).toBeCloseTo(20_000 - 1_837 - 167 - 10 - r.tax.toNumber(), 2);
    const low = calcPayrollLine({ basic: 1_000, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 1_000 }, { ...rules, insMinWage: 0 });
    expect(low.companyHealthInsurance.toNumber()).toBe(50); // 4% = 40 -> minimum 50
    const uninsured = calcPayrollLine({ basic: 5_000, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 0 }, rules);
    expect(uninsured.healthInsurance.toNumber()).toBe(0);
    expect(uninsured.martyrsFund.toNumber()).toBe(2.5);
  });
  it("2025 version keeps the tax law but uses the 2025 NOSI limits", () => {
    expect(EGYPT_2025_RULES.insMinWage).toBe(2_300);
    expect(EGYPT_2025_RULES.insMaxWage).toBe(14_500);
    expect(EGYPT_2025_RULES.brackets).toEqual(EGYPT_2026_RULES.brackets);
  });
  it("uses company-specific rules", () => {
    const rules = { ...EGYPT_2026_RULES, employeeInsPct: 10, insMaxWage: 100_000, personalExemption: 0, brackets: [{ upTo: null, rate: 10 }], highIncomeSchedules: [] };
    const r = calcPayrollLine({ basic: 10_000, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 10_000 }, rules);
    expect(r.insurance.toNumber()).toBe(1_000);
    expect(r.tax.toNumber()).toBe(900); // 10% of 9,000
  });
});

describe("rules validation & normalisation", () => {
  it("rejects bad brackets", () => {
    expect(() => validatePayrollRules({ ...EGYPT_2026_RULES, brackets: [{ upTo: 50_000, rate: 0 }, { upTo: 40_000, rate: 10 }, { upTo: null, rate: 20 }] })).toThrow(PayrollRulesError);
    expect(() => validatePayrollRules({ ...EGYPT_2026_RULES, brackets: [{ upTo: 50_000, rate: 0 }] })).toThrow(/unlimited/);
    expect(() => validatePayrollRules({ ...EGYPT_2026_RULES, insMaxWage: 1_000 })).toThrow(/Maximum/);
    expect(() => validatePayrollRules({ ...EGYPT_2026_RULES, highIncomeSchedules: [EGYPT_2026_RULES.highIncomeSchedules[0], { ...EGYPT_2026_RULES.highIncomeSchedules[1], minIncome: 650_000 }] })).toThrow(/overlap/);
    expect(validatePayrollRules(EGYPT_2026_RULES)).toBe(EGYPT_2026_RULES);
  });
  it("normalises DB rows (Decimal strings) and falls back to defaults", () => {
    expect(toPayrollRules(null)).toBe(EGYPT_2026_RULES);
    const r = toPayrollRules({ employeeInsPct: "11.000", companyInsPct: "18.75", insMinWage: "2700", insMaxWage: "16700", personalExemption: "20000", brackets: [{ upTo: "1000", rate: "0" }, { upTo: null, rate: "5" }], highIncomeSchedules: [] });
    expect(r.employeeInsPct).toBe(11);
    expect(r.brackets).toEqual([{ upTo: 1000, rate: 0 }, { upTo: null, rate: 5 }]);
    expect(r.overtimeMultiplier).toBe(1.5);
  });
});
