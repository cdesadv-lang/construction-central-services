import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { accountIdByKey } from "@/server/services/accounting";
import { act, company, create, ctxFor, expectApiError, get, update } from "../helpers";

let acc: Ctx, chief: Ctx, cfo: Ctx, nileId: string, cashBoxId: string;
const period = (year: number, month: number) => prisma.accountingPeriod.findUniqueOrThrow({ where: { companyId_year_month: { companyId: nileId, year, month } } });

beforeAll(async () => {
  acc = await ctxFor("acc.nile@ccs.local");
  chief = await ctxFor("chief@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  nileId = (await company("NILE")).id;
  cashBoxId = (await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId } })).id;
});

const je = (date: string) => ({
  companyId: nileId, date, description: "period test",
  lines: [{ accountId: "", debit: 100 }, { accountId: "", credit: 100 }],
});

describe("accounting period locking", () => {
  it("seeded periods through 2026-06 are closed", async () => {
    expect((await period(2026, 6)).status).toBe("CLOSED");
    expect((await period(2026, 7)).status).toBe("OPEN");
  });

  it("blocks creating journal entries and documents dated in a closed period", async () => {
    const body = je("2026-03-15");
    body.lines[0].accountId = await accountIdByKey(prisma, nileId, "ADMIN_EXPENSES");
    body.lines[1].accountId = await accountIdByKey(prisma, nileId, "OTHER_INCOME");
    const e = await expectApiError(create(acc, "journal-entries", body), 422);
    expect(e.message).toMatch(/2026-03 is closed/);
    await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-06-30", amount: 10, paymentMethod: "CASH", cashBoxId }), 422);
  });

  it("blocks moving an open draft into a closed period, and editing/deleting documents of a closed period", async () => {
    const draft = await create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-09-10", amount: 10, paymentMethod: "CASH", cashBoxId });
    await expectApiError(update(acc, "expenses", draft.id, { date: "2026-05-01" }), 422);
    const old = await prisma.journalEntry.findFirstOrThrow({ where: { companyId: nileId, status: "POSTED", date: { lt: new Date("2026-07-01") } } });
    // reversing a closed-period entry is allowed: the reversal is dated today (open period)
    expect(old).toBeTruthy();
  });

  it("checklist reports blocking items and close is refused until they pass", async () => {
    const sep = await period(2026, 9);
    const r = await get(cfo, "accounting-periods", sep.id);
    const items = r._extra.checklist as { key: string; ok: boolean; blocking: boolean }[];
    expect(items.find((i) => i.key === "previous_closed")!.ok).toBe(false); // August is open
    expect(items.find((i) => i.key === "unposted_documents")!.ok).toBe(false); // pending September documents
    expect(r._extra.canClose).toBe(false);
    await expectApiError(act(cfo, "accounting-periods", sep.id, "close"), 422);
  });

  it("enforces permissions: chief accountant can tick items but not close; accountant can do neither", async () => {
    const jul = await period(2026, 7);
    await expectApiError(act(acc, "accounting-periods", jul.id, "checklist", { key: "review", done: true }), 403);
    await act(chief, "accounting-periods", jul.id, "checklist", { key: "review", done: true });
    await expectApiError(act(chief, "accounting-periods", jul.id, "close"), 403);
  });

  it("close → posting blocked → reopen needs a reason → posting allowed again; all audit-logged", async () => {
    const jul = await period(2026, 7);
    const unposted = await prisma.expense.findMany({ where: { companyId: nileId, date: { gte: new Date("2026-07-01"), lt: new Date("2026-08-01") }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } } });
    for (const u of unposted) await prisma.expense.update({ where: { id: u.id }, data: { date: new Date("2026-08-15") } });
    for (const key of ["accruals", "depreciation", "inventory", "review"]) await act(chief, "accounting-periods", jul.id, "checklist", { key, done: true });
    const detail = await get(cfo, "accounting-periods", jul.id);
    const blocking = (detail._extra.checklist as { key: string; ok: boolean; blocking: boolean }[]).filter((i) => i.blocking && !i.ok);
    expect(blocking).toEqual([]);
    await act(cfo, "accounting-periods", jul.id, "close", { notes: "July close" });
    await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-07-20", amount: 10, paymentMethod: "CASH", cashBoxId }), 422);
    await expectApiError(act(cfo, "accounting-periods", jul.id, "reopen", { reason: "" }), 400);
    // can't reopen an earlier month while a later one is closed
    await expectApiError(act(cfo, "accounting-periods", (await period(2026, 6)).id, "reopen", { reason: "audit adjustment" }), 422);
    await act(cfo, "accounting-periods", jul.id, "reopen", { reason: "late supplier invoice" });
    const ok = await create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-07-20", amount: 10, paymentMethod: "CASH", cashBoxId });
    expect(ok.id).toBeTruthy();
    const logs = await prisma.auditLog.findMany({ where: { entity: "AccountingPeriod", entityId: jul.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["CHECKLIST", "CLOSE_PERIOD", "REOPEN_PERIOD"]));
    expect((await period(2026, 7)).reopenReason).toBe("late supplier invoice");
  });

  it("fiscal year can only be closed when all its periods are closed", async () => {
    const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: nileId, name: "2026" } });
    await expectApiError(act(cfo, "fiscal-years", fy.id, "close"), 422);
  });

  it("year-end close posts a closing entry (revenue & expenses → retained earnings); reopen reverses it; re-close re-posts", async () => {
    const fy25 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: nileId, name: "2025" } });
    expect(fy25.status).toBe("CLOSED"); // closed by the seed
    expect(fy25.closingEntryId).toBeTruthy();
    const range = { gte: new Date("2025-01-01"), lt: new Date("2026-01-01") };
    const plNet = async (withClosing: boolean) => {
      const a = await prisma.journalLine.aggregate({
        where: { companyId: nileId, account: { type: { in: ["REVENUE", "EXPENSE"] } }, entry: { status: "POSTED", date: range, ...(withClosing ? {} : { AND: [{ OR: [{ sourceType: null }, { sourceType: { notIn: ["YEAR_END_CLOSE", "YEAR_END_CLOSE_REVERSAL"] } }] }] }) } },
        _sum: { debit: true, credit: true },
      });
      return Math.round((Number(a._sum.credit ?? 0) - Number(a._sum.debit ?? 0)) * 100) / 100;
    };
    const profit = await plNet(false);
    expect(profit).not.toBe(0);
    expect(await plNet(true)).toBe(0); // all P&L accounts are zero after the closing entry
    const re = await accountIdByKey(prisma, nileId, "RETAINED_EARNINGS");
    const ce = await prisma.journalEntry.findUniqueOrThrow({ where: { id: fy25.closingEntryId! }, include: { lines: true } });
    expect(ce.sourceType).toBe("YEAR_END_CLOSE");
    expect(ce.date.toISOString().slice(0, 10)).toBe("2025-12-31");
    const reLine = ce.lines.find((l) => l.accountId === re)!;
    expect(Number(reLine.credit) - Number(reLine.debit)).toBeCloseTo(profit, 2);
    // the income statement still shows the year's profit (closing entries are excluded from P&L)
    const is = await (await import("@/server/services/reports")).incomeStatement(cfo, { companyId: nileId, from: "2025-01-01", to: "2025-12-31" });
    expect(Number(is.meta!.netProfit)).toBeCloseTo(profit, 2);
    // the closing entry cannot be reversed by hand
    await expectApiError(act(cfo, "journal-entries", ce.id, "reverse", { reason: "nope" }), 422);
    // periods of a closed year cannot be reopened until the year is reopened
    const dec = await period(2025, 12);
    await expectApiError(act(cfo, "accounting-periods", dec.id, "reopen", { reason: "should fail" }), 422);
    await act(cfo, "fiscal-years", fy25.id, "reopen", { reason: "external audit adjustments" });
    const reopened = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy25.id } });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.closingEntryId).toBeNull();
    const rev = await prisma.journalEntry.findFirstOrThrow({ where: { reversalOfId: ce.id } });
    expect(rev.sourceType).toBe("YEAR_END_CLOSE_REVERSAL");
    expect(rev.date.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(await plNet(true)).toBeCloseTo(profit, 2); // P&L balances are back
    // still: December 2025 itself stays closed, so nothing else can be posted there
    await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2025-12-20", amount: 10, paymentMethod: "CASH", cashBoxId }), 422);
    await act(cfo, "fiscal-years", fy25.id, "close");
    const again = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy25.id } });
    expect(again.status).toBe("CLOSED");
    expect(again.closingEntryId).toBeTruthy();
    expect(again.closingEntryId).not.toBe(ce.id);
    expect(await plNet(true)).toBe(0);
    const logs = await prisma.auditLog.findMany({ where: { entity: "FiscalYear", entityId: fy25.id }, select: { action: true } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["CLOSE_YEAR", "REOPEN_YEAR"]));
  });

  it("rejects documents and journal entries dated outside every fiscal year", async () => {
    const e = await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2024-12-15", amount: 10, paymentMethod: "CASH", cashBoxId }), 422);
    expect(e.message).toMatch(/outside the company's fiscal years/);
    const body = je("2027-01-05");
    body.lines[0].accountId = await accountIdByKey(prisma, nileId, "ADMIN_EXPENSES");
    body.lines[1].accountId = await accountIdByKey(prisma, nileId, "OTHER_INCOME");
    await expectApiError(create(acc, "journal-entries", body), 422);
  });

  it("rejects overlapping fiscal years", async () => {
    await expectApiError(create(cfo, "fiscal-years", { companyId: nileId, year: 2026, startMonth: 7 }), 422);
  });
});
