import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { accountIdByKey } from "@/server/services/accounting";
import { act, company, create, ctxFor, expectApiError, get, ledgerBalance, submitApprovePost } from "../helpers";

let treasury: Ctx, acc: Ctx, nileId: string;
let bank: { id: string; accountId: string };
let K: Record<string, string>;
let client: { id: string; name: string };
let supplier: { id: string; name: string };
let n = 0;
const num = () => String(4400000 + Date.now() % 100000 + n++);

beforeAll(async () => {
  treasury = await ctxFor("treasury@ccs.local");
  acc = await ctxFor("acc.nile@ccs.local");
  nileId = (await company("NILE")).id;
  bank = await prisma.bankAccount.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" }, orderBy: { code: "asc" } });
  K = {};
  for (const k of ["AR", "AP_SUPPLIERS", "NOTES_RECEIVABLE", "NOTES_PAYABLE", "CHEQUES_UNDER_COLLECTION", "BANK_CHARGES"]) K[k] = await accountIdByKey(prisma, nileId, k);
  client = await prisma.client.findFirstOrThrow({ where: { companyId: nileId } });
  supplier = await prisma.supplier.findFirstOrThrow({ where: { companyId: nileId } });
});

const received = (amount: number, extra: Record<string, unknown> = {}) =>
  create(treasury, "cheques", { companyId: nileId, number: num(), type: "RECEIVED", amount, issueDate: "2026-09-01", dueDate: "2026-09-05", partyName: client.name, partyType: "CLIENT", partyId: client.id, counterAccountId: K.AR, ...extra });

describe("cheque lifecycle", () => {
  it("received → under collection → cleared posts NR, collection and bank entries (+ charges)", async () => {
    const [nr0, uc0, bk0, ar0, ch0] = await Promise.all([ledgerBalance(K.NOTES_RECEIVABLE), ledgerBalance(K.CHEQUES_UNDER_COLLECTION), ledgerBalance(bank.accountId), ledgerBalance(K.AR, client.id), ledgerBalance(K.BANK_CHARGES)]);
    const c = await received(10_000);
    expect(c.status).toBe("RECEIVED");
    expect(await ledgerBalance(K.NOTES_RECEIVABLE)).toBeCloseTo(nr0 + 10_000);
    expect(await ledgerBalance(K.AR, client.id)).toBeCloseTo(ar0 - 10_000);
    await act(treasury, "cheques", c.id, "collect", { date: "2026-09-06", bankAccountId: bank.id });
    expect(await ledgerBalance(K.CHEQUES_UNDER_COLLECTION)).toBeCloseTo(uc0 + 10_000);
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0); // no bank movement yet
    await act(treasury, "cheques", c.id, "clear", { date: "2026-09-08", charges: 25 });
    expect(await ledgerBalance(K.NOTES_RECEIVABLE)).toBeCloseTo(nr0);
    expect(await ledgerBalance(K.CHEQUES_UNDER_COLLECTION)).toBeCloseTo(uc0);
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0 + 10_000 - 25);
    expect(await ledgerBalance(K.BANK_CHARGES)).toBeCloseTo(ch0 + 25);
    const full = await get(treasury, "cheques", c.id);
    expect(full.status).toBe("CLEARED");
    expect(full.movements.map((m: { toStatus: string }) => m.toStatus)).toEqual(["RECEIVED", "UNDER_COLLECTION", "CLEARED"]);
    expect(full.movements.every((m: { journalEntryId: string | null }) => m.journalEntryId)).toBe(true);
  });

  it("deposited → bounced reverses the bank and restores the client's receivable; re-present returns it to hand", async () => {
    const [bk0, ar0] = [await ledgerBalance(bank.accountId), await ledgerBalance(K.AR, client.id)];
    const c = await received(7_500);
    await act(treasury, "cheques", c.id, "deposit", { date: "2026-09-06", bankAccountId: bank.id });
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0 + 7_500);
    await act(treasury, "cheques", c.id, "bounce", { date: "2026-09-09", charges: 100 });
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0 - 100);
    expect(await ledgerBalance(K.AR, client.id)).toBeCloseTo(ar0);
    await act(treasury, "cheques", c.id, "represent", { date: "2026-09-12" });
    expect((await get(treasury, "cheques", c.id)).status).toBe("RECEIVED");
    expect(await ledgerBalance(K.AR, client.id)).toBeCloseTo(ar0 - 7_500);
  });

  it("rejects invalid transitions and requires banks:approve", async () => {
    const c = await received(1_000);
    await expectApiError(act(treasury, "cheques", c.id, "clear", {}), 422); // must be deposited / collected first
    await expectApiError(act(treasury, "cheques", c.id, "collect", { date: "2026-09-06" }), 400); // bank required
    await expectApiError(act(acc, "cheques", c.id, "deposit", { bankAccountId: bank.id }), 403);
    await expectApiError(act(treasury, "cheques", c.id, "deposit", { date: "2026-03-10", bankAccountId: bank.id }), 422); // before issue date
  });

  it("issued cheque: notes payable until cleared, then the bank is credited; cancel restores the supplier liability", async () => {
    const [bk0, ap0, np0] = [await ledgerBalance(bank.accountId), await ledgerBalance(K.AP_SUPPLIERS, supplier.id), await ledgerBalance(K.NOTES_PAYABLE)];
    const c = await create(treasury, "cheques", { companyId: nileId, number: num(), type: "ISSUED", bankAccountId: bank.id, amount: 3_000, issueDate: "2026-09-02", dueDate: "2026-09-20", partyName: supplier.name, partyType: "SUPPLIER", partyId: supplier.id, counterAccountId: K.AP_SUPPLIERS });
    expect(await ledgerBalance(K.NOTES_PAYABLE)).toBeCloseTo(np0 - 3_000);
    expect(await ledgerBalance(K.AP_SUPPLIERS, supplier.id)).toBeCloseTo(ap0 + 3_000);
    await act(treasury, "cheques", c.id, "clear", { date: "2026-09-21" });
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0 - 3_000);
    expect(await ledgerBalance(K.NOTES_PAYABLE)).toBeCloseTo(np0);
    const c2 = await create(treasury, "cheques", { companyId: nileId, number: num(), type: "ISSUED", bankAccountId: bank.id, amount: 500, issueDate: "2026-09-02", dueDate: "2026-09-20", partyName: supplier.name, partyType: "SUPPLIER", partyId: supplier.id, counterAccountId: K.AP_SUPPLIERS });
    await act(treasury, "cheques", c2.id, "cancel", { date: "2026-09-03" });
    expect(await ledgerBalance(K.AP_SUPPLIERS, supplier.id)).toBeCloseTo(ap0 + 3_000);
    await expectApiError(act(treasury, "cheques", c2.id, "clear", {}), 422);
  });

  it("client receipt by cheque: hits notes receivable (not the bank); bounce reduces the extract's paid amount; payment reversal is blocked once the cheque moved", async () => {
    const ex = await prisma.clientExtract.findFirstOrThrow({ where: { companyId: nileId, status: "POSTED" }, orderBy: { date: "desc" } });
    const remaining = Number(ex.netAmount) - Number(ex.paidAmount);
    expect(remaining).toBeGreaterThan(1000);
    const bk0 = await ledgerBalance(bank.accountId);
    const pay = await create(treasury, "payments", { companyId: nileId, type: "CLIENT_RECEIPT", date: "2026-09-15", amount: 1000, method: "CHEQUE", chequeNumber: num(), chequeDueDate: "2026-09-30", clientExtractId: ex.id });
    await submitApprovePost(treasury, "payments", pay.id);
    expect(await ledgerBalance(bank.accountId)).toBeCloseTo(bk0);
    const paid1 = Number((await prisma.clientExtract.findUniqueOrThrow({ where: { id: ex.id } })).paidAmount);
    expect(paid1).toBeCloseTo(Number(ex.paidAmount) + 1000);
    const ch = await prisma.cheque.findFirstOrThrow({ where: { paymentId: pay.id } });
    expect(ch.status).toBe("RECEIVED");
    expect(ch.counterAccountId).toBe(K.AR);
    await act(treasury, "cheques", ch.id, "collect", { date: "2026-09-30", bankAccountId: bank.id });
    await expectApiError(act(await ctxFor("cfo@ccs.local"), "payments", pay.id, "reverse", { reason: "x" }), 422);
    await act(treasury, "cheques", ch.id, "bounce", { date: "2026-10-01" });
    expect(Number((await prisma.clientExtract.findUniqueOrThrow({ where: { id: ex.id } })).paidAmount)).toBeCloseTo(Number(ex.paidAmount));
  });

  it("reversing a cheque payment while the cheque is still in hand cancels the cheque", async () => {
    const ex = await prisma.clientExtract.findFirstOrThrow({ where: { companyId: nileId, status: "POSTED" }, orderBy: { date: "desc" } });
    const pay = await create(treasury, "payments", { companyId: nileId, type: "CLIENT_RECEIPT", date: "2026-09-15", amount: 500, method: "CHEQUE", chequeNumber: num(), clientExtractId: ex.id });
    await submitApprovePost(treasury, "payments", pay.id);
    await act(await ctxFor("cfo@ccs.local"), "payments", pay.id, "reverse", { reason: "wrong" });
    expect((await prisma.cheque.findFirstOrThrow({ where: { paymentId: pay.id } })).status).toBe("CANCELLED");
  });

  it("a cheque whose entry would be dated in a closed period is rejected", async () => {
    const c = await received(900, { issueDate: "2026-03-01", dueDate: "2026-03-05" }).catch((e) => e);
    expect(c.status).toBe(422); // initial entry would land in closed March 2026
  });
});
