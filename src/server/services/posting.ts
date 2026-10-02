// Posting rules: operational documents -> balanced, posted journal entries (fully traceable via sourceType/sourceId).
import type { PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, r2 } from "@/lib/money";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { calcContractorExtract, calcClientExtract, ExtractError } from "@/lib/extracts";
import type { Ctx } from "../context";
import { audit } from "../audit";
import {
  accountIdByKey,
  createJournalEntry,
  EXPENSE_TYPE_ACCOUNT,
  postJournalEntry,
  reverseJournalEntry,
  type LineInput,
} from "./accounting";
import { DOC_TYPES, type DocType } from "./doctypes";
import { cancelPaymentCheque, registerPaymentCheque } from "./cheques";

/* eslint-disable @typescript-eslint/no-explicit-any */
const delegate = (tx: Tx, docType: DocType) => (tx as any)[DOC_TYPES[docType].model];

async function moneyAccount(tx: Tx, companyId: string, method: PaymentMethod, cashBoxId?: string | null, bankAccountId?: string | null) {
  if (method === "CASH") {
    if (!cashBoxId) throw badRequest("Cash box is required for cash method");
    const cb = await tx.cashBox.findFirst({ where: { id: cashBoxId, companyId } });
    if (!cb) throw badRequest("Cash box not found in this company");
    return cb.accountId;
  }
  if (method === "BANK" || method === "CHEQUE") {
    if (!bankAccountId) throw badRequest("Bank account is required for bank/cheque method");
    const b = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId } });
    if (!b) throw badRequest("Bank account not found in this company");
    return b.accountId;
  }
  throw badRequest(`Payment method ${method} is not valid here`);
}

const nz = (l: LineInput) => !D(l.debit).isZero() || !D(l.credit).isZero();

async function custodyRemaining(tx: Tx, custodyId: string, excludeExpenseId?: string) {
  const c = await tx.custody.findUnique({ where: { id: custodyId } });
  if (!c) throw notFound("Custody not found");
  const spent = await tx.expense.aggregate({
    where: { custodyId, status: "POSTED", ...(excludeExpenseId ? { id: { not: excludeExpenseId } } : {}) },
    _sum: { amount: true },
  });
  return { custody: c, spent: D(spent._sum.amount), remaining: D(c.amount).minus(D(spent._sum.amount)).minus(D(c.returnedAmount)) };
}

export async function contractorAdvanceBalance(tx: Tx, companyId: string, contractorId: string) {
  const acc = await accountIdByKey(tx, companyId, "CONTRACTOR_ADVANCES");
  const agg = await tx.journalLine.aggregate({
    where: { accountId: acc, partyType: "CONTRACTOR", partyId: contractorId, entry: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit).minus(D(agg._sum.credit));
}

/** Builds journal lines + description for a document. Throws on business-rule violations. */
async function buildEntry(tx: Tx, docType: DocType, doc: any): Promise<{ lines: LineInput[]; description: string; projectId?: string | null; date: Date }> {
  const c = doc.companyId as string;
  const acc = (k: string) => accountIdByKey(tx, c, k);
  switch (docType) {
    case "EXPENSE": {
      const amount = r2(doc.amount);
      if (!amount.greaterThan(0)) throw unprocessable("Expense amount must be greater than zero");
      const debit = await acc(EXPENSE_TYPE_ACCOUNT[doc.type as keyof typeof EXPENSE_TYPE_ACCOUNT]);
      let credit: LineInput;
      if (doc.paymentMethod === "CUSTODY") {
        if (!doc.custodyId) throw badRequest("Custody is required for custody payment method");
        const { custody, remaining } = await custodyRemaining(tx, doc.custodyId, doc.id);
        if (custody.companyId !== c) throw badRequest("Custody belongs to another company");
        if (custody.status !== "POSTED" || custody.settlementStatus !== "OPEN") throw unprocessable("Custody is not open/posted");
        if (amount.greaterThan(remaining)) throw unprocessable(`Custody remaining balance (${remaining.toFixed(2)}) is insufficient`);
        credit = { accountId: await acc("CUSTODY"), credit: amount, partyType: "EMPLOYEE", partyId: custody.employeeId };
      } else if (doc.paymentMethod === "CREDIT") {
        if (!doc.supplierId) throw badRequest("Supplier is required for credit (on-account) expenses");
        credit = { accountId: await acc("AP_SUPPLIERS"), credit: amount, partyType: "SUPPLIER", partyId: doc.supplierId };
      } else {
        credit = { accountId: await moneyAccount(tx, c, doc.paymentMethod, doc.cashBoxId, doc.bankAccountId), credit: amount };
      }
      return {
        date: doc.date,
        projectId: doc.projectId,
        description: `مصروف ${doc.number}${doc.description ? " - " + doc.description : ""}`,
        lines: [
          { accountId: debit, debit: amount, costCenterId: doc.costCenterId, projectId: doc.projectId, description: doc.description },
          { ...credit, description: doc.description },
        ],
      };
    }
    case "SUPPLIER_INVOICE": {
      const subtotal = r2(doc.subtotal);
      const tax = r2(doc.taxAmount);
      if (!r2(subtotal.plus(tax)).equals(r2(doc.total))) throw unprocessable("Invoice total must equal subtotal + tax");
      if (!subtotal.greaterThan(0)) throw unprocessable("Invoice subtotal must be greater than zero");
      const lines: LineInput[] = [
        { accountId: await acc(EXPENSE_TYPE_ACCOUNT[doc.category as keyof typeof EXPENSE_TYPE_ACCOUNT]), debit: subtotal, projectId: doc.projectId },
        { accountId: await acc("VAT_INPUT"), debit: tax },
        { accountId: await acc("AP_SUPPLIERS"), credit: r2(doc.total), partyType: "SUPPLIER", partyId: doc.supplierId },
      ].filter(nz);
      return { date: doc.date, projectId: doc.projectId, description: `فاتورة مورد ${doc.number}${doc.supplierRef ? " (" + doc.supplierRef + ")" : ""}`, lines };
    }
    case "PAYMENT": {
      const amount = r2(doc.amount);
      if (!amount.greaterThan(0)) throw unprocessable("Payment amount must be greater than zero");
      // Cheques don't touch the bank at payment time: received cheques go to Notes Receivable (cheques in hand),
      // issued cheques to Notes Payable. The bank moves when the cheque is deposited / cleared (see services/cheques.ts).
      const money =
        doc.method === "CHEQUE"
          ? await acc(doc.type === "CLIENT_RECEIPT" ? "NOTES_RECEIVABLE" : "NOTES_PAYABLE")
          : await moneyAccount(tx, c, doc.method, doc.cashBoxId, doc.bankAccountId);
      if (doc.method === "CHEQUE") {
        if (!doc.chequeNumber) throw badRequest("Cheque number is required");
        if (doc.type !== "CLIENT_RECEIPT") {
          if (!doc.bankAccountId) throw badRequest("Bank account (drawn on) is required for issued cheques");
          await moneyAccount(tx, c, "BANK", null, doc.bankAccountId); // validates company
        }
      }
      if (doc.type === "SUPPLIER_PAYMENT") {
        if (!doc.supplierId) throw badRequest("Supplier is required");
        if (doc.supplierInvoiceId) {
          const inv = await tx.supplierInvoice.findUnique({ where: { id: doc.supplierInvoiceId } });
          if (!inv || inv.companyId !== c || inv.supplierId !== doc.supplierId) throw badRequest("Invoice does not match supplier/company");
          if (inv.status !== "POSTED") throw unprocessable("Invoice must be posted before payment");
          const rem = D(inv.total).minus(D(inv.paidAmount));
          if (amount.greaterThan(rem)) throw unprocessable(`Amount exceeds invoice remaining (${rem.toFixed(2)})`);
        }
        return {
          date: doc.date,
          projectId: doc.projectId,
          description: `سداد مورد ${doc.number}`,
          lines: [
            { accountId: await acc("AP_SUPPLIERS"), debit: amount, partyType: "SUPPLIER", partyId: doc.supplierId },
            { accountId: money, credit: amount },
          ],
        };
      }
      if (doc.type === "CONTRACTOR_PAYMENT" || doc.type === "CONTRACTOR_ADVANCE") {
        if (!doc.contractorId) throw badRequest("Contractor is required");
        if (doc.type === "CONTRACTOR_PAYMENT" && doc.contractorExtractId) {
          const ex = await tx.contractorExtract.findUnique({ where: { id: doc.contractorExtractId } });
          if (!ex || ex.companyId !== c || ex.contractorId !== doc.contractorId) throw badRequest("Extract does not match contractor/company");
          if (ex.status !== "POSTED") throw unprocessable("Extract must be posted before payment");
          const rem = D(ex.netAmount).minus(D(ex.paidAmount));
          if (amount.greaterThan(rem)) throw unprocessable(`Amount exceeds extract remaining (${rem.toFixed(2)})`);
        }
        const key = doc.type === "CONTRACTOR_ADVANCE" ? "CONTRACTOR_ADVANCES" : "AP_CONTRACTORS";
        return {
          date: doc.date,
          projectId: doc.projectId,
          description: `${doc.type === "CONTRACTOR_ADVANCE" ? "دفعة مقدمة لمقاول" : "سداد مقاول"} ${doc.number}`,
          lines: [
            { accountId: await acc(key), debit: amount, partyType: "CONTRACTOR", partyId: doc.contractorId },
            { accountId: money, credit: amount },
          ],
        };
      }
      if (doc.type === "CLIENT_RECEIPT") {
        if (!doc.clientId) throw badRequest("Client is required");
        if (doc.clientExtractId) {
          const ex = await tx.clientExtract.findUnique({ where: { id: doc.clientExtractId } });
          if (!ex || ex.companyId !== c || ex.clientId !== doc.clientId) throw badRequest("Extract does not match client/company");
          if (ex.status !== "POSTED") throw unprocessable("Client extract must be posted before collection");
          const rem = D(ex.netAmount).minus(D(ex.paidAmount));
          if (amount.greaterThan(rem)) throw unprocessable(`Amount exceeds extract remaining (${rem.toFixed(2)})`);
        }
        return {
          date: doc.date,
          projectId: doc.projectId,
          description: `تحصيل من عميل ${doc.number}`,
          lines: [
            { accountId: money, debit: amount },
            { accountId: await acc("AR"), credit: amount, partyType: "CLIENT", partyId: doc.clientId },
          ],
        };
      }
      throw badRequest("Unknown payment type");
    }
    case "CONTRACTOR_EXTRACT": {
      const contract = await tx.subContract.findUnique({ where: { id: doc.contractId } });
      if (!contract) throw notFound("Contract not found");
      // Re-verify cumulative chain at posting time
      const prev = await tx.contractorExtract.aggregate({
        where: { contractId: doc.contractId, id: { not: doc.id }, status: "POSTED" },
        _sum: { currentGross: true },
      });
      if (!r2(D(prev._sum.currentGross)).equals(r2(doc.previousGross)))
        throw unprocessable("Previous extracts changed since this extract was prepared — edit and recalculate it before posting");
      const cur = r2(doc.currentGross);
      if (!cur.greaterThan(0)) throw unprocessable("Current work value must be greater than zero");
      const lines: LineInput[] = [
        { accountId: await acc("COST_SUBCONTRACTORS"), debit: cur, projectId: doc.projectId },
        { accountId: await acc("AP_CONTRACTORS"), credit: r2(doc.netAmount), partyType: "CONTRACTOR", partyId: doc.contractorId },
        { accountId: await acc("RETENTION_PAYABLE"), credit: r2(doc.retentionAmount), partyType: "CONTRACTOR", partyId: doc.contractorId },
        { accountId: await acc("WHT_PAYABLE"), credit: r2(doc.taxAmount) },
        { accountId: await acc("INSURANCE_PAYABLE"), credit: r2(doc.insuranceAmount) },
        { accountId: await acc("CONTRACTOR_ADVANCES"), credit: r2(doc.advanceRecovery), partyType: "CONTRACTOR", partyId: doc.contractorId },
        { accountId: await acc("PENALTIES_INCOME"), credit: r2(doc.otherDeductions) },
      ].filter(nz);
      return { date: doc.date, projectId: doc.projectId, description: `مستخلص مقاول ${doc.number} - عقد ${contract.number}`, lines };
    }
    case "CLIENT_EXTRACT": {
      const prev = await tx.clientExtract.aggregate({
        where: { projectId: doc.projectId, id: { not: doc.id }, status: "POSTED" },
        _sum: { workValue: true },
      });
      if (!r2(D(prev._sum.workValue)).equals(r2(doc.previousWork)))
        throw unprocessable("Previous client extracts changed since this extract was prepared — edit and recalculate it before posting");
      const work = r2(doc.workValue);
      if (!work.greaterThan(0)) throw unprocessable("Work value must be greater than zero");
      const lines: LineInput[] = [
        { accountId: await acc("AR"), debit: r2(doc.netAmount), partyType: "CLIENT", partyId: doc.clientId },
        { accountId: await acc("RETENTION_RECEIVABLE"), debit: r2(doc.retentionAmount), partyType: "CLIENT", partyId: doc.clientId },
        { accountId: await acc("WHT_RECEIVABLE"), debit: r2(doc.taxAmount) },
        { accountId: await acc("CLIENT_INSURANCE_EXP"), debit: r2(doc.insuranceAmount), projectId: doc.projectId },
        { accountId: await acc("CLIENT_DEDUCTIONS_EXP"), debit: r2(doc.otherDeductions), projectId: doc.projectId },
        { accountId: await acc("REVENUE_CONTRACTS"), credit: work, projectId: doc.projectId },
      ].filter(nz);
      return { date: doc.date, projectId: doc.projectId, description: `مستخلص عميل ${doc.number}`, lines };
    }
    case "PAYROLL": {
      const payroll = await tx.payroll.findUnique({ where: { id: doc.id }, include: { lines: true } });
      if (!payroll || !payroll.lines.length) throw unprocessable("Payroll has no lines");
      const costByProject = new Map<string, ReturnType<typeof D>>();
      let net = D(0), ins = D(0), tax = D(0), ded = D(0);
      for (const l of payroll.lines) {
        const cost = r2(D(l.gross).plus(D(l.companyInsurance)));
        const allocs = (Array.isArray(l.allocations) ? l.allocations : []) as { projectId: string | null; percent: number }[];
        const list = allocs.length ? allocs : [{ projectId: payroll.projectId, percent: 100 }];
        let allocated = D(0);
        list.forEach((a, idx) => {
          const part = idx === list.length - 1 ? cost.minus(allocated) : r2(cost.mul(a.percent).div(100));
          allocated = allocated.plus(part);
          const k = a.projectId ?? "";
          costByProject.set(k, (costByProject.get(k) ?? D(0)).plus(part));
        });
        net = net.plus(D(l.net));
        ins = ins.plus(D(l.insurance)).plus(D(l.companyInsurance));
        tax = tax.plus(D(l.tax));
        ded = ded.plus(D(l.deductions));
      }
      const lines: LineInput[] = [];
      const projAcc = await acc("COST_SALARIES");
      const adminAcc = await acc("ADMIN_SALARIES");
      for (const [projectId, amount] of costByProject) {
        lines.push({ accountId: projectId ? projAcc : adminAcc, debit: r2(amount), projectId: projectId || null });
      }
      lines.push(
        { accountId: await acc("SALARIES_PAYABLE"), credit: r2(net) },
        { accountId: await acc("INSURANCE_PAYABLE"), credit: r2(ins) },
        { accountId: await acc("PAYROLL_TAX_PAYABLE"), credit: r2(tax) },
        { accountId: await acc("PENALTIES_INCOME"), credit: r2(ded) },
      );
      return { date: monthEnd(payroll.month), projectId: payroll.projectId, description: `مسير رواتب ${payroll.number} - ${payroll.month}`, lines: lines.filter(nz) };
    }
    case "TREASURY": {
      const amount = r2(doc.amount);
      if (!amount.greaterThan(0)) throw unprocessable("Amount must be greater than zero");
      const cash = async (id?: string | null) => moneyAccount(tx, c, "CASH", id, null);
      const bank = async (id?: string | null) => moneyAccount(tx, c, "BANK", null, id);
      const counter = async () => {
        if (!doc.counterAccountId) throw badRequest("Counter account is required");
        const a = await tx.account.findFirst({ where: { id: doc.counterAccountId, companyId: c, isPostable: true } });
        if (!a) throw badRequest("Counter account is invalid for this company");
        return a.id;
      };
      let dr: string, cr: string;
      switch (doc.kind) {
        case "CASH_RECEIPT": dr = await cash(doc.cashBoxId); cr = await counter(); break;
        case "CASH_PAYMENT": dr = await counter(); cr = await cash(doc.cashBoxId); break;
        case "CASH_TRANSFER": dr = await cash(doc.toCashBoxId); cr = await cash(doc.cashBoxId); break;
        case "BANK_DEPOSIT": dr = await bank(doc.bankAccountId); cr = await cash(doc.cashBoxId); break;
        case "BANK_WITHDRAWAL": dr = await cash(doc.cashBoxId); cr = await bank(doc.bankAccountId); break;
        case "BANK_TRANSFER": dr = await bank(doc.toBankAccountId); cr = await bank(doc.bankAccountId); break;
        case "BANK_RECEIPT": dr = await bank(doc.bankAccountId); cr = await counter(); break;
        case "BANK_PAYMENT": dr = await counter(); cr = await bank(doc.bankAccountId); break;
        default: throw badRequest("Unknown treasury kind");
      }
      if (dr === cr) throw unprocessable("Source and destination cannot be the same");
      return {
        date: doc.date,
        projectId: doc.projectId,
        description: `حركة خزينة ${doc.number}${doc.description ? " - " + doc.description : ""}`,
        lines: [
          { accountId: dr, debit: amount, projectId: doc.projectId },
          { accountId: cr, credit: amount, projectId: doc.projectId },
        ],
      };
    }
    case "CUSTODY": {
      const amount = r2(doc.amount);
      if (!amount.greaterThan(0)) throw unprocessable("Custody amount must be greater than zero");
      return {
        date: doc.date,
        projectId: doc.projectId,
        description: `صرف عهدة ${doc.number} - ${doc.purpose}`,
        lines: [
          { accountId: await acc("CUSTODY"), debit: amount, partyType: "EMPLOYEE", partyId: doc.employeeId, projectId: doc.projectId },
          { accountId: await moneyAccount(tx, c, "CASH", doc.cashBoxId, null), credit: amount },
        ],
      };
    }
    default:
      throw badRequest(`No posting rule for ${docType}`);
  }
}

export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}

async function applySideEffects(tx: Tx, docType: DocType, doc: any, sign: 1 | -1, ctx: Ctx | null) {
  if (docType === "PAYMENT") {
    const amt = r2(doc.amount).mul(sign);
    if (doc.supplierInvoiceId) await tx.supplierInvoice.update({ where: { id: doc.supplierInvoiceId }, data: { paidAmount: { increment: amt } } });
    if (doc.contractorExtractId) await tx.contractorExtract.update({ where: { id: doc.contractorExtractId }, data: { paidAmount: { increment: amt } } });
    if (doc.clientExtractId) await tx.clientExtract.update({ where: { id: doc.clientExtractId }, data: { paidAmount: { increment: amt } } });
    if (doc.method === "CHEQUE" && sign === 1) await registerPaymentCheque(tx, ctx, doc);
    if (doc.method === "CHEQUE" && sign === -1) await cancelPaymentCheque(tx, ctx, doc);
  }
  if (docType === "PURCHASE_ORDER" && sign === 1 && doc.requestId) {
    await tx.purchaseRequest.update({ where: { id: doc.requestId }, data: { status: "ORDERED" } });
  }
  void ctx;
}

/** Posts an APPROVED document: generates its journal entry and marks it POSTED. */
export async function postDocument(tx: Tx, ctx: Ctx, docType: DocType, id: string) {
  if (docType === "JOURNAL") return postJournalEntry(tx, ctx, id);
  const d = delegate(tx, docType);
  const doc = await d.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (doc.status !== "APPROVED") throw unprocessable(`Only approved documents can be posted (current status: ${doc.status})`);
  let journalEntryId: string | null = null;
  if (docType !== "PURCHASE_ORDER") {
    let built;
    try {
      built = await buildEntry(tx, docType, doc);
    } catch (e) {
      if (e instanceof ExtractError) throw unprocessable(e.message);
      throw e;
    }
    const je = await createJournalEntry(tx, ctx, {
      companyId: doc.companyId,
      date: built.date,
      description: built.description,
      projectId: built.projectId,
      lines: built.lines,
      status: "POSTED",
      sourceType: docType,
      sourceId: doc.id,
    });
    journalEntryId = je.id;
  }
  const res = await d.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "POSTED", ...(journalEntryId ? { journalEntryId } : {}) },
  });
  if (res.count !== 1) throw unprocessable("Document was modified concurrently");
  await applySideEffects(tx, docType, doc, 1, ctx);
  await audit(tx, ctx, { action: "POST", entity: DOC_TYPES[docType].model, entityId: id, companyId: doc.companyId, before: { status: "APPROVED" }, after: { status: "POSTED", journalEntryId } });
  return d.findUnique({ where: { id } });
}

/** Reverses a POSTED document: posts a reversing entry, undoes side effects and marks it CANCELLED. */
export async function reverseDocument(tx: Tx, ctx: Ctx, docType: DocType, id: string, reason?: string) {
  if (docType === "JOURNAL") {
    const e = await tx.journalEntry.findUnique({ where: { id } });
    if (e?.sourceType && !e.sourceType.endsWith("REVERSAL") && e.sourceType !== "OPENING")
      throw unprocessable("This entry was generated by a document — reverse the source document instead");
    return reverseJournalEntry(tx, ctx, id, reason);
  }
  const d = delegate(tx, docType);
  const doc = await d.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (doc.status !== "POSTED") throw unprocessable("Only posted documents can be reversed");
  if (docType === "SUPPLIER_INVOICE" && D(doc.paidAmount).greaterThan(0)) throw unprocessable("Invoice has payments — reverse the payments first");
  if ((docType === "CONTRACTOR_EXTRACT" || docType === "CLIENT_EXTRACT") && D(doc.paidAmount).greaterThan(0))
    throw unprocessable("Extract has payments — reverse the payments first");
  if (docType === "CONTRACTOR_EXTRACT") {
    const later = await tx.contractorExtract.count({ where: { contractId: doc.contractId, status: "POSTED", date: { gt: doc.date }, id: { not: id } } });
    if (later) throw unprocessable("Later extracts exist for this contract — reverse them first");
  }
  if (docType === "CLIENT_EXTRACT") {
    const later = await tx.clientExtract.count({ where: { projectId: doc.projectId, status: "POSTED", date: { gt: doc.date }, id: { not: id } } });
    if (later) throw unprocessable("Later extracts exist for this project — reverse them first");
  }
  if (docType === "PAYMENT" && doc.method === "CHEQUE") {
    const ch = await tx.cheque.findFirst({ where: { paymentId: id, status: { notIn: ["RECEIVED", "ISSUED", "CANCELLED"] } } });
    if (ch) throw unprocessable(`Cheque ${ch.number} has already moved (${ch.status}) — use the cheque lifecycle (bounce/cancel) instead of reversing the payment`);
  }
  if (docType === "CUSTODY") {
    const used = await tx.expense.count({ where: { custodyId: id, status: { in: ["POSTED", "APPROVED", "PENDING_APPROVAL"] } } });
    if (used || doc.settlementStatus === "SETTLED") throw unprocessable("Custody has expenses or is settled and cannot be reversed");
  }
  if (doc.journalEntryId) await reverseJournalEntry(tx, ctx, doc.journalEntryId, reason);
  const res = await d.updateMany({ where: { id, status: "POSTED" }, data: { status: "CANCELLED" } });
  if (res.count !== 1) throw unprocessable("Document was modified concurrently");
  await applySideEffects(tx, docType, doc, -1, ctx);
  await audit(tx, ctx, { action: "REVERSE", entity: DOC_TYPES[docType].model, entityId: id, companyId: doc.companyId, before: { status: "POSTED" }, after: { status: "CANCELLED", reason } });
  return d.findUnique({ where: { id } });
}

/** Custody settlement: returns the unspent balance to the cash box and closes the custody. */
export async function settleCustody(tx: Tx, ctx: Ctx, id: string) {
  const { custody, remaining } = await custodyRemaining(tx, id);
  if (custody.status !== "POSTED" || custody.settlementStatus !== "OPEN") throw unprocessable("Only open posted custody can be settled");
  const pending = await tx.expense.count({ where: { custodyId: id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } } });
  if (pending) throw unprocessable("Custody has unposted expenses — post or cancel them first");
  let settlementEntryId: string | null = null;
  if (remaining.greaterThan(0)) {
    const cb = await tx.cashBox.findUnique({ where: { id: custody.cashBoxId } });
    const je = await createJournalEntry(tx, ctx, {
      companyId: custody.companyId,
      date: new Date(),
      description: `تسوية عهدة ${custody.number} - رد المتبقي`,
      projectId: custody.projectId,
      status: "POSTED",
      sourceType: "CUSTODY_SETTLEMENT",
      sourceId: custody.id,
      lines: [
        { accountId: cb!.accountId, debit: remaining },
        { accountId: await accountIdByKey(tx, custody.companyId, "CUSTODY"), credit: remaining, partyType: "EMPLOYEE", partyId: custody.employeeId },
      ],
    });
    settlementEntryId = je.id;
  }
  const updated = await tx.custody.update({
    where: { id },
    data: { settlementStatus: "SETTLED", settledAt: new Date(), returnedAmount: remaining.greaterThan(0) ? remaining : 0, settlementEntryId },
  });
  await audit(tx, ctx, { action: "SETTLE", entity: "custody", entityId: id, companyId: custody.companyId, after: { returned: remaining.toFixed(2), settlementEntryId } });
  return updated;
}

/** Recalculate contractor extract amounts (used by create/update). */
export async function computeContractorExtract(
  tx: Tx,
  input: { companyId: string; contractId: string; cumulativeGross: unknown; otherDeductions?: unknown; excludeId?: string },
) {
  const contract = await tx.subContract.findFirst({ where: { id: input.contractId, companyId: input.companyId } });
  if (!contract) throw badRequest("Contract not found in this company");
  const prev = await tx.contractorExtract.aggregate({
    where: { contractId: contract.id, status: "POSTED", ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
    _sum: { currentGross: true },
  });
  const pending = await tx.contractorExtract.count({
    where: { contractId: contract.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] }, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
  });
  if (pending) throw unprocessable("Another unposted extract exists for this contract — post or cancel it first");
  const advanceBalance = await contractorAdvanceBalance(tx, input.companyId, contract.contractorId);
  try {
    const calc = calcContractorExtract({
      contractValue: contract.contractValue,
      cumulativeGross: input.cumulativeGross as number,
      previousGross: prev._sum.currentGross ?? 0,
      retentionPct: contract.retentionPct,
      taxPct: contract.taxPct,
      insurancePct: contract.insurancePct,
      advanceRecoveryPct: contract.advanceRecoveryPct,
      advanceBalance,
      otherDeductions: input.otherDeductions as number,
    });
    return { contract, calc };
  } catch (e) {
    if (e instanceof ExtractError) throw unprocessable(e.message);
    throw e;
  }
}

export async function computeClientExtract(
  tx: Tx,
  input: { companyId: string; projectId: string; cumulativeWork: unknown; otherDeductions?: unknown; excludeId?: string },
) {
  const project = await tx.project.findFirst({ where: { id: input.projectId, companyId: input.companyId } });
  if (!project) throw badRequest("Project not found in this company");
  const prev = await tx.clientExtract.aggregate({
    where: { projectId: project.id, status: "POSTED", ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
    _sum: { workValue: true },
  });
  const pending = await tx.clientExtract.count({
    where: { projectId: project.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] }, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
  });
  if (pending) throw unprocessable("Another unposted client extract exists for this project — post or cancel it first");
  try {
    const calc = calcClientExtract({
      contractValue: project.contractValue,
      cumulativeWork: input.cumulativeWork as number,
      previousWork: prev._sum.workValue ?? 0,
      retentionPct: project.clientRetentionPct,
      taxPct: project.clientTaxPct,
      insurancePct: project.clientInsurancePct,
      otherDeductions: input.otherDeductions as number,
    });
    return { project, calc };
  } catch (e) {
    if (e instanceof ExtractError) throw unprocessable(e.message);
    throw e;
  }
}
