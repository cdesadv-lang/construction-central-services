import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import type { Ctx } from "@/server/context";
import { contractorStatement } from "@/server/services/reports";
import { act, company, create, ctxFor, expectApiError, get } from "../helpers";

let acc: Ctx, chief: Ctx, cfo: Ctx, extracts: Ctx, treasury: Ctx, gm: Ctx, nileId: string;

beforeAll(async () => {
  acc = await ctxFor("acc.nile@ccs.local");
  chief = await ctxFor("chief@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  extracts = await ctxFor("extracts@ccs.local");
  treasury = await ctxFor("treasury@ccs.local");
  gm = await ctxFor("gm@ccs.local");
  nileId = (await company("NILE")).id;
});

async function newExpense() {
  const cash = await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" }, orderBy: { code: "desc" } });
  const p = await prisma.project.findFirstOrThrow({ where: { code: "NIL-P02" } });
  return create(acc, "expenses", { companyId: nileId, projectId: p.id, type: "TRANSPORT", date: "2026-09-15", amount: 1500, paymentMethod: "CASH", cashBoxId: cash.id, description: "اختبار" });
}

describe("approval workflow engine", () => {
  it("enforces step roles, forbids self-approval, records history, and posts a traceable entry", async () => {
    const e = await newExpense();
    await act(acc, "expenses", e.id, "submit");
    await expectApiError(act(acc, "expenses", e.id, "approve"), 403); // submitter / wrong role
    await expectApiError(act(cfo, "expenses", e.id, "approve"), 403); // step 1 needs CHIEF_ACCOUNTANT
    await act(chief, "expenses", e.id, "approve", { comment: "ok" });
    await expectApiError(act(gm, "expenses", e.id, "approve"), 403); // step 2 needs FINANCE_MANAGER
    await act(cfo, "expenses", e.id, "approve");
    await act(cfo, "expenses", e.id, "post");
    const full = await get(cfo, "expenses", e.id);
    expect(full.status).toBe("POSTED");
    const hist = full._extra.approvals[0];
    expect(hist.status).toBe("APPROVED");
    expect(hist.actions.map((a: { action: string }) => a.action)).toEqual(["SUBMIT", "APPROVE", "APPROVE"]);
    const je = full._extra.journalEntry;
    expect(je.sourceType).toBe("EXPENSE");
    expect(je.sourceId).toBe(e.id);
    expect(D(je.totalDebit).equals(D(je.totalCredit))).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { entityId: e.id } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["CREATE", "SUBMIT", "APPROVE_STEP", "APPROVE", "POST"]));
    // notifications were sent to approvers
    const n = await prisma.notification.count({ where: { userId: chief.user.id, type: "APPROVAL_REQUEST" } });
    expect(n).toBeGreaterThan(0);
  });

  it("rejection returns the document to draft and it can be resubmitted", async () => {
    const e = await newExpense();
    await act(acc, "expenses", e.id, "submit");
    await act(chief, "expenses", e.id, "reject", { comment: "مستند ناقص" });
    expect((await get(acc, "expenses", e.id)).status).toBe("DRAFT");
    await act(acc, "expenses", e.id, "submit");
    expect((await get(acc, "expenses", e.id)).status).toBe("PENDING_APPROVAL");
    await act(acc, "expenses", e.id, "cancel");
    expect((await get(acc, "expenses", e.id)).status).toBe("CANCELLED");
  });

  it("cannot post before approval", async () => {
    const e = await newExpense();
    await expectApiError(act(cfo, "expenses", e.id, "post"), 422);
  });
});

describe("contractor extracts end-to-end", () => {
  it("calculates from cumulative, posts the correct entry, and payments respect the remaining balance", async () => {
    const contractor = await prisma.contractor.findFirstOrThrow({ where: { companyId: nileId } });
    const p = await prisma.project.findFirstOrThrow({ where: { code: "NIL-P03" } });
    const sc = await create(acc, "subcontracts", { companyId: nileId, contractorId: contractor.id, projectId: p.id, scope: "اختبار أعمال", contractValue: 1_000_000, retentionPct: 5, taxPct: 1, insurancePct: 0, advanceRecoveryPct: 0 });
    const ex1 = await create(extracts, "contractor-extracts", { companyId: nileId, contractId: sc.id, periodFrom: "2026-09-01", periodTo: "2026-09-30", date: "2026-09-30", cumulativeGross: 300_000 });
    expect(Number(ex1.currentGross)).toBe(300_000);
    expect(Number(ex1.netAmount)).toBe(300_000 - 15_000 - 3_000);
    // a second extract cannot be created while the first is unposted
    await expectApiError(create(extracts, "contractor-extracts", { companyId: nileId, contractId: sc.id, periodFrom: "2026-10-01", periodTo: "2026-10-31", date: "2026-10-31", cumulativeGross: 400_000 }), 422);
    for (const [who, a] of [[extracts, "submit"], [chief, "approve"], [cfo, "approve"], [cfo, "post"]] as const) await act(who, "contractor-extracts", ex1.id, a);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "CONTRACTOR_EXTRACT", sourceId: ex1.id }, include: { lines: { include: { account: true } } } });
    const by = (k: string) => je.lines.find((l) => l.account.systemKey === k)!;
    expect(Number(by("COST_SUBCONTRACTORS").debit)).toBe(300_000);
    expect(Number(by("AP_CONTRACTORS").credit)).toBe(282_000);
    expect(Number(by("RETENTION_PAYABLE").credit)).toBe(15_000);
    expect(Number(by("WHT_PAYABLE").credit)).toBe(3_000);

    // second extract: previous is taken from posted extracts
    const ex2 = await create(extracts, "contractor-extracts", { companyId: nileId, contractId: sc.id, periodFrom: "2026-10-01", periodTo: "2026-10-31", date: "2026-10-31", cumulativeGross: 450_000 });
    expect(Number(ex2.previousGross)).toBe(300_000);
    expect(Number(ex2.currentGross)).toBe(150_000);
    await expectApiError(create(extracts, "contractor-extracts", { companyId: nileId, contractId: sc.id, periodFrom: "2026-10-01", periodTo: "2026-10-31", date: "2026-10-31", cumulativeGross: 2_000_000 }), 422);
    await act(extracts, "contractor-extracts", ex2.id, "cancel");

    // payment over remaining is rejected at posting
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" } });
    const over = await create(treasury, "payments", { companyId: nileId, type: "CONTRACTOR_PAYMENT", date: "2026-10-05", amount: 290_000, method: "BANK", bankAccountId: bank.id, contractorExtractId: ex1.id });
    for (const [who, a] of [[treasury, "submit"], [chief, "approve"], [cfo, "approve"]] as const) await act(who, "payments", over.id, a);
    await expectApiError(act(cfo, "payments", over.id, "post"), 422);
    const ok = await create(treasury, "payments", { companyId: nileId, type: "CONTRACTOR_PAYMENT", date: "2026-10-05", amount: 200_000, method: "BANK", bankAccountId: bank.id, contractorExtractId: ex1.id });
    expect(ok.contractorId).toBe(contractor.id); // filled from the extract
    for (const [who, a] of [[treasury, "submit"], [chief, "approve"], [cfo, "approve"], [cfo, "post"]] as const) await act(who, "payments", ok.id, a);
    const after = await get(cfo, "contractor-extracts", ex1.id);
    expect(Number(after.paidAmount)).toBe(200_000);
    expect(Number(after.remaining)).toBe(82_000);
    // posted extract with payments cannot be reversed
    await expectApiError(act(cfo, "contractor-extracts", ex1.id, "reverse"), 422);

    // statement: running balance
    const st = await contractorStatement(cfo, { partyId: contractor.id });
    const last = st.rows[st.rows.length - 1] as { balance: number };
    expect(last.balance).toBeCloseTo(st.totals!.credit as number - (st.totals!.debit as number), 2);
    expect(st.meta!.totalPaid).toBeGreaterThan(0);
    // reverse the payment then the extract becomes fully payable again
    await act(cfo, "payments", ok.id, "reverse", { reason: "test" });
    expect(Number((await get(cfo, "contractor-extracts", ex1.id)).paidAmount)).toBe(0);
  });
});
