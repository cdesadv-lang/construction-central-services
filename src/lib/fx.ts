// Multi-currency helpers (pure). Base currency of the books is EGP; amounts in a foreign currency are
// converted at "EGP per 1 unit" rates. Journal lines keep debit/credit in EGP plus the original amount.
import { D, r2 } from "./money";
import type { Prisma } from "@prisma/client";

type N = number | string | Prisma.Decimal | null | undefined;

export const BASE_CURRENCY = "EGP";
export const CURRENCIES = ["EGP", "USD", "EUR", "GBP", "SAR", "AED", "KWD", "CNY"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export class FxError extends Error {}

export function normCurrency(c: unknown): string {
  const v = String(c ?? BASE_CURRENCY).trim().toUpperCase() || BASE_CURRENCY;
  if (!/^[A-Z]{3}$/.test(v)) throw new FxError(`Invalid currency code "${String(c)}"`);
  return v;
}

export const isForeign = (c: string | null | undefined) => !!c && c !== BASE_CURRENCY;

/** amount (in currency) -> base, rounded to 2 decimals */
export function toBase(amount: N, rate: N) {
  return r2(D(amount).mul(D(rate ?? 1)));
}

export interface FxLine {
  accountId: string;
  debit?: N;
  credit?: N;
}

/**
 * Converts balanced document-currency lines to base-currency lines tagged with currency/fxAmount/rate.
 * Rounding differences (from converting line by line) are absorbed by the largest line on the short side,
 * so the converted entry always balances.
 */
export function convertLines<T extends FxLine>(lines: T[], currency: string, rate: N): (T & { currency?: string; fxAmount?: Prisma.Decimal; exchangeRate?: Prisma.Decimal })[] {
  if (!isForeign(currency)) return lines;
  const R = D(rate ?? 0);
  if (!R.greaterThan(0)) throw new FxError(`Exchange rate for ${currency} must be greater than zero`);
  const out = lines.map((l) => {
    const dr = D(l.debit);
    const cr = D(l.credit);
    return { ...l, debit: toBase(dr, R), credit: toBase(cr, R), currency, fxAmount: r2(dr.isZero() ? cr : dr), exchangeRate: R };
  });
  const diff = out.reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
  if (!diff.isZero()) {
    // diff > 0: debits too large -> raise the largest credit; diff < 0: raise the largest debit
    const side = diff.greaterThan(0) ? "credit" : "debit";
    let idx = -1;
    out.forEach((l, i) => {
      if (D(l[side]).greaterThan(0) && (idx < 0 || D(l[side]).greaterThan(D(out[idx][side])))) idx = i;
    });
    if (idx >= 0) out[idx] = { ...out[idx], [side]: r2(D(out[idx][side]).plus(diff.abs())) };
  }
  return out;
}

/** Signed foreign-currency balance of lines (debit side positive). */
export function fxBalance(lines: { debit: N; credit: N; fxAmount: N; currency: string | null }[], currency: string) {
  return lines.reduce((s, l) => {
    if (l.currency !== currency || l.fxAmount === null || l.fxAmount === undefined) return s;
    return D(l.debit).greaterThan(0) ? s.plus(D(l.fxAmount)) : s.minus(D(l.fxAmount));
  }, D(0));
}
