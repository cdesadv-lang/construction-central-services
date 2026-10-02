/**
 * Configurable payroll rules (per company). Pure functions, no DB access.
 *
 * Statutory defaults (Egypt, 2026) — see README "Payroll rules" for sources:
 *  - Social insurance (Law 148/2019): employee 11%, employer 18.75% of the insurable wage,
 *    insurable wage clamped to the monthly minimum/maximum published by NOSI
 *    (2,700 / 16,700 EGP from 1 Jan 2026).
 *  - Salary tax (Income Tax Law 91/2005 as amended by Law 7/2024): annual personal exemption
 *    20,000 EGP, progressive brackets on annual net taxable income, with special schedules for
 *    high incomes (> 600,000) where the lower brackets are withdrawn.
 */
export interface TaxBracket {
  /** upper bound of the bracket on annual taxable income; null = no limit */
  upTo: number | null;
  /** percentage, e.g. 22.5 */
  rate: number;
}
export interface TaxSchedule {
  /** schedule applies when annual taxable income is > minIncome and <= maxIncome (null = no upper limit) */
  minIncome: number;
  maxIncome: number | null;
  brackets: TaxBracket[];
}
export interface PayrollRules {
  employeeInsPct: number;
  companyInsPct: number;
  insMinWage: number;
  insMaxWage: number;
  personalExemption: number;
  brackets: TaxBracket[];
  highIncomeSchedules: TaxSchedule[];
  overtimeMultiplier: number;
  hoursPerMonth: number;
  daysPerMonth: number;
  deductionsReduceTaxable: boolean;
}

export const EGYPT_STANDARD_BRACKETS: TaxBracket[] = [
  { upTo: 40_000, rate: 0 },
  { upTo: 55_000, rate: 10 },
  { upTo: 70_000, rate: 15 },
  { upTo: 200_000, rate: 20 },
  { upTo: 400_000, rate: 22.5 },
  { upTo: 1_200_000, rate: 25 },
  { upTo: null, rate: 27.5 },
];

export const EGYPT_HIGH_INCOME_SCHEDULES: TaxSchedule[] = [
  { minIncome: 600_000, maxIncome: 700_000, brackets: [{ upTo: 55_000, rate: 10 }, { upTo: 70_000, rate: 15 }, { upTo: 200_000, rate: 20 }, { upTo: 400_000, rate: 22.5 }, { upTo: null, rate: 25 }] },
  { minIncome: 700_000, maxIncome: 800_000, brackets: [{ upTo: 70_000, rate: 15 }, { upTo: 200_000, rate: 20 }, { upTo: 400_000, rate: 22.5 }, { upTo: null, rate: 25 }] },
  { minIncome: 800_000, maxIncome: 900_000, brackets: [{ upTo: 200_000, rate: 20 }, { upTo: 400_000, rate: 22.5 }, { upTo: null, rate: 25 }] },
  { minIncome: 900_000, maxIncome: 1_200_000, brackets: [{ upTo: 400_000, rate: 22.5 }, { upTo: null, rate: 25 }] },
  { minIncome: 1_200_000, maxIncome: null, brackets: [{ upTo: 1_200_000, rate: 25 }, { upTo: null, rate: 27.5 }] },
];

export const EGYPT_2026_RULES: PayrollRules = {
  employeeInsPct: 11,
  companyInsPct: 18.75,
  insMinWage: 2_700,
  insMaxWage: 16_700,
  personalExemption: 20_000,
  brackets: EGYPT_STANDARD_BRACKETS,
  highIncomeSchedules: EGYPT_HIGH_INCOME_SCHEDULES,
  overtimeMultiplier: 1.5,
  hoursPerMonth: 240,
  daysPerMonth: 30,
  deductionsReduceTaxable: true,
};

export class PayrollRulesError extends Error {}

function checkBrackets(b: TaxBracket[], where: string) {
  if (!Array.isArray(b) || !b.length) throw new PayrollRulesError(`${where}: at least one bracket is required`);
  let prev = 0;
  b.forEach((x, i) => {
    if (!(x.rate >= 0 && x.rate <= 100)) throw new PayrollRulesError(`${where}: bracket ${i + 1} rate must be between 0 and 100`);
    const last = i === b.length - 1;
    if (x.upTo === null || x.upTo === undefined) {
      if (!last) throw new PayrollRulesError(`${where}: only the last bracket may be unlimited`);
    } else {
      if (!(x.upTo > prev)) throw new PayrollRulesError(`${where}: bracket limits must be increasing (bracket ${i + 1})`);
      prev = x.upTo;
    }
  });
  if (b[b.length - 1].upTo !== null) throw new PayrollRulesError(`${where}: the last bracket must be unlimited`);
}

/** Validates a rules object; throws PayrollRulesError with a readable message. */
export function validatePayrollRules(r: PayrollRules): PayrollRules {
  const pct = (v: number, n: string) => {
    if (!(v >= 0 && v <= 100)) throw new PayrollRulesError(`${n} must be between 0 and 100`);
  };
  pct(r.employeeInsPct, "Employee insurance %");
  pct(r.companyInsPct, "Employer insurance %");
  if (!(r.insMinWage >= 0)) throw new PayrollRulesError("Minimum insurable wage must be >= 0");
  if (!(r.insMaxWage >= r.insMinWage)) throw new PayrollRulesError("Maximum insurable wage must be >= minimum");
  if (!(r.personalExemption >= 0)) throw new PayrollRulesError("Personal exemption must be >= 0");
  if (!(r.overtimeMultiplier >= 1)) throw new PayrollRulesError("Overtime multiplier must be >= 1");
  if (!(r.hoursPerMonth > 0) || !(r.daysPerMonth > 0)) throw new PayrollRulesError("Hours/days per month must be > 0");
  checkBrackets(r.brackets, "Standard schedule");
  let prevMax = -1;
  [...r.highIncomeSchedules]
    .sort((a, b) => a.minIncome - b.minIncome)
    .forEach((s, i) => {
      if (s.maxIncome !== null && !(s.maxIncome > s.minIncome)) throw new PayrollRulesError(`High-income schedule ${i + 1}: max must be greater than min`);
      if (s.minIncome < prevMax) throw new PayrollRulesError(`High-income schedules overlap (schedule ${i + 1})`);
      prevMax = s.maxIncome ?? Infinity;
      checkBrackets(s.brackets, `High-income schedule ${i + 1}`);
    });
  return r;
}

function applyBrackets(income: number, brackets: TaxBracket[]) {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * (b.rate / 100);
    lower = upper;
  }
  return tax;
}

/** Selects the schedule for an annual taxable income (after the personal exemption). */
export function scheduleFor(annualTaxable: number, r: PayrollRules): TaxBracket[] {
  const s = r.highIncomeSchedules.find((x) => annualTaxable > x.minIncome && (x.maxIncome === null || annualTaxable <= x.maxIncome));
  return s ? s.brackets : r.brackets;
}

/** Annual salary tax on annual taxable income (already net of insurance and personal exemption). */
export function annualSalaryTax(annualTaxable: number, r: PayrollRules = EGYPT_2026_RULES) {
  if (annualTaxable <= 0) return 0;
  return Math.round(applyBrackets(annualTaxable, scheduleFor(annualTaxable, r)) * 100) / 100;
}

/** Insurable wage clamped to [min, max]; 0 means "not insured" and stays 0. */
export function insurableWage(insuranceSalary: number, r: PayrollRules = EGYPT_2026_RULES) {
  if (!(insuranceSalary > 0)) return 0;
  return Math.min(Math.max(insuranceSalary, r.insMinWage), r.insMaxWage);
}

/** Normalises whatever is stored (DB Decimal/Json) into PayrollRules. Missing values fall back to defaults. */
export function toPayrollRules(row: Record<string, unknown> | null | undefined): PayrollRules {
  if (!row) return EGYPT_2026_RULES;
  const n = (k: keyof PayrollRules) => (row[k] === null || row[k] === undefined ? (EGYPT_2026_RULES[k] as number) : Number(row[k]));
  const brackets = (v: unknown): TaxBracket[] => (Array.isArray(v) ? v.map((b: any) => ({ upTo: b.upTo === null || b.upTo === undefined || b.upTo === "" ? null : Number(b.upTo), rate: Number(b.rate) })) : []); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    employeeInsPct: n("employeeInsPct"),
    companyInsPct: n("companyInsPct"),
    insMinWage: n("insMinWage"),
    insMaxWage: n("insMaxWage"),
    personalExemption: n("personalExemption"),
    overtimeMultiplier: n("overtimeMultiplier"),
    hoursPerMonth: n("hoursPerMonth"),
    daysPerMonth: n("daysPerMonth"),
    deductionsReduceTaxable: row.deductionsReduceTaxable === undefined || row.deductionsReduceTaxable === null ? true : Boolean(row.deductionsReduceTaxable),
    brackets: Array.isArray(row.brackets) && row.brackets.length ? brackets(row.brackets) : EGYPT_STANDARD_BRACKETS,
    highIncomeSchedules: Array.isArray(row.highIncomeSchedules)
      ? (row.highIncomeSchedules as any[]).map((s) => ({ minIncome: Number(s.minIncome), maxIncome: s.maxIncome === null || s.maxIncome === undefined || s.maxIncome === "" ? null : Number(s.maxIncome), brackets: brackets(s.brackets) })) // eslint-disable-line @typescript-eslint/no-explicit-any
      : EGYPT_HIGH_INCOME_SCHEDULES,
  };
}
