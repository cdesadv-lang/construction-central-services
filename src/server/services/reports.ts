/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, num, r2 } from "@/lib/money";
import { debitNormal } from "@/lib/accounting";
import { badRequest, notFound } from "@/lib/errors";
import { assertCompany, assertProject, companyScope, type Ctx } from "../context";

export type Col = { key: string; type?: "text" | "money" | "date" | "pct" | "number" };
export interface ReportResult {
  report: string;
  columns: Col[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  sections?: { key: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> }[];
}

export interface ReportParams {
  companyId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  accountId?: string;
  partyId?: string;
  asOf?: string;
}

const endOf = (s?: string) => (s ? new Date(s + "T23:59:59.999Z") : undefined);
const startOf = (s?: string) => (s ? new Date(s + "T00:00:00Z") : undefined);
const money = (v: unknown) => num(v);

function scope(ctx: Ctx, p: ReportParams) {
  const companyIds = companyScope(ctx, p.companyId);
  if (p.projectId) assertProject(ctx, p.projectId);
  const projectFilter = p.projectId ? { projectId: p.projectId } : ctx.projectIds ? { projectId: { in: ctx.projectIds } } : {};
  return { companyIds, projectFilter };
}

async function accountSums(companyIds: string[], where: Prisma.JournalLineWhereInput) {
  const rows = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId: { in: companyIds }, entry: { status: "POSTED" }, ...where } as any,
    _sum: { debit: true, credit: true },
  });
  return new Map(rows.map((r) => [r.accountId, { debit: D(r._sum.debit), credit: D(r._sum.credit) }]));
}

function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

// ───────────────────────── Financial statements ─────────────────────────
export async function trialBalance(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const from = startOf(p.from);
  const to = endOf(p.to);
  const accounts = await prisma.account.findMany({ where: { companyId: { in: companyIds }, isPostable: true }, orderBy: { code: "asc" } });
  const opening = from ? await accountSums(companyIds, { ...projectFilter, entry: { status: "POSTED", date: { lt: from } } }) : new Map();
  const period = await accountSums(companyIds, { ...projectFilter, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } });
  // Consolidate by account code when several companies are included.
  const byCode = new Map<string, any>();
  for (const a of accounts) {
    const o = opening.get(a.id) ?? { debit: D(0), credit: D(0) };
    const m = period.get(a.id) ?? { debit: D(0), credit: D(0) };
    const row = byCode.get(a.code) ?? { code: a.code, name: a.name, nameEn: a.nameEn, type: a.type, ob: D(0), pd: D(0), pc: D(0) };
    row.ob = row.ob.plus(o.debit.minus(o.credit));
    row.pd = row.pd.plus(m.debit);
    row.pc = row.pc.plus(m.credit);
    byCode.set(a.code, row);
  }
  const rows = [...byCode.values()]
    .map((r) => {
      const close = r.ob.plus(r.pd).minus(r.pc);
      return {
        code: r.code,
        name: r.name,
        nameEn: r.nameEn,
        type: r.type,
        openingDebit: money(r.ob.greaterThan(0) ? r.ob : 0),
        openingCredit: money(r.ob.lessThan(0) ? r.ob.neg() : 0),
        periodDebit: money(r.pd),
        periodCredit: money(r.pc),
        closingDebit: money(close.greaterThan(0) ? close : 0),
        closingCredit: money(close.lessThan(0) ? close.neg() : 0),
      };
    })
    .filter((r) => r.openingDebit || r.openingCredit || r.periodDebit || r.periodCredit);
  const t = (k: keyof (typeof rows)[number]) => r2(rows.reduce((s, r) => s + Number(r[k]), 0)).toNumber();
  const totals = {
    code: "",
    name: "الإجمالي / Total",
    openingDebit: t("openingDebit"),
    openingCredit: t("openingCredit"),
    periodDebit: t("periodDebit"),
    periodCredit: t("periodCredit"),
    closingDebit: t("closingDebit"),
    closingCredit: t("closingCredit"),
  };
  return {
    report: "trial-balance",
    columns: [
      { key: "code" },
      { key: "name" },
      { key: "openingDebit", type: "money" },
      { key: "openingCredit", type: "money" },
      { key: "periodDebit", type: "money" },
      { key: "periodCredit", type: "money" },
      { key: "closingDebit", type: "money" },
      { key: "closingCredit", type: "money" },
    ],
    rows,
    totals,
    meta: { balanced: totals.periodDebit === totals.periodCredit && totals.closingDebit === totals.closingCredit, consolidated: companyIds.length > 1 },
  };
}

export async function generalLedger(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  if (!p.accountId) throw badRequest("accountId is required");
  const account = await prisma.account.findUnique({ where: { id: p.accountId } });
  if (!account) throw notFound("Account not found");
  assertCompany(ctx, account.companyId);
  const { projectFilter } = scope(ctx, { ...p, companyId: account.companyId });
  const from = startOf(p.from);
  const to = endOf(p.to);
  let opening = D(0);
  if (from) {
    const o = await prisma.journalLine.aggregate({ where: { accountId: account.id, ...projectFilter, entry: { status: "POSTED", date: { lt: from } } }, _sum: { debit: true, credit: true } });
    opening = D(o._sum.debit).minus(D(o._sum.credit));
  }
  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, ...projectFilter, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } },
    include: { entry: { select: { number: true, date: true, description: true, sourceType: true } }, project: { select: { code: true } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
    take: 5000,
  });
  let bal = opening;
  const rows = lines.map((l) => {
    bal = bal.plus(D(l.debit)).minus(D(l.credit));
    return {
      date: l.entry.date,
      entryNumber: l.entry.number,
      description: l.description || l.entry.description,
      project: l.project?.code ?? "",
      debit: money(l.debit),
      credit: money(l.credit),
      balance: money(debitNormal(account.type) ? bal : bal.neg()),
    };
  });
  const td = rows.reduce((s, r) => s + r.debit, 0);
  const tc = rows.reduce((s, r) => s + r.credit, 0);
  return {
    report: "general-ledger",
    columns: [{ key: "date", type: "date" }, { key: "entryNumber" }, { key: "description" }, { key: "project" }, { key: "debit", type: "money" }, { key: "credit", type: "money" }, { key: "balance", type: "money" }],
    rows,
    totals: { description: "الإجمالي / Total", debit: r2(td).toNumber(), credit: r2(tc).toNumber(), balance: money(debitNormal(account.type) ? bal : bal.neg()) },
    meta: { account: { code: account.code, name: account.name, type: account.type }, opening: money(debitNormal(account.type) ? opening : opening.neg()) },
  };
}

async function plByAccount(companyIds: string[], projectFilter: any, from?: Date, to?: Date) {
  const accounts = await prisma.account.findMany({ where: { companyId: { in: companyIds }, type: { in: ["REVENUE", "EXPENSE"] }, isPostable: true }, orderBy: { code: "asc" } });
  const sums = await accountSums(companyIds, { ...projectFilter, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } });
  const byCode = new Map<string, { code: string; name: string; type: string; amount: Prisma.Decimal }>();
  for (const a of accounts) {
    const s = sums.get(a.id);
    if (!s) continue;
    const amt = a.type === "REVENUE" ? s.credit.minus(s.debit) : s.debit.minus(s.credit);
    const r = byCode.get(a.code) ?? { code: a.code, name: a.name, type: a.type, amount: D(0) };
    r.amount = r.amount.plus(amt);
    byCode.set(a.code, r);
  }
  return [...byCode.values()].filter((r) => !r.amount.isZero());
}

export async function incomeStatement(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const rows = await plByAccount(companyIds, projectFilter, startOf(p.from), endOf(p.to));
  const rev = rows.filter((r) => r.type === "REVENUE");
  const exp = rows.filter((r) => r.type === "EXPENSE");
  const tr = rev.reduce((s, r) => s.plus(r.amount), D(0));
  const te = exp.reduce((s, r) => s.plus(r.amount), D(0));
  const cols: Col[] = [{ key: "code" }, { key: "name" }, { key: "amount", type: "money" }];
  const mapRow = (r: any) => ({ code: r.code, name: r.name, amount: money(r.amount) });
  return {
    report: "income-statement",
    columns: cols,
    rows: [...rev.map(mapRow), ...exp.map(mapRow)],
    sections: [
      { key: "revenue", columns: cols, rows: rev.map(mapRow), totals: { name: "إجمالي الإيرادات / Total Revenue", amount: money(tr) } },
      { key: "expenses", columns: cols, rows: exp.map(mapRow), totals: { name: "إجمالي المصروفات / Total Expenses", amount: money(te) } },
    ],
    totals: { name: "صافي الربح / Net Profit", amount: money(tr.minus(te)) },
    meta: { revenue: money(tr), expenses: money(te), netProfit: money(tr.minus(te)), margin: tr.isZero() ? 0 : money(tr.minus(te).div(tr).mul(100)) },
  };
}

export async function balanceSheet(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds } = scope(ctx, { ...p, projectId: undefined });
  const asOf = endOf(p.asOf ?? p.to);
  const accounts = await prisma.account.findMany({ where: { companyId: { in: companyIds }, isPostable: true }, orderBy: { code: "asc" } });
  const sums = await accountSums(companyIds, { entry: { status: "POSTED", ...(asOf ? { date: { lte: asOf } } : {}) } });
  const agg = new Map<string, { code: string; name: string; type: string; amount: Prisma.Decimal }>();
  let earnings = D(0);
  for (const a of accounts) {
    const s = sums.get(a.id);
    if (!s) continue;
    const bal = debitNormal(a.type) ? s.debit.minus(s.credit) : s.credit.minus(s.debit);
    if (a.type === "REVENUE") earnings = earnings.plus(bal);
    else if (a.type === "EXPENSE") earnings = earnings.minus(bal);
    else {
      const r = agg.get(a.code) ?? { code: a.code, name: a.name, type: a.type, amount: D(0) };
      r.amount = r.amount.plus(bal);
      agg.set(a.code, r);
    }
  }
  const list = [...agg.values()].filter((r) => !r.amount.isZero());
  const cols: Col[] = [{ key: "code" }, { key: "name" }, { key: "amount", type: "money" }];
  const sec = (type: string) => list.filter((r) => r.type === type).map((r) => ({ code: r.code, name: r.name, amount: money(r.amount) }));
  const total = (rows: { amount: number }[]) => r2(rows.reduce((s, r) => s + r.amount, 0)).toNumber();
  const assets = sec("ASSET");
  const liabilities = sec("LIABILITY");
  const equity = [...sec("EQUITY"), { code: "", name: "أرباح الفترة الجارية / Current Earnings", amount: money(earnings) }];
  const ta = total(assets);
  const tl = total(liabilities);
  const te = total(equity);
  return {
    report: "balance-sheet",
    columns: cols,
    rows: [...assets, ...liabilities, ...equity],
    sections: [
      { key: "assets", columns: cols, rows: assets, totals: { name: "إجمالي الأصول / Total Assets", amount: ta } },
      { key: "liabilities", columns: cols, rows: liabilities, totals: { name: "إجمالي الخصوم / Total Liabilities", amount: tl } },
      { key: "equity", columns: cols, rows: equity, totals: { name: "إجمالي حقوق الملكية / Total Equity", amount: te } },
    ],
    totals: { name: "الخصوم + حقوق الملكية / Liabilities + Equity", amount: r2(tl + te).toNumber() },
    meta: { totalAssets: ta, totalLiabilitiesEquity: r2(tl + te).toNumber(), balanced: Math.abs(ta - (tl + te)) < 0.01 },
  };
}

async function moneyAccountIds(companyIds: string[]) {
  const parents = await prisma.account.findMany({ where: { companyId: { in: companyIds }, systemKey: { in: ["CASH_PARENT", "BANK_PARENT"] } }, select: { id: true } });
  const kids = await prisma.account.findMany({ where: { parentId: { in: parents.map((p) => p.id) } }, select: { id: true } });
  return kids.map((k) => k.id);
}

const CF_CATEGORY: Record<string, string> = {
  CLIENT_EXTRACT: "operating",
  PAYMENT: "operating",
  EXPENSE: "operating",
  PAYROLL: "operating",
  CUSTODY: "operating",
  CUSTODY_SETTLEMENT: "operating",
  SUPPLIER_INVOICE: "operating",
  TREASURY: "other",
};

export async function cashFlow(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const from = startOf(p.from);
  const to = endOf(p.to);
  const ids = await moneyAccountIds(companyIds);
  const idSet = new Set(ids);
  const openingAgg = from
    ? await prisma.journalLine.aggregate({ where: { accountId: { in: ids }, entry: { status: "POSTED", date: { lt: from } } }, _sum: { debit: true, credit: true } })
    : null;
  const opening = openingAgg ? D(openingAgg._sum.debit).minus(D(openingAgg._sum.credit)) : D(0);
  const lines = await prisma.journalLine.findMany({
    where: { accountId: { in: ids }, ...projectFilter, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } },
    include: { entry: { select: { id: true, sourceType: true, sourceId: true } } },
  });
  // Determine flow category per line using entry source + payment type; skip internal transfers (both legs in cash/bank).
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const allLegs = await prisma.journalLine.findMany({ where: { entryId: { in: entryIds } }, select: { entryId: true, accountId: true } });
  const internal = new Set<string>();
  const legsBy = new Map<string, string[]>();
  for (const l of allLegs) legsBy.set(l.entryId, [...(legsBy.get(l.entryId) ?? []), l.accountId]);
  for (const [e, accs] of legsBy) if (accs.every((a) => idSet.has(a))) internal.add(e);
  const paymentIds = lines.filter((l) => l.entry.sourceType === "PAYMENT").map((l) => l.entry.sourceId!).filter(Boolean);
  const payments = await prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, type: true } });
  const payType = new Map(payments.map((x) => [x.id, x.type]));
  const buckets = new Map<string, { inflow: Prisma.Decimal; outflow: Prisma.Decimal }>();
  for (const l of lines) {
    if (internal.has(l.entryId)) continue;
    let key = l.entry.sourceType ?? "MANUAL";
    if (key === "PAYMENT") key = payType.get(l.entry.sourceId!) ?? "PAYMENT";
    if (key.endsWith("_REVERSAL")) key = "REVERSALS";
    const b = buckets.get(key) ?? { inflow: D(0), outflow: D(0) };
    b.inflow = b.inflow.plus(D(l.debit));
    b.outflow = b.outflow.plus(D(l.credit));
    buckets.set(key, b);
  }
  const rows = [...buckets.entries()].map(([k, v]) => ({ source: k, category: CF_CATEGORY[k] ?? "operating", inflow: money(v.inflow), outflow: money(v.outflow), net: money(v.inflow.minus(v.outflow)) }));
  const ti = rows.reduce((s, r) => s + r.inflow, 0);
  const to_ = rows.reduce((s, r) => s + r.outflow, 0);
  return {
    report: "cash-flow",
    columns: [{ key: "source" }, { key: "inflow", type: "money" }, { key: "outflow", type: "money" }, { key: "net", type: "money" }],
    rows,
    totals: { source: "صافي التدفق / Net Cash Flow", inflow: r2(ti).toNumber(), outflow: r2(to_).toNumber(), net: r2(ti - to_).toNumber() },
    meta: { openingCash: money(opening), closingCash: r2(Number(opening) + ti - to_).toNumber() },
  };
}

// ───────────────────────── Receivables / payables ─────────────────────────
function agingBucket(due: Date, asOf: Date) {
  const days = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}
const AGING_COLS: Col[] = [
  { key: "current", type: "money" },
  { key: "d1_30", type: "money" },
  { key: "d31_60", type: "money" },
  { key: "d61_90", type: "money" },
  { key: "d90plus", type: "money" },
  { key: "total", type: "money" },
];

export async function receivables(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const asOf = endOf(p.asOf ?? p.to) ?? new Date();
  const list = await prisma.clientExtract.findMany({
    where: { companyId: { in: companyIds }, status: "POSTED", ...projectFilter },
    include: { client: { select: { name: true } }, project: { select: { code: true, name: true } }, company: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  const byClient = new Map<string, any>();
  for (const e of list) {
    const rem = D(e.netAmount).minus(D(e.paidAmount));
    if (rem.lessThanOrEqualTo(0)) continue;
    const due = new Date(e.date.getTime() + 30 * 86400000);
    const k = e.clientId;
    const r = byClient.get(k) ?? { client: e.client.name, company: e.company.name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    r[agingBucket(due, asOf)] += Number(rem);
    r.total += Number(rem);
    byClient.set(k, r);
  }
  const rows = [...byClient.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? r2(v).toNumber() : v])));
  const totals: any = { client: "الإجمالي / Total" };
  for (const c of AGING_COLS) totals[c.key] = r2(rows.reduce((s, r: any) => s + r[c.key], 0)).toNumber();
  return { report: "receivables", columns: [{ key: "client" }, { key: "company" }, ...AGING_COLS], rows, totals, meta: { asOf, termsDays: 30 } };
}

export async function payables(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const asOf = endOf(p.asOf ?? p.to) ?? new Date();
  const invoices = await prisma.supplierInvoice.findMany({
    where: { companyId: { in: companyIds }, status: "POSTED", ...projectFilter },
    include: { supplier: { select: { name: true } }, company: { select: { name: true } } },
  });
  const byParty = new Map<string, any>();
  for (const i of invoices) {
    const rem = D(i.total).minus(D(i.paidAmount));
    if (rem.lessThanOrEqualTo(0)) continue;
    const r = byParty.get(i.supplierId) ?? { party: i.supplier.name, partyType: "SUPPLIER", company: i.company.name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    r[agingBucket(i.dueDate ?? i.date, asOf)] += Number(rem);
    r.total += Number(rem);
    byParty.set(i.supplierId, r);
  }
  const extracts = await prisma.contractorExtract.findMany({
    where: { companyId: { in: companyIds }, status: "POSTED", ...projectFilter },
    include: { contractor: { select: { name: true } }, company: { select: { name: true } } },
  });
  for (const e of extracts) {
    const rem = D(e.netAmount).minus(D(e.paidAmount));
    if (rem.lessThanOrEqualTo(0)) continue;
    const r = byParty.get(e.contractorId) ?? { party: e.contractor.name, partyType: "CONTRACTOR", company: e.company.name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    r[agingBucket(new Date(e.date.getTime() + 30 * 86400000), asOf)] += Number(rem);
    r.total += Number(rem);
    byParty.set(e.contractorId, r);
  }
  const rows = [...byParty.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? r2(v).toNumber() : v])));
  const totals: any = { party: "الإجمالي / Total" };
  for (const c of AGING_COLS) totals[c.key] = r2(rows.reduce((s, r: any) => s + r[c.key], 0)).toNumber();
  return { report: "payables", columns: [{ key: "party" }, { key: "partyType" }, { key: "company" }, ...AGING_COLS], rows, totals, meta: { asOf } };
}

// ───────────────────────── Project reports ─────────────────────────
const CATS = ["MATERIALS", "LABOR", "EQUIPMENT", "SUBCONTRACTORS", "TRANSPORT", "OTHER"] as const;

export async function projectActuals(projectIds: string[], from?: Date, to?: Date) {
  const lines = await prisma.journalLine.groupBy({
    by: ["projectId", "accountId"],
    where: { projectId: { in: projectIds }, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } },
    _sum: { debit: true, credit: true },
  });
  const accs = await prisma.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } }, select: { id: true, type: true, costCategory: true } });
  const am = new Map(accs.map((a) => [a.id, a]));
  const out = new Map<string, { revenue: Prisma.Decimal; cost: Prisma.Decimal; byCat: Record<string, Prisma.Decimal> }>();
  for (const l of lines) {
    const a = am.get(l.accountId)!;
    const o = out.get(l.projectId!) ?? { revenue: D(0), cost: D(0), byCat: Object.fromEntries(CATS.map((c) => [c, D(0)])) };
    if (a.type === "REVENUE") o.revenue = o.revenue.plus(D(l._sum.credit).minus(D(l._sum.debit)));
    if (a.type === "EXPENSE") {
      const v = D(l._sum.debit).minus(D(l._sum.credit));
      o.cost = o.cost.plus(v);
      const cat = a.costCategory ?? "OTHER";
      o.byCat[cat] = o.byCat[cat].plus(v);
    }
    out.set(l.projectId!, o);
  }
  return out;
}

async function projectsInScope(ctx: Ctx, p: ReportParams) {
  const { companyIds } = scope(ctx, p);
  return prisma.project.findMany({
    where: { companyId: { in: companyIds }, ...(p.projectId ? { id: p.projectId } : ctx.projectIds ? { id: { in: ctx.projectIds } } : {}) },
    include: { company: { select: { name: true } }, client: { select: { name: true } }, budgets: true },
    orderBy: [{ companyId: "asc" }, { code: "asc" }],
  });
}

export async function projectProfitability(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const projects = await projectsInScope(ctx, p);
  const act = await projectActuals(projects.map((x) => x.id), startOf(p.from), endOf(p.to));
  const billed = await prisma.clientExtract.groupBy({ by: ["projectId"], where: { projectId: { in: projects.map((x) => x.id) }, status: "POSTED" }, _sum: { workValue: true, netAmount: true, paidAmount: true } });
  const bm = new Map(billed.map((b) => [b.projectId, b._sum]));
  const rows = projects.map((pr) => {
    const a = act.get(pr.id);
    const rev = a?.revenue ?? D(0);
    const cost = a?.cost ?? D(0);
    const b = bm.get(pr.id);
    const estProfit = D(pr.contractValue).minus(D(pr.budget));
    return {
      company: pr.company.name,
      code: pr.code,
      name: pr.name,
      status: pr.status,
      contractValue: money(pr.contractValue),
      budget: money(pr.budget),
      completionPct: Number(pr.completionPct),
      revenue: money(rev),
      actualCost: money(cost),
      profit: money(rev.minus(cost)),
      margin: rev.isZero() ? 0 : money(rev.minus(cost).div(rev).mul(100)),
      estimatedProfit: money(estProfit),
      billed: money(b?.workValue),
      collected: money(b?.paidAmount),
    };
  });
  const sumk = (k: string) => r2(rows.reduce((s, r: any) => s + r[k], 0)).toNumber();
  return {
    report: "project-profitability",
    columns: [
      { key: "company" }, { key: "code" }, { key: "name" }, { key: "status" },
      { key: "contractValue", type: "money" }, { key: "budget", type: "money" }, { key: "completionPct", type: "pct" },
      { key: "revenue", type: "money" }, { key: "actualCost", type: "money" }, { key: "profit", type: "money" }, { key: "margin", type: "pct" },
      { key: "estimatedProfit", type: "money" }, { key: "billed", type: "money" }, { key: "collected", type: "money" },
    ],
    rows,
    totals: { name: "الإجمالي / Total", contractValue: sumk("contractValue"), budget: sumk("budget"), revenue: sumk("revenue"), actualCost: sumk("actualCost"), profit: sumk("profit"), estimatedProfit: sumk("estimatedProfit"), billed: sumk("billed"), collected: sumk("collected") },
  };
}

export async function projectCost(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const projects = await projectsInScope(ctx, p);
  const act = await projectActuals(projects.map((x) => x.id), startOf(p.from), endOf(p.to));
  const rows = projects.map((pr) => {
    const a = act.get(pr.id);
    const r: any = { company: pr.company.name, code: pr.code, name: pr.name };
    for (const c of CATS) r[c] = money(a?.byCat[c] ?? 0);
    r.total = money(a?.cost ?? 0);
    return r;
  });
  const totals: any = { name: "الإجمالي / Total" };
  for (const c of [...CATS, "total"]) totals[c] = r2(rows.reduce((s, r) => s + r[c], 0)).toNumber();
  return { report: "project-cost", columns: [{ key: "company" }, { key: "code" }, { key: "name" }, ...CATS.map((c) => ({ key: c, type: "money" as const })), { key: "total", type: "money" }], rows, totals };
}

export async function budgetVsActual(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const projects = await projectsInScope(ctx, p);
  const act = await projectActuals(projects.map((x) => x.id), startOf(p.from), endOf(p.to));
  const rows: any[] = [];
  for (const pr of projects) {
    const a = act.get(pr.id);
    for (const c of CATS) {
      const budget = D(pr.budgets.find((b) => b.category === c)?.amount);
      const actual = a?.byCat[c] ?? D(0);
      if (budget.isZero() && actual.isZero()) continue;
      const variance = budget.minus(actual);
      rows.push({
        project: `${pr.code} - ${pr.name}`,
        projectId: pr.id,
        category: c,
        budget: money(budget),
        actual: money(actual),
        variance: money(variance),
        variancePct: budget.isZero() ? 0 : money(variance.div(budget).mul(100)),
        consumedPct: budget.isZero() ? 0 : money(actual.div(budget).mul(100)),
        overBudget: actual.greaterThan(budget),
      });
    }
  }
  const sumk = (k: string) => r2(rows.reduce((s, r) => s + r[k], 0)).toNumber();
  return {
    report: "budget-vs-actual",
    columns: [{ key: "project" }, { key: "category" }, { key: "budget", type: "money" }, { key: "actual", type: "money" }, { key: "variance", type: "money" }, { key: "variancePct", type: "pct" }, { key: "consumedPct", type: "pct" }],
    rows,
    totals: { project: "الإجمالي / Total", budget: sumk("budget"), actual: sumk("actual"), variance: sumk("variance") },
  };
}

// ───────────────────────── Party statements ─────────────────────────
async function partyStatement(ctx: Ctx, p: ReportParams, partyType: "CONTRACTOR" | "SUPPLIER" | "CLIENT", keys: string[], creditPositive: boolean) {
  if (!p.partyId) throw badRequest("partyId is required");
  const party: any =
    partyType === "CONTRACTOR"
      ? await prisma.contractor.findUnique({ where: { id: p.partyId } })
      : partyType === "SUPPLIER"
        ? await prisma.supplier.findUnique({ where: { id: p.partyId } })
        : await prisma.client.findUnique({ where: { id: p.partyId } });
  if (!party) throw notFound();
  assertCompany(ctx, party.companyId);
  const accs = await prisma.account.findMany({ where: { companyId: party.companyId, systemKey: { in: keys } }, select: { id: true } });
  const from = startOf(p.from);
  const to = endOf(p.to);
  const base = { accountId: { in: accs.map((a) => a.id) }, partyType, partyId: party.id };
  let opening = D(0);
  if (from) {
    const o = await prisma.journalLine.aggregate({ where: { ...base, entry: { status: "POSTED", date: { lt: from } } }, _sum: { debit: true, credit: true } });
    opening = creditPositive ? D(o._sum.credit).minus(D(o._sum.debit)) : D(o._sum.debit).minus(D(o._sum.credit));
  }
  const lines = await prisma.journalLine.findMany({
    where: { ...base, entry: { status: "POSTED", ...(dateRange(from, to) ? { date: dateRange(from, to) } : {}) } },
    include: { entry: { select: { number: true, date: true, description: true, sourceType: true, sourceId: true } }, account: { select: { code: true, name: true } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
  });
  // Resolve source document numbers
  const srcIds = lines.map((l) => l.entry.sourceId).filter(Boolean) as string[];
  const docNums = new Map<string, string>();
  const [ce, cle, si, pay] = await Promise.all([
    prisma.contractorExtract.findMany({ where: { id: { in: srcIds } }, select: { id: true, number: true } }),
    prisma.clientExtract.findMany({ where: { id: { in: srcIds } }, select: { id: true, number: true } }),
    prisma.supplierInvoice.findMany({ where: { id: { in: srcIds } }, select: { id: true, number: true } }),
    prisma.payment.findMany({ where: { id: { in: srcIds } }, select: { id: true, number: true } }),
  ]);
  for (const x of [...ce, ...cle, ...si, ...pay]) docNums.set(x.id, x.number);
  let bal = opening;
  const rows = lines.map((l) => {
    bal = creditPositive ? bal.plus(D(l.credit)).minus(D(l.debit)) : bal.plus(D(l.debit)).minus(D(l.credit));
    return {
      date: l.entry.date,
      docNumber: (l.entry.sourceId && docNums.get(l.entry.sourceId)) || l.entry.number,
      entryNumber: l.entry.number,
      description: l.description || l.entry.description,
      account: l.account.name,
      debit: money(l.debit),
      credit: money(l.credit),
      balance: money(bal),
    };
  });
  return { party, opening, rows, balance: bal };
}

export async function contractorStatement(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const s = await partyStatement(ctx, p, "CONTRACTOR", ["AP_CONTRACTORS", "CONTRACTOR_ADVANCES"], true);
  const ex = await prisma.contractorExtract.aggregate({ where: { contractorId: s.party.id, status: "POSTED" }, _sum: { currentGross: true, netAmount: true, paidAmount: true, retentionAmount: true, taxAmount: true, insuranceAmount: true, advanceRecovery: true } });
  const adv = await prisma.payment.aggregate({ where: { contractorId: s.party.id, status: "POSTED", type: "CONTRACTOR_ADVANCE" }, _sum: { amount: true } });
  const td = s.rows.reduce((a, r) => a + r.debit, 0);
  const tc = s.rows.reduce((a, r) => a + r.credit, 0);
  return {
    report: "contractor-statement",
    columns: [{ key: "date", type: "date" }, { key: "docNumber" }, { key: "description" }, { key: "debit", type: "money" }, { key: "credit", type: "money" }, { key: "balance", type: "money" }],
    rows: s.rows,
    totals: { description: "الإجمالي / Total", debit: r2(td).toNumber(), credit: r2(tc).toNumber(), balance: money(s.balance) },
    meta: {
      party: { code: s.party.code, name: s.party.name },
      opening: money(s.opening),
      totalExtractsGross: money(ex._sum.currentGross),
      totalExtractsNet: money(ex._sum.netAmount),
      totalPaid: money(ex._sum.paidAmount),
      advancesPaid: money(adv._sum.amount),
      advancesRecovered: money(ex._sum.advanceRecovery),
      retentionHeld: money(ex._sum.retentionAmount),
      taxWithheld: money(ex._sum.taxAmount),
      insuranceWithheld: money(ex._sum.insuranceAmount),
      remaining: money(D(ex._sum.netAmount).minus(D(ex._sum.paidAmount))),
      balance: money(s.balance),
    },
  };
}

export async function supplierStatement(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const s = await partyStatement(ctx, p, "SUPPLIER", ["AP_SUPPLIERS"], true);
  const td = s.rows.reduce((a, r) => a + r.debit, 0);
  const tc = s.rows.reduce((a, r) => a + r.credit, 0);
  return {
    report: "supplier-statement",
    columns: [{ key: "date", type: "date" }, { key: "docNumber" }, { key: "description" }, { key: "debit", type: "money" }, { key: "credit", type: "money" }, { key: "balance", type: "money" }],
    rows: s.rows,
    totals: { description: "الإجمالي / Total", debit: r2(td).toNumber(), credit: r2(tc).toNumber(), balance: money(s.balance) },
    meta: { party: { code: s.party.code, name: s.party.name }, opening: money(s.opening), balance: money(s.balance) },
  };
}

export async function clientStatement(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const s = await partyStatement(ctx, p, "CLIENT", ["AR", "RETENTION_RECEIVABLE"], false);
  const td = s.rows.reduce((a, r) => a + r.debit, 0);
  const tc = s.rows.reduce((a, r) => a + r.credit, 0);
  return {
    report: "client-statement",
    columns: [{ key: "date", type: "date" }, { key: "docNumber" }, { key: "description" }, { key: "account" }, { key: "debit", type: "money" }, { key: "credit", type: "money" }, { key: "balance", type: "money" }],
    rows: s.rows,
    totals: { description: "الإجمالي / Total", debit: r2(td).toNumber(), credit: r2(tc).toNumber(), balance: money(s.balance) },
    meta: { party: { code: s.party.code, name: s.party.name }, opening: money(s.opening), balance: money(s.balance) },
  };
}

// ───────────────────────── Extract / retention / advances ─────────────────────────
export async function contractorExtractsReport(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const list = await prisma.contractorExtract.findMany({
    where: { companyId: { in: companyIds }, ...projectFilter, status: { not: "CANCELLED" }, ...(dateRange(startOf(p.from), endOf(p.to)) ? { date: dateRange(startOf(p.from), endOf(p.to)) } : {}) },
    include: { contractor: { select: { name: true } }, project: { select: { code: true } }, contract: { select: { number: true } } },
    orderBy: [{ date: "asc" }],
  });
  const rows = list.map((e) => ({
    number: e.number, date: e.date, contractor: e.contractor.name, contract: e.contract.number, project: e.project.code, status: e.status,
    cumulativeGross: money(e.cumulativeGross), previousGross: money(e.previousGross), currentGross: money(e.currentGross),
    retentionAmount: money(e.retentionAmount), advanceRecovery: money(e.advanceRecovery), taxAmount: money(e.taxAmount), insuranceAmount: money(e.insuranceAmount), otherDeductions: money(e.otherDeductions),
    netAmount: money(e.netAmount), paidAmount: money(e.paidAmount), remaining: money(D(e.netAmount).minus(D(e.paidAmount))),
  }));
  const keys = ["currentGross", "retentionAmount", "advanceRecovery", "taxAmount", "insuranceAmount", "otherDeductions", "netAmount", "paidAmount", "remaining"];
  const totals: any = { number: "الإجمالي / Total" };
  for (const k of keys) totals[k] = r2(rows.reduce((s, r: any) => s + r[k], 0)).toNumber();
  return {
    report: "contractor-extracts",
    columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "contractor" }, { key: "contract" }, { key: "project" }, { key: "status" }, ...["cumulativeGross", "previousGross", ...keys].map((k) => ({ key: k, type: "money" as const }))],
    rows,
    totals,
  };
}

export async function clientExtractsReport(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const list = await prisma.clientExtract.findMany({
    where: { companyId: { in: companyIds }, ...projectFilter, status: { not: "CANCELLED" }, ...(dateRange(startOf(p.from), endOf(p.to)) ? { date: dateRange(startOf(p.from), endOf(p.to)) } : {}) },
    include: { client: { select: { name: true } }, project: { select: { code: true } } },
    orderBy: [{ date: "asc" }],
  });
  const rows = list.map((e) => ({
    number: e.number, date: e.date, client: e.client.name, project: e.project.code, status: e.status,
    cumulativeWork: money(e.cumulativeWork), workValue: money(e.workValue), retentionAmount: money(e.retentionAmount), taxAmount: money(e.taxAmount), insuranceAmount: money(e.insuranceAmount), otherDeductions: money(e.otherDeductions),
    netAmount: money(e.netAmount), paidAmount: money(e.paidAmount), remaining: money(D(e.netAmount).minus(D(e.paidAmount))),
  }));
  const keys = ["workValue", "retentionAmount", "taxAmount", "insuranceAmount", "otherDeductions", "netAmount", "paidAmount", "remaining"];
  const totals: any = { number: "الإجمالي / Total" };
  for (const k of keys) totals[k] = r2(rows.reduce((s, r: any) => s + r[k], 0)).toNumber();
  return { report: "client-extracts", columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "client" }, { key: "project" }, { key: "status" }, { key: "cumulativeWork", type: "money" }, ...keys.map((k) => ({ key: k, type: "money" as const }))], rows, totals };
}

export async function retentionReport(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const con = await prisma.contractorExtract.groupBy({ by: ["contractorId", "contractId"], where: { companyId: { in: companyIds }, ...projectFilter, status: "POSTED" }, _sum: { retentionAmount: true, currentGross: true } });
  const cli = await prisma.clientExtract.groupBy({ by: ["clientId", "projectId"], where: { companyId: { in: companyIds }, ...projectFilter, status: "POSTED" }, _sum: { retentionAmount: true, workValue: true } });
  const [contractors, contracts, clients, projects] = await Promise.all([
    prisma.contractor.findMany({ where: { id: { in: con.map((c) => c.contractorId) } }, select: { id: true, name: true } }),
    prisma.subContract.findMany({ where: { id: { in: con.map((c) => c.contractId) } }, select: { id: true, number: true, retentionPct: true } }),
    prisma.client.findMany({ where: { id: { in: cli.map((c) => c.clientId) } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: cli.map((c) => c.projectId) } }, select: { id: true, code: true, clientRetentionPct: true } }),
  ]);
  const nm = new Map<string, any>([...contractors, ...contracts, ...clients, ...projects].map((x: any) => [x.id, x]));
  const rows = [
    ...con.map((c) => ({ direction: "PAYABLE", party: nm.get(c.contractorId)?.name, reference: nm.get(c.contractId)?.number, pct: Number(nm.get(c.contractId)?.retentionPct ?? 0), workValue: money(c._sum.currentGross), retention: money(c._sum.retentionAmount) })),
    ...cli.map((c) => ({ direction: "RECEIVABLE", party: nm.get(c.clientId)?.name, reference: nm.get(c.projectId)?.code, pct: Number(nm.get(c.projectId)?.clientRetentionPct ?? 0), workValue: money(c._sum.workValue), retention: money(c._sum.retentionAmount) })),
  ];
  const pay = rows.filter((r) => r.direction === "PAYABLE").reduce((s, r) => s + r.retention, 0);
  const rec = rows.filter((r) => r.direction === "RECEIVABLE").reduce((s, r) => s + r.retention, 0);
  return {
    report: "retention",
    columns: [{ key: "direction" }, { key: "party" }, { key: "reference" }, { key: "pct", type: "pct" }, { key: "workValue", type: "money" }, { key: "retention", type: "money" }],
    rows,
    meta: { retentionPayable: r2(pay).toNumber(), retentionReceivable: r2(rec).toNumber() },
  };
}

export async function advancesReport(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds } = scope(ctx, p);
  const contractors = await prisma.contractor.findMany({ where: { companyId: { in: companyIds } }, include: { company: { select: { name: true } } } });
  const paid = await prisma.payment.groupBy({ by: ["contractorId"], where: { companyId: { in: companyIds }, status: "POSTED", type: "CONTRACTOR_ADVANCE" }, _sum: { amount: true } });
  const rec = await prisma.contractorExtract.groupBy({ by: ["contractorId"], where: { companyId: { in: companyIds }, status: "POSTED" }, _sum: { advanceRecovery: true } });
  const custody = await prisma.custody.findMany({ where: { companyId: { in: companyIds }, status: "POSTED" }, include: { employee: { select: { name: true } }, company: { select: { name: true } } } });
  const spent = await prisma.expense.groupBy({ by: ["custodyId"], where: { custodyId: { in: custody.map((c) => c.id) }, status: "POSTED" }, _sum: { amount: true } });
  const pm = new Map(paid.map((x) => [x.contractorId, D(x._sum.amount)]));
  const rm = new Map(rec.map((x) => [x.contractorId, D(x._sum.advanceRecovery)]));
  const sm = new Map(spent.map((x) => [x.custodyId, D(x._sum.amount)]));
  const rows: any[] = [];
  for (const c of contractors) {
    const a = pm.get(c.id) ?? D(0);
    if (a.isZero()) continue;
    const r = rm.get(c.id) ?? D(0);
    rows.push({ type: "CONTRACTOR_ADVANCE", company: c.company.name, party: c.name, reference: c.code, amount: money(a), recovered: money(r), balance: money(a.minus(r)), status: a.minus(r).greaterThan(0) ? "OPEN" : "SETTLED" });
  }
  for (const c of custody) {
    const s = sm.get(c.id) ?? D(0);
    rows.push({ type: "CUSTODY", company: c.company.name, party: c.employee.name, reference: c.number, amount: money(c.amount), recovered: money(s.plus(D(c.returnedAmount))), balance: money(D(c.amount).minus(s).minus(D(c.returnedAmount))), status: c.settlementStatus });
  }
  return {
    report: "advances",
    columns: [{ key: "type" }, { key: "company" }, { key: "party" }, { key: "reference" }, { key: "amount", type: "money" }, { key: "recovered", type: "money" }, { key: "balance", type: "money" }, { key: "status" }],
    rows,
    totals: { party: "الإجمالي / Total", amount: r2(rows.reduce((s, r) => s + r.amount, 0)).toNumber(), recovered: r2(rows.reduce((s, r) => s + r.recovered, 0)).toNumber(), balance: r2(rows.reduce((s, r) => s + r.balance, 0)).toNumber() },
  };
}

export async function expensesReport(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds, projectFilter } = scope(ctx, p);
  const g = await prisma.expense.groupBy({
    by: ["companyId", "projectId", "type"],
    where: { companyId: { in: companyIds }, ...projectFilter, status: "POSTED", ...(dateRange(startOf(p.from), endOf(p.to)) ? { date: dateRange(startOf(p.from), endOf(p.to)) } : {}) },
    _sum: { amount: true },
    _count: true,
  });
  const [companies, projects] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: g.map((x) => x.projectId).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true } }),
  ]);
  const cm = new Map(companies.map((c) => [c.id, c.name]));
  const pm = new Map(projects.map((c) => [c.id, `${c.code} - ${c.name}`]));
  const rows = g.map((x) => ({ company: cm.get(x.companyId), project: x.projectId ? pm.get(x.projectId) : "—", type: x.type, count: x._count, amount: money(x._sum.amount) }));
  return {
    report: "expenses",
    columns: [{ key: "company" }, { key: "project" }, { key: "type" }, { key: "count", type: "number" }, { key: "amount", type: "money" }],
    rows,
    totals: { company: "الإجمالي / Total", count: rows.reduce((s, r) => s + r.count, 0), amount: r2(rows.reduce((s, r) => s + r.amount, 0)).toNumber() },
  };
}

export async function managementSummary(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const { companyIds } = scope(ctx, p);
  const companies = await prisma.company.findMany({ where: { id: { in: companyIds } }, orderBy: { code: "asc" } });
  const rows = [];
  for (const c of companies) {
    const pl = await incomeStatement(ctx, { ...p, companyId: c.id, projectId: undefined });
    const ids = await moneyAccountIds([c.id]);
    const cash = await prisma.journalLine.aggregate({ where: { accountId: { in: ids }, entry: { status: "POSTED", ...(p.to ? { date: { lte: endOf(p.to) } } : {}) } }, _sum: { debit: true, credit: true } });
    const ar = await prisma.clientExtract.aggregate({ where: { companyId: c.id, status: "POSTED" }, _sum: { netAmount: true, paidAmount: true } });
    const apS = await prisma.supplierInvoice.aggregate({ where: { companyId: c.id, status: "POSTED" }, _sum: { total: true, paidAmount: true } });
    const apC = await prisma.contractorExtract.aggregate({ where: { companyId: c.id, status: "POSTED" }, _sum: { netAmount: true, paidAmount: true } });
    const projects = await prisma.project.groupBy({ by: ["status"], where: { companyId: c.id }, _count: true });
    rows.push({
      company: c.name,
      revenue: pl.meta!.revenue,
      expenses: pl.meta!.expenses,
      profit: pl.meta!.netProfit,
      margin: pl.meta!.margin,
      cashPosition: money(D(cash._sum.debit).minus(D(cash._sum.credit))),
      receivables: money(D(ar._sum.netAmount).minus(D(ar._sum.paidAmount))),
      payables: money(D(apS._sum.total).minus(D(apS._sum.paidAmount)).plus(D(apC._sum.netAmount)).minus(D(apC._sum.paidAmount))),
      activeProjects: projects.find((x) => x.status === "ACTIVE")?._count ?? 0,
      totalProjects: projects.reduce((s, x) => s + x._count, 0),
    });
  }
  const keys = ["revenue", "expenses", "profit", "cashPosition", "receivables", "payables"];
  const totals: any = { company: "الإجمالي / Total" };
  for (const k of keys) totals[k] = r2(rows.reduce((s, r: any) => s + Number(r[k]), 0)).toNumber();
  totals.activeProjects = rows.reduce((s, r) => s + r.activeProjects, 0);
  totals.totalProjects = rows.reduce((s, r) => s + r.totalProjects, 0);
  return {
    report: "management-summary",
    columns: [{ key: "company" }, ...keys.slice(0, 3).map((k) => ({ key: k, type: "money" as const })), { key: "margin", type: "pct" }, ...keys.slice(3).map((k) => ({ key: k, type: "money" as const })), { key: "activeProjects", type: "number" }, { key: "totalProjects", type: "number" }],
    rows,
    totals,
  };
}

export const REPORTS: Record<string, (ctx: Ctx, p: ReportParams) => Promise<ReportResult>> = {
  "trial-balance": trialBalance,
  "general-ledger": generalLedger,
  "income-statement": incomeStatement,
  "balance-sheet": balanceSheet,
  "cash-flow": cashFlow,
  receivables,
  payables,
  "project-profitability": projectProfitability,
  "project-cost": projectCost,
  "budget-vs-actual": budgetVsActual,
  "contractor-statement": contractorStatement,
  "supplier-statement": supplierStatement,
  "client-statement": clientStatement,
  "contractor-extracts": contractorExtractsReport,
  "client-extracts": clientExtractsReport,
  retention: retentionReport,
  advances: advancesReport,
  expenses: expensesReport,
  "management-summary": managementSummary,
};
