// Fiscal years, monthly accounting periods, period locking and the month-end close checklist.
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D } from "@/lib/money";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { audit } from "../audit";
import { requirePerm, type Ctx } from "../context";

const ym = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
export const periodLabel = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Throws 422 if `date` falls in a CLOSED period (or closed fiscal year) of the company. Dates without a defined period are open. */
export async function assertPeriodOpen(tx: Tx, companyId: string, date: Date | string | null | undefined, what = "Transactions") {
  if (!date) return;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return;
  const { year, month } = ym(d);
  const p = await tx.accountingPeriod.findUnique({ where: { companyId_year_month: { companyId, year, month } }, include: { fiscalYear: { select: { status: true, name: true } } } });
  if (!p) return;
  if (p.status === "CLOSED" || p.fiscalYear.status === "CLOSED")
    throw unprocessable(`Accounting period ${periodLabel(year, month)} is closed — ${what.toLowerCase()} dated in it cannot be created, edited or posted. Reopen the period first.`);
}

export async function createFiscalYear(tx: Tx, ctx: Ctx, input: { companyId: string; year: number; startMonth?: number; notes?: string | null }) {
  const startMonth = input.startMonth ?? 1;
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw badRequest("Invalid year");
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw badRequest("startMonth must be 1–12");
  const start = new Date(Date.UTC(input.year, startMonth - 1, 1));
  const end = new Date(Date.UTC(input.year, startMonth - 1 + 12, 0)); // last day of the 12th month
  const overlap = await tx.fiscalYear.findFirst({ where: { companyId: input.companyId, startDate: { lte: end }, endDate: { gte: start } } });
  if (overlap) throw unprocessable(`Overlaps existing fiscal year ${overlap.name}`);
  const name = startMonth === 1 ? String(input.year) : `${input.year}/${input.year + 1}`;
  const fy = await tx.fiscalYear.create({ data: { companyId: input.companyId, name, startDate: start, endDate: end, notes: input.notes ?? null } });
  const periods: Prisma.AccountingPeriodCreateManyInput[] = [];
  for (let i = 0; i < 12; i++) {
    const s = new Date(Date.UTC(input.year, startMonth - 1 + i, 1));
    const e = new Date(Date.UTC(input.year, startMonth + i, 0));
    periods.push({ companyId: input.companyId, fiscalYearId: fy.id, year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, startDate: s, endDate: e });
  }
  await tx.accountingPeriod.createMany({ data: periods });
  // (CREATE is audit-logged by the resource engine)
  return tx.fiscalYear.findUnique({ where: { id: fy.id }, include: { periods: { orderBy: { startDate: "asc" } } } });
}

/** Manual month-end tasks (ticked by users). */
export const MANUAL_ITEMS = [
  { key: "accruals", ar: "قيد المستحقات والمقدمات", en: "Accruals & prepayments booked" },
  { key: "depreciation", ar: "قيد الإهلاك الشهري", en: "Monthly depreciation booked" },
  { key: "inventory", ar: "مطابقة المخزون/المواد بالمواقع", en: "Site materials / inventory count reconciled" },
  { key: "review", ar: "مراجعة قائمة الدخل وميزان المراجعة", en: "P&L and trial balance reviewed" },
] as const;

export interface ChecklistItem {
  key: string;
  ar: string;
  en: string;
  kind: "auto" | "manual";
  blocking: boolean;
  ok: boolean;
  detail?: unknown;
  by?: string | null;
  at?: string | null;
}

const UNPOSTED = ["DRAFT", "PENDING_APPROVAL", "APPROVED"] as const;

export async function periodChecklist(tx: Tx, periodId: string) {
  const p = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
  if (!p) throw notFound();
  const c = p.companyId;
  const range = { gte: p.startDate, lt: new Date(p.endDate.getTime() + 86400000) };
  const st = { in: [...UNPOSTED] as never[] };
  const month = periodLabel(p.year, p.month);
  const [je, exp, pay, inv, cex, clx, trx, cus, pr] = await Promise.all([
    tx.journalEntry.count({ where: { companyId: c, date: range, status: st } }),
    tx.expense.count({ where: { companyId: c, date: range, status: st } }),
    tx.payment.count({ where: { companyId: c, date: range, status: st } }),
    tx.supplierInvoice.count({ where: { companyId: c, date: range, status: st } }),
    tx.contractorExtract.count({ where: { companyId: c, date: range, status: st } }),
    tx.clientExtract.count({ where: { companyId: c, date: range, status: st } }),
    tx.treasuryTransaction.count({ where: { companyId: c, date: range, status: st } }),
    tx.custody.count({ where: { companyId: c, date: range, status: st } }),
    tx.payroll.count({ where: { companyId: c, month, status: st } }),
  ]);
  const unposted = { journalEntries: je, expenses: exp, payments: pay, supplierInvoices: inv, contractorExtracts: cex, clientExtracts: clx, treasury: trx, custodies: cus, payrolls: pr };
  const unpostedTotal = Object.values(unposted).reduce((a, b) => a + b, 0);

  const tb = await tx.journalLine.aggregate({ where: { companyId: c, entry: { status: "POSTED", date: range } }, _sum: { debit: true, credit: true } });
  const tbOk = D(tb._sum.debit).equals(D(tb._sum.credit));

  const prev = await tx.accountingPeriod.findFirst({ where: { companyId: c, startDate: { lt: p.startDate } }, orderBy: { startDate: "desc" } });
  const employees = await tx.employee.count({ where: { companyId: c, status: { not: "TERMINATED" }, hireDate: { lte: p.endDate } } });
  const payrollPosted = await tx.payroll.count({ where: { companyId: c, month, status: "POSTED" } });
  const banks = await tx.bankAccount.findMany({ where: { companyId: c }, select: { id: true, bankName: true, accountNumber: true } });
  const recs = await tx.bankReconciliation.findMany({ where: { companyId: c, statementDate: { gte: p.endDate } }, select: { bankAccountId: true } });
  const recSet = new Set(recs.map((r) => r.bankAccountId));
  const unreconciled = banks.filter((b) => !recSet.has(b.id)).map((b) => `${b.bankName} - ${b.accountNumber}`);
  const chequesDue = await chequesDueInHand(tx, c, new Date(p.endDate.getTime() + 86400000));

  const manual = (p.checklist ?? {}) as Record<string, { done?: boolean; by?: string; at?: string }>;
  const items: ChecklistItem[] = [
    { key: "previous_closed", ar: "الفترة السابقة مقفلة", en: "Previous period is closed", kind: "auto", blocking: true, ok: !prev || prev.status === "CLOSED", detail: prev ? periodLabel(prev.year, prev.month) : null },
    { key: "unposted_documents", ar: "لا توجد مستندات غير مرحلة بتاريخ الفترة", en: "No unposted documents dated in the period", kind: "auto", blocking: true, ok: unpostedTotal === 0, detail: unposted },
    { key: "trial_balance", ar: "ميزان مراجعة الفترة متوازن", en: "Period trial balance is balanced", kind: "auto", blocking: true, ok: tbOk, detail: { debit: D(tb._sum.debit).toFixed(2), credit: D(tb._sum.credit).toFixed(2) } },
    { key: "payroll_posted", ar: "تم ترحيل مسير رواتب الشهر", en: "Payroll for the month is posted", kind: "auto", blocking: false, ok: employees === 0 || payrollPosted > 0, detail: { employees, payrollPosted } },
    { key: "bank_reconciled", ar: "تمت تسوية جميع الحسابات البنكية حتى نهاية الفترة", en: "All bank accounts reconciled to period end", kind: "auto", blocking: false, ok: unreconciled.length === 0, detail: unreconciled },
    { key: "cheques_due", ar: "لا توجد شيكات مستحقة بالحافظة لم تودع", en: "No due cheques left undeposited in hand", kind: "auto", blocking: false, ok: chequesDue === 0, detail: { count: chequesDue } },
    ...MANUAL_ITEMS.map((m) => ({ ...m, kind: "manual" as const, blocking: true, ok: !!manual[m.key]?.done, by: manual[m.key]?.by ?? null, at: manual[m.key]?.at ?? null })),
  ];
  const canClose = p.status === "OPEN" && items.every((i) => !i.blocking || i.ok);
  return { period: p, items, canClose };
}

async function chequesDueInHand(tx: Tx, companyId: string, before: Date) {
  return tx.cheque.count({ where: { companyId, type: "RECEIVED", status: "RECEIVED", dueDate: { lt: before } } });
}

export async function setChecklistItem(tx: Tx, ctx: Ctx, periodId: string, key: string, done: boolean) {
  requirePerm(ctx, "periods", "edit");
  const p = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
  if (!p) throw notFound();
  if (p.status === "CLOSED") throw unprocessable("Period is closed");
  if (!MANUAL_ITEMS.some((m) => m.key === key)) throw badRequest("Unknown checklist item");
  const cl = { ...((p.checklist ?? {}) as Record<string, unknown>), [key]: { done, by: ctx.user.name, at: new Date().toISOString() } };
  const row = await tx.accountingPeriod.update({ where: { id: periodId }, data: { checklist: cl as Prisma.InputJsonValue } });
  await audit(tx, ctx, { action: "CHECKLIST", entity: "AccountingPeriod", entityId: periodId, companyId: p.companyId, after: { key, done } });
  return row;
}

export async function closePeriod(tx: Tx, ctx: Ctx, periodId: string, notes?: string | null) {
  requirePerm(ctx, "periods", "approve");
  const { period: p, items, canClose } = await periodChecklist(tx, periodId);
  if (p.status === "CLOSED") throw unprocessable("Period is already closed");
  if (!canClose) {
    const failing = items.filter((i) => i.blocking && !i.ok).map((i) => i.en);
    throw unprocessable(`Period cannot be closed — open checklist items: ${failing.join("; ")}`);
  }
  const res = await tx.accountingPeriod.updateMany({ where: { id: periodId, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, notes: notes ?? p.notes } });
  if (res.count !== 1) throw unprocessable("Period was modified concurrently");
  await audit(tx, ctx, { action: "CLOSE_PERIOD", entity: "AccountingPeriod", entityId: periodId, companyId: p.companyId, before: { status: "OPEN" }, after: { status: "CLOSED", period: periodLabel(p.year, p.month), checklist: items.map((i) => ({ key: i.key, ok: i.ok })) } });
  return tx.accountingPeriod.findUnique({ where: { id: periodId } });
}

export async function reopenPeriod(tx: Tx, ctx: Ctx, periodId: string, reason: string) {
  requirePerm(ctx, "periods", "approve");
  if (!reason || reason.trim().length < 5) throw badRequest("A reason (at least 5 characters) is required to reopen a period");
  const p = await tx.accountingPeriod.findUnique({ where: { id: periodId }, include: { fiscalYear: true } });
  if (!p) throw notFound();
  if (p.status !== "CLOSED") throw unprocessable("Period is not closed");
  if (p.fiscalYear.status === "CLOSED") throw unprocessable(`Fiscal year ${p.fiscalYear.name} is closed — reopen the fiscal year first`);
  const later = await tx.accountingPeriod.findFirst({ where: { companyId: p.companyId, startDate: { gt: p.startDate }, status: "CLOSED" }, orderBy: { startDate: "desc" } });
  if (later) throw unprocessable(`Later period ${periodLabel(later.year, later.month)} is closed — reopen periods from the latest backwards`);
  await tx.accountingPeriod.update({ where: { id: periodId }, data: { status: "OPEN", reopenedAt: new Date(), reopenedById: ctx.user.id, reopenReason: reason.trim() } });
  await audit(tx, ctx, { action: "REOPEN_PERIOD", entity: "AccountingPeriod", entityId: periodId, companyId: p.companyId, before: { status: "CLOSED" }, after: { status: "OPEN", reason: reason.trim(), period: periodLabel(p.year, p.month) } });
  return tx.accountingPeriod.findUnique({ where: { id: periodId } });
}

export async function closeFiscalYear(tx: Tx, ctx: Ctx, id: string) {
  requirePerm(ctx, "periods", "approve");
  const fy = await tx.fiscalYear.findUnique({ where: { id }, include: { periods: true } });
  if (!fy) throw notFound();
  if (fy.status === "CLOSED") throw unprocessable("Fiscal year is already closed");
  const open = fy.periods.filter((p) => p.status !== "CLOSED");
  if (open.length) throw unprocessable(`Close all periods first (${open.length} still open)`);
  await tx.fiscalYear.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id } });
  await audit(tx, ctx, { action: "CLOSE_YEAR", entity: "FiscalYear", entityId: id, companyId: fy.companyId, after: { status: "CLOSED", name: fy.name } });
  return tx.fiscalYear.findUnique({ where: { id }, include: { periods: { orderBy: { startDate: "asc" } } } });
}

export async function reopenFiscalYear(tx: Tx, ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "periods", "approve");
  if (!reason || reason.trim().length < 5) throw badRequest("A reason (at least 5 characters) is required to reopen a fiscal year");
  const fy = await tx.fiscalYear.findUnique({ where: { id } });
  if (!fy) throw notFound();
  if (fy.status !== "CLOSED") throw unprocessable("Fiscal year is not closed");
  const later = await tx.fiscalYear.findFirst({ where: { companyId: fy.companyId, startDate: { gt: fy.startDate }, status: "CLOSED" } });
  if (later) throw unprocessable(`Later fiscal year ${later.name} is closed — reopen it first`);
  await tx.fiscalYear.update({ where: { id }, data: { status: "OPEN", reopenedAt: new Date(), reopenedById: ctx.user.id, reopenReason: reason.trim() } });
  await audit(tx, ctx, { action: "REOPEN_YEAR", entity: "FiscalYear", entityId: id, companyId: fy.companyId, after: { status: "OPEN", reason: reason.trim() } });
  return tx.fiscalYear.findUnique({ where: { id }, include: { periods: { orderBy: { startDate: "asc" } } } });
}
