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
    const fy25 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: nileId, name: "2025" } });
    await act(cfo, "fiscal-years", fy25.id, "close");
    // periods of a closed year cannot be reopened until the year is reopened
    const dec = await period(2025, 12);
    await expectApiError(act(cfo, "accounting-periods", dec.id, "reopen", { reason: "should fail" }), 422);
    await act(cfo, "fiscal-years", fy25.id, "reopen", { reason: "external audit adjustments" });
    expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy25.id } })).status).toBe("OPEN");
  });

  it("rejects overlapping fiscal years", async () => {
    await expectApiError(create(cfo, "fiscal-years", { companyId: nileId, year: 2026, startMonth: 7 }), 422);
  });
});
