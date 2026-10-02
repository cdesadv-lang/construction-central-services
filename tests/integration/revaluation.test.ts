/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { accountIdByKey } from "@/server/services/accounting";
import { computeRevaluation } from "@/server/services/revaluation";
import { act, company, create, ctxFor, expectApiError, ledgerBalance, list } from "../helpers";

let chief: Ctx, acc: Ctx, nileId: string, fxAcc: string, usdBankGl: string;

const fxBal = async (accountId: string) => {
  const ls = await prisma.journalLine.findMany({ where: { accountId, entry: { status: "POSTED" } } });
  return ls.reduce((s, l) => s + (Number(l.debit) > 0 ? 1 : -1) * Number(l.fxAmount ?? 0), 0);
};

beforeAll(async () => {
  chief = await ctxFor("chief@ccs.local");
  acc = await ctxFor("acc.nile@ccs.local");
  nileId = (await company("NILE")).id;
  fxAcc = await accountIdByKey(prisma, nileId, "FX_UNREALIZED");
  usdBankGl = (await prisma.bankAccount.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } })).accountId;
});

describe("FX revaluation", () => {
  it("seeded month-end revaluations are posted and auto-reversed the next day (net zero)", async () => {
    const rows = await prisma.fxRevaluation.findMany({ where: { companyId: nileId }, orderBy: { date: "asc" } });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-08-31", "2026-09-30"]);
    for (const r of rows) {
      expect(r.status).toBe("REVERSED");
      const [je, rev] = await Promise.all([prisma.journalEntry.findUniqueOrThrow({ where: { id: r.journalEntryId! } }), prisma.journalEntry.findUniqueOrThrow({ where: { id: r.reversalEntryId! } })]);
      expect(je.sourceType).toBe("FX_REVALUATION");
      expect(rev.reversalOfId).toBe(je.id);
      expect(rev.date.getTime() - je.date.getTime()).toBe(86_400_000);
    }
    expect(await ledgerBalance(fxAcc)).toBeCloseTo(0, 2);
  });

  it("previews bucket adjustments at the closing rate; posting moves EGP values but not currency balances", async () => {
    const date = new Date("2026-10-01T00:00:00Z");
    const before = await computeRevaluation(prisma, nileId, date, { USD: 47 });
    expect(before.rates.USD).toBe(47);
    expect(before.lines.length).toBeGreaterThan(0);
    const bankLine = before.lines.find((l) => l.accountId === usdBankGl)!;
    expect(bankLine.revalued).toBeCloseTo(bankLine.fxBalance * 47, 2);
    expect(bankLine.adjustment).toBeCloseTo(bankLine.revalued - bankLine.bookValue, 2);
    // liabilities (AP) gain when the currency weakens, assets lose
    const ap = await accountIdByKey(prisma, nileId, "AP_CONTRACTORS");
    const apLine = before.lines.find((l) => l.accountId === ap);
    if (apLine) expect(apLine.adjustment).toBeGreaterThan(0);
    expect(bankLine.adjustment).toBeLessThan(0);
    // accountant cannot post a revaluation (needs accounting:approve)
    await expectApiError(create(acc, "fx-revaluations", { companyId: nileId, date: "2026-10-01", rates: { USD: 47 } }), 403);
    const fx0 = await fxBal(usdBankGl);
    const row = await create(chief, "fx-revaluations", { companyId: nileId, date: "2026-10-01", rates: { USD: 47 }, autoReverse: false });
    expect(row.status).toBe("POSTED");
    expect(Number(row.totalGain)).toBeCloseTo(before.totalGain, 2);
    expect(await fxBal(usdBankGl)).toBeCloseTo(fx0, 2);
    expect(await ledgerBalance(usdBankGl)).toBeCloseTo(bankLine.revalued, 2);
    expect(await ledgerBalance(fxAcc)).toBeCloseTo(-before.totalGain, 2);
    // after posting, nothing is left to revalue at the same rate
    expect((await computeRevaluation(prisma, nileId, date, { USD: 47 })).lines.length).toBe(0);
    // a new run is blocked until this one is reversed; runs must be chronological
    await expectApiError(create(chief, "fx-revaluations", { companyId: nileId, date: "2026-10-02", rates: { USD: 47.5 } }), 422);
    const listed = await list(chief, "fx-revaluations", `companyId=${nileId}`);
    expect(listed.items.find((r: any) => r.id === row.id).journalEntry.number).toMatch(/^JE/);
    // journal-level reversal of a revaluation entry is refused (use the revaluation's reverse action)
    await expectApiError(act(await ctxFor("cfo@ccs.local"), "journal-entries", row.journalEntryId, "reverse", {}), 422);
    const rev = await act(chief, "fx-revaluations", row.id, "reverse", { date: "2026-10-02" });
    expect(rev.status).toBe("REVERSED");
    expect(await ledgerBalance(fxAcc)).toBeCloseTo(0, 2);
    expect(await ledgerBalance(usdBankGl)).toBeCloseTo(bankLine.bookValue, 2);
    await expectApiError(act(chief, "fx-revaluations", row.id, "reverse", {}), 422);
    await expectApiError(create(chief, "fx-revaluations", { companyId: nileId, date: "2026-09-15" }), 422);
  });
});
