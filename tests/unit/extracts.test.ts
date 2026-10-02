import { describe, expect, it } from "vitest";
import { calcClientExtract, calcContractorExtract, calcPayrollLine, ExtractError } from "@/lib/extracts";

describe("contractor extract calculation", () => {
  const base = { contractValue: 1_000_000, retentionPct: 5, taxPct: 1, insurancePct: 0.5, advanceRecoveryPct: 10 };
  it("computes current, deductions and net from cumulative - previous", () => {
    const r = calcContractorExtract({ ...base, cumulativeGross: 450_000, previousGross: 200_000, advanceBalance: 100_000, otherDeductions: 1_000 });
    expect(r.currentGross.toNumber()).toBe(250_000);
    expect(r.retentionAmount.toNumber()).toBe(12_500);
    expect(r.taxAmount.toNumber()).toBe(2_500);
    expect(r.insuranceAmount.toNumber()).toBe(1_250);
    expect(r.advanceRecovery.toNumber()).toBe(25_000);
    expect(r.netAmount.toNumber()).toBe(250_000 - 12_500 - 2_500 - 1_250 - 25_000 - 1_000);
  });
  it("caps advance recovery at the outstanding advance balance", () => {
    const r = calcContractorExtract({ ...base, cumulativeGross: 500_000, previousGross: 0, advanceBalance: 20_000 });
    expect(r.advanceRecovery.toNumber()).toBe(20_000);
  });
  it("rejects cumulative below previous or above contract value", () => {
    expect(() => calcContractorExtract({ ...base, cumulativeGross: 100, previousGross: 200 })).toThrow(ExtractError);
    expect(() => calcContractorExtract({ ...base, cumulativeGross: 1_000_001, previousGross: 0 })).toThrow(/exceeds/);
  });
  it("rejects negative net", () => {
    expect(() => calcContractorExtract({ ...base, cumulativeGross: 10_000, previousGross: 0, otherDeductions: 50_000 })).toThrow(/negative/);
  });
  it("rounds half-up to 2 decimals", () => {
    const r = calcContractorExtract({ ...base, cumulativeGross: 333.33, previousGross: 0, advanceRecoveryPct: 0 });
    expect(r.retentionAmount.toFixed(2)).toBe("16.67");
  });
});

describe("client extract calculation", () => {
  it("computes work value and net", () => {
    const r = calcClientExtract({ contractValue: 10_000_000, cumulativeWork: 3_000_000, previousWork: 1_000_000, retentionPct: 5, taxPct: 1, insurancePct: 0.5, otherDeductions: 10_000 });
    expect(r.workValue.toNumber()).toBe(2_000_000);
    expect(r.netAmount.toNumber()).toBe(2_000_000 - 100_000 - 20_000 - 10_000 - 10_000);
  });
  it("rejects exceeding contract value", () => {
    expect(() => calcClientExtract({ contractValue: 100, cumulativeWork: 101, previousWork: 0, retentionPct: 0, taxPct: 0, insurancePct: 0 })).toThrow(ExtractError);
  });
});

describe("payroll line", () => {
  it("gross = basic + allowances + overtime + bonuses; net = gross - deductions - insurance - tax", () => {
    const r = calcPayrollLine({ basic: 10_000, allowances: 2_000, overtime: 500, bonuses: 1_000, deductions: 300, insuranceSalary: 10_000 });
    expect(r.gross.toNumber()).toBe(13_500);
    expect(r.insurance.toNumber()).toBe(1_100);
    expect(r.companyInsurance.toNumber()).toBe(1_875);
    expect(r.net.toNumber()).toBe(Number((13_500 - 300 - 1_100 - r.tax.toNumber()).toFixed(2)));
    expect(r.tax.toNumber()).toBeGreaterThan(0);
  });
  it("no tax under the exemption threshold", () => {
    const r = calcPayrollLine({ basic: 1_200, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: 0 });
    expect(r.tax.toNumber()).toBe(0);
  });
});
