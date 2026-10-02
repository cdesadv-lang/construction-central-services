// Pure accounting helpers (no DB) — unit tested.
import { D, r2 } from "./money";
import type { Prisma } from "@prisma/client";

export interface RawLine {
  accountId: string;
  debit?: number | string | Prisma.Decimal | null;
  credit?: number | string | Prisma.Decimal | null;
}

export class UnbalancedError extends Error {}

/** Validates double-entry rules and returns totals. Throws with a descriptive message. */
export function checkBalanced(lines: RawLine[]) {
  if (!Array.isArray(lines) || lines.length < 2) throw new UnbalancedError("A journal entry needs at least two lines");
  let td = D(0);
  let tc = D(0);
  lines.forEach((l, i) => {
    const d = r2(D(l.debit));
    const c = r2(D(l.credit));
    if (!l.accountId) throw new UnbalancedError(`Line ${i + 1}: account is required`);
    if (d.isNegative() || c.isNegative()) throw new UnbalancedError(`Line ${i + 1}: amounts cannot be negative`);
    if (d.isZero() && c.isZero()) throw new UnbalancedError(`Line ${i + 1}: enter a debit or a credit amount`);
    if (!d.isZero() && !c.isZero()) throw new UnbalancedError(`Line ${i + 1}: a line cannot have both debit and credit`);
    td = td.plus(d);
    tc = tc.plus(c);
  });
  if (!td.equals(tc)) throw new UnbalancedError(`Entry is not balanced: debits ${td.toFixed(2)} ≠ credits ${tc.toFixed(2)}`);
  return { totalDebit: td, totalCredit: tc };
}

/** Normal balance sign: assets & expenses are debit-normal. */
export const debitNormal = (type: string) => type === "ASSET" || type === "EXPENSE";

export function naturalBalance(type: string, debit: unknown, credit: unknown) {
  const d = D(debit);
  const c = D(credit);
  return debitNormal(type) ? d.minus(c) : c.minus(d);
}
