/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { accountIdByKey } from "@/server/services/accounting";
import { act, company, create, ctxFor, expectApiError, list, submitApprovePost } from "../helpers";

let acc: Ctx, cfo: Ctx, treasury: Ctx, nileId: string, usdBankId: string, egpBankId: string, cashId: string;

beforeAll(async () => {
  acc = await ctxFor("acc.nile@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  treasury = await ctxFor("treasury@ccs.local");
  nileId = (await company("NILE")).id;
  usdBankId = (await prisma.bankAccount.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } })).id;
  egpBankId = (await prisma.bankAccount.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" } })).id;
  cashId = (await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId } })).id;
});

describe("multi-currency", () => {
  it("bank accounts show the balance in their own currency and in EGP", async () => {
    const r = await list(cfo, "bank-accounts", `companyId=${nileId}`);
    const usd = r.items.find((b: any) => b.id === usdBankId);
    expect(Number(usd.fxBalance)).toBe(48_000); // 60,000 received - 12,000 paid
    expect(Number(usd.balance)).toBeCloseTo(60_000 * 48.44 - 12_000 * 48.32, 2);
  });

  it("paying a USD invoice at a later rate posts the realized FX difference", async () => {
    const pay = await prisma.payment.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } });
    const lines = await prisma.journalLine.findMany({ where: { entryId: pay.journalEntryId! } });
    const fxAcc = await accountIdByKey(prisma, nileId, "FX_DIFFERENCES");
    const diff = lines.find((l) => l.accountId === fxAcc)!;
    expect(Number(diff.credit)).toBe(1_440); // 12,000 x (48.44 - 48.32) gain
    expect(lines.filter((l) => l.currency === "USD").length).toBe(2);
  });

  it("takes the latest rate on or before the document date; missing rates are rejected", async () => {
    const e = await create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-09-15", amount: 100, currency: "usd", paymentMethod: "BANK", bankAccountId: usdBankId, description: "fx test" });
    expect(e.currency).toBe("USD");
    const sep = await prisma.exchangeRate.findFirstOrThrow({ where: { companyId: nileId, currency: "USD", date: new Date("2026-09-01") } });
    expect(Number(e.exchangeRate)).toBe(Number(sep.rate));
    await submitApprovePost(acc, "expenses", e.id);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "EXPENSE", sourceId: e.id }, include: { lines: true } });
    expect(Number(je.totalDebit)).toBeCloseTo(100 * Number(sep.rate), 2);
    expect(je.lines.every((l) => l.currency === "USD" && Number(l.fxAmount) === 100)).toBe(true);
    await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-09-15", amount: 100, currency: "GBP", paymentMethod: "BANK", bankAccountId: usdBankId }), 422);
    await expectApiError(create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2024-01-15", amount: 100, currency: "USD", paymentMethod: "BANK", bankAccountId: usdBankId }), 422);
  });

  it("an entered rate overrides the table", async () => {
    const e = await create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-09-16", amount: 10, currency: "USD", exchangeRate: 50, paymentMethod: "BANK", bankAccountId: usdBankId });
    expect(Number(e.exchangeRate)).toBe(50);
  });

  it("cash/bank currency must match the document currency; transfers are same-currency", async () => {
    const e = await create(acc, "expenses", { companyId: nileId, type: "ADMIN", date: "2026-09-15", amount: 100, currency: "USD", paymentMethod: "CASH", cashBoxId: cashId });
    await expectApiError(submitApprovePost(acc, "expenses", e.id), 422);
    const t = await create(treasury, "treasury-transactions", { companyId: nileId, kind: "BANK_TRANSFER", date: "2026-09-15", amount: 100, currency: "USD", bankAccountId: usdBankId, toBankAccountId: egpBankId });
    await expectApiError(submitApprovePost(treasury, "treasury-transactions", t.id), 422);
    const t2 = await create(treasury, "treasury-transactions", { companyId: nileId, kind: "BANK_RECEIPT", date: "2026-09-15", amount: 100, bankAccountId: usdBankId, counterAccountId: await accountIdByKey(prisma, nileId, "OTHER_INCOME") });
    await expectApiError(submitApprovePost(treasury, "treasury-transactions", t2.id), 422); // EGP doc into a USD account
  });

  it("USD cheques keep their rate through the lifecycle and need a USD bank", async () => {
    const ch = await create(treasury, "cheques", { companyId: nileId, number: "FX-1", type: "RECEIVED", amount: 1_000, currency: "USD", issueDate: "2026-09-10", dueDate: "2026-09-20", partyName: "Foreign client", counterAccountId: await accountIdByKey(prisma, nileId, "CLIENT_ADVANCES") });
    expect(ch.currency).toBe("USD");
    await expectApiError(act(treasury, "cheques", ch.id, "deposit", { date: "2026-09-20", bankAccountId: egpBankId }), 422);
    await act(treasury, "cheques", ch.id, "deposit", { date: "2026-09-20", bankAccountId: usdBankId, charges: 5 });
    const mv = await prisma.chequeMovement.findFirstOrThrow({ where: { chequeId: ch.id, toStatus: "DEPOSITED" } });
    const lines = await prisma.journalLine.findMany({ where: { entryId: mv.journalEntryId! } });
    const rate = Number(ch.exchangeRate);
    const bankGl = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: usdBankId } })).accountId;
    const bankDr = lines.filter((l) => l.accountId === bankGl).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(bankDr).toBeCloseTo(995 * rate, 1);
    expect(lines.every((l) => l.currency === "USD")).toBe(true);
  });

  it("exchange rates: per company, EGP rejected, edit needs accounting rights", async () => {
    await expectApiError(create(cfo, "exchange-rates", { companyId: nileId, currency: "EGP", date: "2026-10-01", rate: 1 }), 400);
    const r = await create(cfo, "exchange-rates", { companyId: nileId, currency: "GBP", date: "2026-10-01", rate: 64.25, source: "test" });
    expect(Number(r.rate)).toBe(64.25);
    await expectApiError(create(await ctxFor("hr@ccs.local"), "exchange-rates", { companyId: nileId, currency: "GBP", date: "2026-10-02", rate: 64 }), 403);
  });
});
