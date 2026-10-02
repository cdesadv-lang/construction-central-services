// Pure progress-billing (مستخلصات) calculations — unit tested.
import { D, r2 } from "./money";
import type { Prisma } from "@prisma/client";

type N = number | string | Prisma.Decimal | null | undefined;

export class ExtractError extends Error {}

export interface ContractorExtractInput {
  contractValue: N;
  cumulativeGross: N;
  previousGross: N;
  retentionPct: N;
  taxPct: N;
  insurancePct: N;
  advanceRecoveryPct: N;
  /** outstanding advance balance available to recover */
  advanceBalance?: N;
  otherDeductions?: N;
}

export function calcContractorExtract(i: ContractorExtractInput) {
  const cumulative = r2(D(i.cumulativeGross));
  const previous = r2(D(i.previousGross));
  const contractValue = D(i.contractValue);
  if (cumulative.isNegative()) throw new ExtractError("Cumulative work value cannot be negative");
  if (cumulative.lessThan(previous))
    throw new ExtractError(`Cumulative value (${cumulative.toFixed(2)}) is less than previous extracts (${previous.toFixed(2)})`);
  if (contractValue.greaterThan(0) && cumulative.greaterThan(contractValue))
    throw new ExtractError(`Cumulative value (${cumulative.toFixed(2)}) exceeds contract value (${contractValue.toFixed(2)})`);
  const current = cumulative.minus(previous);
  const retention = r2(current.mul(D(i.retentionPct)).div(100));
  const tax = r2(current.mul(D(i.taxPct)).div(100));
  const insurance = r2(current.mul(D(i.insurancePct)).div(100));
  let advance = r2(current.mul(D(i.advanceRecoveryPct)).div(100));
  if (i.advanceBalance !== undefined && i.advanceBalance !== null) {
    const bal = D(i.advanceBalance);
    if (advance.greaterThan(bal)) advance = r2(bal.isNegative() ? 0 : bal);
  }
  const other = r2(D(i.otherDeductions));
  const net = current.minus(retention).minus(tax).minus(insurance).minus(advance).minus(other);
  if (net.isNegative()) throw new ExtractError("Deductions exceed the current work value (net would be negative)");
  return {
    cumulativeGross: cumulative,
    previousGross: previous,
    currentGross: current,
    retentionAmount: retention,
    taxAmount: tax,
    insuranceAmount: insurance,
    advanceRecovery: advance,
    otherDeductions: other,
    netAmount: r2(net),
  };
}

export interface ClientExtractInput {
  contractValue: N;
  cumulativeWork: N;
  previousWork: N;
  retentionPct: N;
  taxPct: N;
  insurancePct: N;
  otherDeductions?: N;
}

export function calcClientExtract(i: ClientExtractInput) {
  const cumulative = r2(D(i.cumulativeWork));
  const previous = r2(D(i.previousWork));
  const contractValue = D(i.contractValue);
  if (cumulative.lessThan(previous))
    throw new ExtractError(`Cumulative work (${cumulative.toFixed(2)}) is less than previous extracts (${previous.toFixed(2)})`);
  if (contractValue.greaterThan(0) && cumulative.greaterThan(contractValue))
    throw new ExtractError(`Cumulative work (${cumulative.toFixed(2)}) exceeds project contract value (${contractValue.toFixed(2)})`);
  const work = cumulative.minus(previous);
  const retention = r2(work.mul(D(i.retentionPct)).div(100));
  const tax = r2(work.mul(D(i.taxPct)).div(100));
  const insurance = r2(work.mul(D(i.insurancePct)).div(100));
  const other = r2(D(i.otherDeductions));
  const net = work.minus(retention).minus(tax).minus(insurance).minus(other);
  if (net.isNegative()) throw new ExtractError("Deductions exceed the work value (net would be negative)");
  return {
    cumulativeWork: cumulative,
    previousWork: previous,
    workValue: work,
    retentionAmount: retention,
    taxAmount: tax,
    insuranceAmount: insurance,
    otherDeductions: other,
    netAmount: r2(net),
  };
}

/** Payroll line calculation (Egypt-style simplified): employee SI 11% / company 18.75% of insurance salary; flat tax brackets simplified. */
export function calcPayrollLine(i: {
  basic: N;
  allowances: N;
  overtime: N;
  bonuses: N;
  deductions: N;
  insuranceSalary: N;
  employeeInsPct?: number;
  companyInsPct?: number;
}) {
  const gross = r2(D(i.basic).plus(D(i.allowances)).plus(D(i.overtime)).plus(D(i.bonuses)));
  const insurance = r2(D(i.insuranceSalary).mul(i.employeeInsPct ?? 11).div(100));
  const companyInsurance = r2(D(i.insuranceSalary).mul(i.companyInsPct ?? 18.75).div(100));
  const taxable = gross.minus(insurance).minus(D(i.deductions));
  // Simplified monthly income tax: exempt first 1,250 EGP/month (15,000/yr), then 10% up to 3,333, 15% to 3,750, 20% above.
  const t = Math.max(0, Number(taxable.toFixed(2)) - 1250);
  const bands: [number, number][] = [
    [2083, 0.1],
    [417, 0.15],
    [Infinity, 0.2],
  ];
  let rem = t;
  let tax = 0;
  for (const [width, rate] of bands) {
    const part = Math.min(rem, width);
    tax += part * rate;
    rem -= part;
    if (rem <= 0) break;
  }
  const taxD = r2(tax);
  const deductions = r2(D(i.deductions));
  const net = r2(gross.minus(deductions).minus(insurance).minus(taxD));
  return { gross, insurance, companyInsurance, tax: taxD, deductions, net };
}
