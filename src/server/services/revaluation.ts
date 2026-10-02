import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, r2 } from "@/lib/money";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { normCurrency } from "@/lib/fx";
import type { Ctx } from "../context";
import { audit } from "../audit";
import { nextNumber } from "../sequence";
import { accountIdByKey, createJournalEntry, reverseJournalEntry, type LineInput } from "./accounting";
import { rateOn } from "./fx";

/**
 * Monetary accounts revalued at the closing rate (IAS 21 / EAS 13: monetary items are translated at the closing
 * rate; non-monetary items, revenue and expenses stay at historical rates). Tax and statutory accounts are EGP
 * obligations by nature and are excluded even when tagged with a document currency.
 */
export const MONETARY_KEYS = [
  "AR", "RETENTION_RECEIVABLE", "CONTRACTOR_ADVANCES", "CUSTODY", "NOTES_RECEIVABLE", "CHEQUES_UNDER_COLLECTION",
  "AP_SUPPLIERS", "AP_CONTRACTORS", "RETENTION_PAYABLE", "SALARIES_PAYABLE", "CLIENT_ADVANCES", "NOTES_PAYABLE",
];
const CASH_PARENTS = ["CASH_PARENT", "BANK_PARENT"];

export interface RevaluationLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  partyType: string | null;
  partyId: string | null;
  partyName: string | null;
  currency: string;
  fxBalance: number;
  bookValue: number;
  rate: number;
  revalued: number;
  adjustment: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function partyNames(tx: Tx, rows: { partyType: string | null; partyId: string | null }[]) {
  const ids = (t: string) => rows.filter((r) => r.partyType === t && r.partyId).map((r) => r.partyId!);
  const out = new Map<string, string>();
  const put = (xs: { id: string; name: string }[]) => xs.forEach((x) => out.set(x.id, x.name));
  put(await tx.client.findMany({ where: { id: { in: ids("CLIENT") } }, select: { id: true, name: true } }));
  put(await tx.supplier.findMany({ where: { id: { in: ids("SUPPLIER") } }, select: { id: true, name: true } }));
  put(await tx.contractor.findMany({ where: { id: { in: ids("CONTRACTOR") } }, select: { id: true, name: true } }));
  put(await tx.employee.findMany({ where: { id: { in: ids("EMPLOYEE") } }, select: { id: true, name: true } }));
  return out;
}

/**
 * Computes the revaluation of open foreign-currency balances on `date`: for every (account, party, currency)
 * bucket, revalued = fx balance × closing rate, adjustment = revalued − EGP book value.
 * `rates` overrides the rate table per currency.
 */
export async function computeRevaluation(tx: Tx, companyId: string, date: Date, rates: Record<string, unknown> = {}) {
  const accounts = await tx.account.findMany({
    where: { companyId, OR: [{ systemKey: { in: MONETARY_KEYS } }, { parent: { systemKey: { in: CASH_PARENTS } } }] },
    select: { id: true, code: true, name: true },
  });
  if (!accounts.length) return { date: iso(date), rates: {}, lines: [] as RevaluationLine[], totalGain: 0 };
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const buckets = await tx.$queryRaw<{ accountId: string; partyType: string | null; partyId: string | null; currency: string; base: Prisma.Decimal; fx: Prisma.Decimal }[]>`
    SELECT l."accountId", l."partyType", l."partyId", l."currency",
           SUM(l."debit" - l."credit") AS base,
           SUM(CASE WHEN l."debit" > 0 THEN COALESCE(l."fxAmount", 0) ELSE -COALESCE(l."fxAmount", 0) END) AS fx
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'POSTED' AND e."date" <= ${date}
      AND l."currency" IS NOT NULL AND l."currency" <> 'EGP'
      AND l."accountId" IN (${Prisma.join(accounts.map((a) => a.id))})
    GROUP BY l."accountId", l."partyType", l."partyId", l."currency"`;
  const used: Record<string, number> = {};
  for (const [c, v] of Object.entries(rates)) {
    if (v === undefined || v === null || v === "") continue;
    const r = D(v as never);
    if (!r.greaterThan(0)) throw badRequest(`Rate for ${c} must be greater than zero`);
    used[normCurrency(c)] = Number(r);
  }
  for (const b of buckets) if (used[b.currency] === undefined) used[b.currency] = Number(await rateOn(tx, companyId, b.currency, date));
  const names = await partyNames(tx, buckets);
  const lines: RevaluationLine[] = [];
  for (const b of buckets) {
    const rate = D(used[b.currency]);
    const revalued = r2(D(b.fx).mul(rate));
    const adj = r2(revalued.minus(D(b.base)));
    if (adj.abs().lessThan(0.01)) continue;
    const a = byId.get(b.accountId)!;
    lines.push({
      accountId: a.id, accountCode: a.code, accountName: a.name, partyType: b.partyType, partyId: b.partyId, partyName: b.partyId ? (names.get(b.partyId) ?? null) : null,
      currency: b.currency, fxBalance: Number(r2(D(b.fx))), bookValue: Number(r2(D(b.base))), rate: Number(rate), revalued: Number(revalued), adjustment: Number(adj),
    });
  }
  lines.sort((x, y) => x.accountCode.localeCompare(y.accountCode) || x.currency.localeCompare(y.currency));
  const totalGain = Number(r2(lines.reduce((s, l) => s.plus(l.adjustment), D(0))));
  return { date: iso(date), rates: used, lines, totalGain };
}

/** Posts the revaluation entry (and, by default, its reversal dated the next day). */
export async function runRevaluation(tx: Tx, ctx: Ctx, input: { companyId: string; date: Date; rates?: Record<string, unknown>; autoReverse?: boolean; notes?: string | null }) {
  const { companyId, date } = input;
  const open = await tx.fxRevaluation.findFirst({ where: { companyId, status: "POSTED" } });
  if (open) throw unprocessable(`Revaluation ${open.number} (${iso(open.date)}) is not reversed yet — reverse it before running a new one`);
  const later = await tx.fxRevaluation.findFirst({ where: { companyId, date: { gte: date } }, orderBy: { date: "desc" } });
  if (later) throw unprocessable(`A revaluation already exists on or after ${iso(date)} (${later.number} dated ${iso(later.date)})`);
  const r = await computeRevaluation(tx, companyId, date, input.rates);
  if (!r.lines.length) throw unprocessable("No open foreign-currency balances need revaluation on this date");
  const fxAcc = await accountIdByKey(tx, companyId, "FX_UNREALIZED");
  const jl: LineInput[] = [];
  for (const l of r.lines) {
    const amt = Math.abs(l.adjustment);
    jl.push({
      accountId: l.accountId, partyType: l.partyType, partyId: l.partyId,
      // tagged with the currency (fx amount 0) so the bucket's EGP value moves while its currency balance does not
      currency: l.currency, fxAmount: 0, exchangeRate: l.rate,
      description: `إعادة تقييم ${l.fxBalance} ${l.currency} @ ${l.rate}`,
      ...(l.adjustment > 0 ? { debit: amt } : { credit: amt }),
    });
  }
  const gain = D(r.totalGain);
  if (!gain.isZero()) jl.push({ accountId: fxAcc, description: gain.greaterThan(0) ? "أرباح فروق عملة غير محققة" : "خسائر فروق عملة غير محققة", ...(gain.greaterThan(0) ? { credit: gain } : { debit: gain.abs() }) });
  const number = await nextNumber(tx, companyId, "FXR", "FXR");
  const je = await createJournalEntry(tx, ctx, {
    companyId, date, status: "POSTED", sourceType: "FX_REVALUATION",
    description: `إعادة تقييم الأرصدة بالعملات الأجنبية ${number} في ${r.date} / FX revaluation`,
    lines: jl,
  });
  const autoReverse = input.autoReverse !== false;
  let row = await tx.fxRevaluation.create({
    data: {
      companyId, number, date, autoReverse, rates: r.rates, lines: r.lines as unknown as Prisma.InputJsonValue, totalGain: gain,
      journalEntryId: je.id, notes: input.notes ?? null, createdById: ctx.user.id,
    },
  });
  await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: row.id } });
  if (autoReverse) row = await reverseRevaluation(tx, ctx, row.id, addDays(date, 1), "عكس تلقائي في اليوم التالي");
  await audit(tx, ctx, { action: "CREATE_POSTED", entity: "FxRevaluation", entityId: row.id, companyId, after: { number, date: r.date, totalGain: r.totalGain, lines: r.lines.length, autoReverse } });
  return row;
}

export async function reverseRevaluation(tx: Tx, ctx: Ctx, id: string, date?: Date, reason?: string) {
  const row = await tx.fxRevaluation.findUnique({ where: { id } });
  if (!row) throw notFound();
  if (row.status !== "POSTED" || !row.journalEntryId) throw unprocessable("Revaluation is already reversed");
  const when = date ?? addDays(row.date, 1);
  if (when < row.date) throw unprocessable("Reversal date cannot be before the revaluation date");
  const rev = await reverseJournalEntry(tx, ctx, row.journalEntryId, reason || `Reversal of ${row.number}`, when);
  const updated = await tx.fxRevaluation.update({ where: { id }, data: { status: "REVERSED", reversalEntryId: rev.id, reversalDate: when } });
  await audit(tx, ctx, { action: "REVERSE", entity: "FxRevaluation", entityId: id, companyId: row.companyId, after: { reversalEntryId: rev.id, date: iso(when) } });
  return updated;
}
