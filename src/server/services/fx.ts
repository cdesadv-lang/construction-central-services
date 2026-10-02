import type { Tx } from "@/lib/db";
import { D } from "@/lib/money";
import { badRequest, unprocessable } from "@/lib/errors";
import { BASE_CURRENCY, convertLines, FxError, isForeign, normCurrency } from "@/lib/fx";
import { checkBalanced, UnbalancedError } from "@/lib/accounting";
import type { LineInput } from "./accounting";

/** Latest rate (EGP per 1 unit) on or before the date; 1 for EGP. */
export async function rateOn(tx: Tx, companyId: string, currency: string, date: Date) {
  if (!isForeign(currency)) return D(1);
  const r = await tx.exchangeRate.findFirst({ where: { companyId, currency, date: { lte: date } }, orderBy: { date: "desc" } });
  if (!r) throw unprocessable(`No exchange rate for ${currency} on or before ${date.toISOString().slice(0, 10)} — add one under Accounting → Exchange rates`);
  return D(r.rate);
}

/**
 * Normalises currency/exchangeRate on a document payload. When the currency is foreign and no rate is
 * entered, the rate is taken from the exchange-rate table for the document date.
 */
export async function resolveDocFx(tx: Tx, companyId: string, data: any, existing?: any, dateField = "date") { // eslint-disable-line @typescript-eslint/no-explicit-any
  let currency: string;
  try {
    currency = normCurrency(data.currency ?? existing?.currency ?? BASE_CURRENCY);
  } catch (e) {
    if (e instanceof FxError) throw badRequest(e.message);
    throw e;
  }
  const date = new Date(data[dateField] ?? existing?.[dateField] ?? new Date());
  data.currency = currency;
  if (!isForeign(currency)) {
    data.exchangeRate = 1;
    return data;
  }
  const entered = data.exchangeRate !== undefined && data.exchangeRate !== null && data.exchangeRate !== "" ? D(data.exchangeRate) : null;
  const changed = !existing || data.currency !== existing.currency || (data[dateField] && new Date(data[dateField]).getTime() !== new Date(existing[dateField]).getTime());
  if (entered && entered.greaterThan(0)) data.exchangeRate = entered;
  else if (entered && !entered.greaterThan(0)) throw badRequest("Exchange rate must be greater than zero");
  else if (changed) data.exchangeRate = await rateOn(tx, companyId, currency, date);
  return data;
}

/** Currency of a cash box / bank account must match the document currency. */
export function assertSameCurrency(what: string, accountCurrency: string | null | undefined, docCurrency: string | null | undefined) {
  const a = accountCurrency ?? BASE_CURRENCY;
  const d = docCurrency ?? BASE_CURRENCY;
  if (a !== d) throw unprocessable(`${what} is in ${a} but the document is in ${d} — use an account in the same currency (or a transfer in the same currency)`);
}

/**
 * Manual journal entries in a foreign currency: lines are entered (and must balance) in the entry currency, then
 * converted to EGP lines tagged with currency / original amount / rate (rounding absorbed so the EGP entry balances).
 */
export function convertManualLines(lines: LineInput[], currency: string, rate: unknown): LineInput[] {
  try {
    checkBalanced(lines);
    if (!isForeign(currency)) return lines.map((l) => ({ ...l, currency: null, fxAmount: null, exchangeRate: null }));
    return convertLines(lines as (LineInput & { accountId: string })[], currency, rate as never) as LineInput[];
  } catch (e) {
    if (e instanceof UnbalancedError || e instanceof FxError) throw unprocessable(e.message);
    throw e;
  }
}

/** Journal lines of an existing entry expressed back in the entry currency (for edits that keep the lines). */
export function linesInEntryCurrency(lines: { accountId: string; debit: unknown; credit: unknown; fxAmount?: unknown; currency?: string | null; costCenterId?: string | null; projectId?: string | null; description?: string | null; partyType?: string | null; partyId?: string | null }[]): LineInput[] {
  return lines.map((l) => {
    const foreign = isForeign(l.currency) && l.fxAmount !== null && l.fxAmount !== undefined;
    const dr = D(l.debit as never);
    return {
      accountId: l.accountId,
      debit: foreign ? (dr.greaterThan(0) ? D(l.fxAmount as never) : 0) : dr,
      credit: foreign ? (dr.greaterThan(0) ? 0 : D(l.fxAmount as never)) : D(l.credit as never),
      costCenterId: l.costCenterId,
      projectId: l.projectId,
      description: l.description,
      partyType: l.partyType,
      partyId: l.partyId,
    };
  });
}
