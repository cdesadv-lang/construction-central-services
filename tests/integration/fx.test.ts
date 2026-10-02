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
  cashId = (await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" } })).id;
});

describe("multi-currency", () => {
  it("bank accounts show the balance in their own currency and in EGP", async () => {
    const r = await list(cfo, "bank-accounts", `companyId=${nileId}`);
    const usd = r.items.find((b: any) => b.id === usdBankId);
    const gl = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: usdBankId } })).accountId;
    const lines = await prisma.journalLine.findMany({ where: { accountId: gl, entry: { status: "POSTED" } } });
    const fx = lines.reduce((s, l) => s + (Number(l.debit) > 0 ? 1 : -1) * Number(l.fxAmount), 0);
    const base = lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(lines.every((l) => l.currency === "USD")).toBe(true);
    expect(Number(usd.fxBalance)).toBeCloseTo(fx, 2);
    expect(Number(usd.balance)).toBeCloseTo(base, 2);
    expect(fx).toBeGreaterThan(48_000); // 60,000 capital - 12,000 import + USD receipts - USD payments
  });

  it("paying a USD invoice at a later rate posts the realized FX difference", async () => {
    const pay = await prisma.payment.findFirstOrThrow({ where: { companyId: nileId, currency: "USD", type: "SUPPLIER_PAYMENT" } });
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

  it("USD subcontract extracts are issued in USD; payments must be USD and post realized FX", async () => {
    const sc = await prisma.subContract.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } });
    const ex = await prisma.contractorExtract.findFirstOrThrow({ where: { contractId: sc.id, status: "POSTED" } });
    expect(ex.currency).toBe("USD");
    expect(Number(ex.currentGross)).toBe(30_000);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "CONTRACTOR_EXTRACT", sourceId: ex.id }, include: { lines: true } });
    expect(je.currency).toBe("USD");
    expect(Number(je.totalDebit)).toBeCloseTo(30_000 * Number(ex.exchangeRate), 2);
    expect(je.lines.every((l) => l.currency === "USD")).toBe(true);
    // contract currency cannot change once extracts exist
    await expectApiError((await import("../helpers")).update(acc, "subcontracts", sc.id, { currency: "EGP" }), 422);
    // an EGP payment against a USD extract is rejected
    const bad = await create(acc, "payments", { companyId: nileId, type: "CONTRACTOR_PAYMENT", date: "2026-09-20", amount: 100, method: "BANK", bankAccountId: egpBankId, contractorExtractId: ex.id });
    await expectApiError(submitApprovePost(acc, "payments", bad.id), 422);
    // the seeded USD payment (Sep rate) settles the payable at the extract rate (Aug) -> realized FX gain
    const pay = await prisma.payment.findFirstOrThrow({ where: { contractorExtractId: ex.id, status: "POSTED" } });
    const pl = await prisma.journalLine.findMany({ where: { entryId: pay.journalEntryId! } });
    const ap = await accountIdByKey(prisma, nileId, "AP_CONTRACTORS");
    const apLine = pl.find((l) => l.accountId === ap)!;
    expect(Number(apLine.debit)).toBeCloseTo(Number(pay.amount) * Number(ex.exchangeRate), 2);
    const fxAcc = await accountIdByKey(prisma, nileId, "FX_DIFFERENCES");
    const diff = pl.find((l) => l.accountId === fxAcc)!;
    expect(Number(diff.credit)).toBeCloseTo(Number(pay.amount) * (Number(ex.exchangeRate) - Number(pay.exchangeRate)), 2);
  });

  it("USD-billed project: client extract in USD and its receipt clear the receivable in both currencies", async () => {
    const pr = await prisma.project.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } });
    const ce = await prisma.clientExtract.findFirstOrThrow({ where: { projectId: pr.id } });
    expect(ce.currency).toBe("USD");
    const ar = await accountIdByKey(prisma, nileId, "AR");
    const lines = await prisma.journalLine.findMany({ where: { accountId: ar, currency: "USD", entry: { status: "POSTED", companyId: nileId } } });
    expect(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2);
    expect(lines.reduce((s, l) => s + (Number(l.debit) > 0 ? 1 : -1) * Number(l.fxAmount), 0)).toBeCloseTo(0, 2);
    // a new extract can override the rate
    const ex2 = await create(acc, "client-extracts", { companyId: nileId, projectId: pr.id, date: "2026-09-25", periodFrom: "2026-08-21", periodTo: "2026-09-25", cumulativeWork: 260_000, exchangeRate: 48.5 });
    expect(ex2.currency).toBe("USD");
    expect(Number(ex2.exchangeRate)).toBe(48.5);
  });

  it("USD custody: needs a USD cash box; expenses in the custody currency at the custody rate", async () => {
    const usdCash = await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" } });
    const emp = await prisma.employee.findFirstOrThrow({ where: { companyId: nileId } });
    const bad = await create(acc, "custodies", { companyId: nileId, employeeId: emp.id, amount: 100, currency: "USD", date: "2026-09-02", purpose: "x", cashBoxId: cashId });
    await expectApiError(submitApprovePost(acc, "custodies", bad.id), 422);
    const cu = await create(acc, "custodies", { companyId: nileId, employeeId: emp.id, amount: 300, currency: "USD", date: "2026-09-02", purpose: "fx custody", cashBoxId: usdCash.id });
    await submitApprovePost(acc, "custodies", cu.id);
    const rate = Number((await prisma.custody.findUniqueOrThrow({ where: { id: cu.id } })).exchangeRate);
    // an expense dated later still uses the custody rate and the custody currency
    const e = await create(acc, "expenses", { companyId: nileId, type: "OTHER", date: "2026-09-20", amount: 120, paymentMethod: "CUSTODY", custodyId: cu.id, description: "fx custody exp" });
    expect(e.currency).toBe("USD");
    expect(Number(e.exchangeRate)).toBe(rate);
    await submitApprovePost(acc, "expenses", e.id);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "EXPENSE", sourceId: e.id } });
    expect(Number(je.totalDebit)).toBeCloseTo(120 * rate, 2);
    await act(cfo, "custodies", cu.id, "settle");
    const after = await prisma.custody.findUniqueOrThrow({ where: { id: cu.id } });
    expect(after.settlementStatus).toBe("SETTLED");
    const custAcc = await accountIdByKey(prisma, nileId, "CUSTODY");
    const cl = await prisma.journalLine.findMany({ where: { accountId: custAcc, partyId: emp.id, currency: "USD", entry: { status: "POSTED", OR: [{ sourceId: cu.id }, { sourceId: e.id }] } } });
    expect(cl.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2);
  });

  it("payroll runs per salary currency; statutory deductions are computed on the EGP equivalent", async () => {
    const usdPr = await prisma.payroll.findFirstOrThrow({ where: { companyId: nileId, currency: "USD" }, include: { lines: true } });
    const cur = async (ids: string[]) => (await prisma.employee.findMany({ where: { id: { in: ids } } })).map((e) => e.salaryCurrency);
    expect(usdPr.lines.length).toBe(1);
    expect(await cur(usdPr.lines.map((l) => l.employeeId))).toEqual(["USD"]);
    const egpPr = await prisma.payroll.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP", month: "2026-08" }, include: { lines: true } });
    expect((await cur(egpPr.lines.map((l) => l.employeeId))).every((c) => c === "EGP")).toBe(true);
    const l = usdPr.lines[0];
    expect(Number(l.gross)).toBe(3_500);
    // tax on 3,500 USD x rate is far above the EGP brackets' lower bands: effective rate between 15% and 27.5%
    const effective = Number(l.tax) / Number(l.gross);
    expect(effective).toBeGreaterThan(0.15);
    expect(effective).toBeLessThan(0.275);
    expect(Number(l.net)).toBeCloseTo(Number(l.gross) - Number(l.deductions) - Number(l.insurance) - Number(l.tax), 2);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "PAYROLL", sourceId: usdPr.id }, include: { lines: true } });
    expect(je.lines.every((x) => x.currency === "USD")).toBe(true);
    expect(Number(je.totalDebit)).toBeCloseTo((Number(usdPr.totalGross) + usdPr.lines.reduce((s, x) => s + Number(x.companyInsurance), 0)) * Number(usdPr.exchangeRate), -1);
    // a second USD payroll for the month is rejected (employee already paid); another currency has nobody
    const hr = await ctxFor("hr@ccs.local");
    await expectApiError(create(hr, "payrolls", { companyId: nileId, month: "2026-08", currency: "USD" }), 422);
    await expectApiError(create(hr, "payrolls", { companyId: nileId, month: "2026-09", currency: "EUR" }), 422);
  });

  it("manual journal entries in USD are balanced in USD and converted at the rate", async () => {
    const exp = await accountIdByKey(prisma, nileId, "COST_EQUIPMENT");
    const bank = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: usdBankId } })).accountId;
    await expectApiError(create(acc, "journal-entries", { companyId: nileId, date: "2026-09-12", currency: "USD", description: "x", lines: [{ accountId: exp, debit: 10 }, { accountId: bank, credit: 9 }] }), 422);
    const je = await create(acc, "journal-entries", { companyId: nileId, date: "2026-09-12", currency: "USD", exchangeRate: 48.123457, description: "usd je", lines: [{ accountId: exp, debit: 33.33 }, { accountId: exp, debit: 33.33 }, { accountId: bank, credit: 66.66 }] });
    const full = await prisma.journalEntry.findUniqueOrThrow({ where: { id: je.id }, include: { lines: true } });
    expect(full.currency).toBe("USD");
    expect(Number(full.totalDebit)).toBe(Number(full.totalCredit)); // still balanced in EGP after rounding
    expect(Number(full.totalDebit)).toBeCloseTo(66.66 * 48.123457, 1);
    expect(full.lines.every((l) => l.currency === "USD" && Number(l.fxAmount) > 0)).toBe(true);
  });
});
