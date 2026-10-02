import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { accountIdByKey } from "@/server/services/accounting";
import { trialBalance, balanceSheet, incomeStatement, generalLedger } from "@/server/services/reports";
import type { Ctx } from "@/server/context";
import { act, company, create, ctxFor, expectApiError, get, remove, update } from "../helpers";

let acc: Ctx, chief: Ctx, cfo: Ctx, nileId: string;

beforeAll(async () => {
  acc = await ctxFor("acc.nile@ccs.local");
  chief = await ctxFor("chief@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  nileId = (await company("NILE")).id;
});

describe("journal entries — double entry & posting", () => {
  it("rejects an unbalanced entry", async () => {
    const cash = await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId } });
    const rev = await accountIdByKey(prisma, nileId, "OTHER_INCOME");
    await expectApiError(
      create(acc, "journal-entries", { companyId: nileId, date: "2026-09-01", description: "bad", lines: [{ accountId: cash.accountId, debit: 100 }, { accountId: rev, credit: 90 }] }),
      422,
    );
  });

  it("rejects posting to header (non-postable) accounts and foreign-company accounts", async () => {
    const header = await prisma.account.findFirstOrThrow({ where: { companyId: nileId, code: "11" } });
    const rev = await accountIdByKey(prisma, nileId, "OTHER_INCOME");
    await expectApiError(create(acc, "journal-entries", { companyId: nileId, date: "2026-09-01", description: "x", lines: [{ accountId: header.id, debit: 5 }, { accountId: rev, credit: 5 }] }), 422);
    const modern = await company("MODERN");
    const foreign = await accountIdByKey(prisma, modern.id, "OTHER_INCOME");
    await expectApiError(create(acc, "journal-entries", { companyId: nileId, date: "2026-09-01", description: "x", lines: [{ accountId: foreign, debit: 5 }, { accountId: rev, credit: 5 }] }), 400);
  });

  it("draft/approved entries do not affect the ledger; only posted entries do; reversal nets to zero", async () => {
    const cash = await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId }, orderBy: { code: "asc" } });
    const income = await accountIdByKey(prisma, nileId, "OTHER_INCOME");
    const before = await trialBalance(cfo, { companyId: nileId });
    const row = (tb: typeof before, code: string) => tb.rows.find((r) => r.code === code) as Record<string, number> | undefined;
    const incAcc = await prisma.account.findUniqueOrThrow({ where: { id: income } });
    const baseCredit = row(before, incAcc.code)?.periodCredit ?? 0;

    const je = await create(acc, "journal-entries", {
      companyId: nileId, date: "2026-09-10", description: "بيع مخلفات حديد",
      lines: [{ accountId: cash.accountId, debit: 1234.56 }, { accountId: income, credit: 1234.56 }],
    });
    expect(je.status).toBe("DRAFT");
    expect(je.number).toMatch(/^JE-\d{5}$/);
    // edit draft
    const edited = await update(acc, "journal-entries", je.id, { description: "بيع مخلفات حديد - معدل" });
    expect(edited.description).toContain("معدل");

    await act(acc, "journal-entries", je.id, "submit");
    await act(chief, "journal-entries", je.id, "approve");
    let mid = await trialBalance(cfo, { companyId: nileId });
    expect(row(mid, incAcc.code)?.periodCredit ?? 0).toBe(baseCredit); // still pending
    await act(cfo, "journal-entries", je.id, "approve");
    const approved = await get(cfo, "journal-entries", je.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(cfo.user.id);
    mid = await trialBalance(cfo, { companyId: nileId });
    expect(row(mid, incAcc.code)?.periodCredit ?? 0).toBe(baseCredit); // approved but not posted

    await act(cfo, "journal-entries", je.id, "post");
    const after = await trialBalance(cfo, { companyId: nileId });
    expect(row(after, incAcc.code)!.periodCredit).toBeCloseTo(baseCredit + 1234.56, 2);
    expect(after.meta!.balanced).toBe(true);

    // posted entries are immutable
    await expectApiError(update(acc, "journal-entries", je.id, { description: "hack" }), 422);
    await expectApiError(remove(cfo, "journal-entries", je.id), 422);

    // GL shows the line with running balance
    const gl = await generalLedger(cfo, { accountId: income });
    expect(gl.rows.some((r) => r.entryNumber === je.number)).toBe(true);

    await act(cfo, "journal-entries", je.id, "reverse", { reason: "خطأ" });
    const rev = await trialBalance(cfo, { companyId: nileId });
    const r = row(rev, incAcc.code)!;
    expect(r.closingCredit - r.closingDebit).toBeCloseTo((row(before, incAcc.code)?.closingCredit ?? 0) - (row(before, incAcc.code)?.closingDebit ?? 0), 2);
    await expectApiError(act(cfo, "journal-entries", je.id, "reverse"), 422); // cannot reverse twice
  });

  it("trial balance, balance sheet are balanced for every company and consolidated", async () => {
    for (const code of ["NILE", "MODERN", "UNITED"]) {
      const c = await company(code);
      const tb = await trialBalance(cfo, { companyId: c.id });
      expect(tb.meta!.balanced).toBe(true);
      expect(tb.totals!.closingDebit).toBeGreaterThan(0);
      const bs = await balanceSheet(cfo, { companyId: c.id });
      expect(bs.meta!.balanced).toBe(true);
    }
    const all = await trialBalance(cfo, {});
    expect(all.meta!.balanced).toBe(true);
    expect(all.meta!.consolidated).toBe(true);
  });

  it("income statement equals revenue - expenses from posted lines", async () => {
    const is = await incomeStatement(cfo, { companyId: nileId });
    expect(is.meta!.netProfit).toBeCloseTo((is.meta!.revenue as number) - (is.meta!.expenses as number), 2);
    expect(is.meta!.revenue).toBeGreaterThan(0);
  });
});
