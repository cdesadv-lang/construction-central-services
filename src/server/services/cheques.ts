// Cheque lifecycle with automatic journal entries.
//
// Received cheques (أوراق قبض):
//   RECEIVED (in hand)      Dr Notes Receivable              / Cr party (AR…)        ← client receipt by cheque, or stand-alone cheque
//   → UNDER_COLLECTION      Dr Cheques Under Collection      / Cr Notes Receivable   (sent to the bank for collection)
//   → DEPOSITED             Dr Bank                          / Cr Notes Receivable   (deposited; bank credits immediately)
//   UNDER_COLLECTION → CLEARED   Dr Bank / Cr Cheques Under Collection           (bank movement)
//   DEPOSITED        → CLEARED   no entry (confirmation)
//   UNDER_COLLECTION → BOUNCED   Dr party / Cr Cheques Under Collection           (receivable restored)
//   DEPOSITED        → BOUNCED   Dr party / Cr Bank                               (bank movement reversed)
//   RECEIVED         → CANCELLED Dr party / Cr Notes Receivable                   (returned to the drawer)
//   BOUNCED          → RECEIVED  Dr Notes Receivable / Cr party                   (re-presented / replaced)
// Issued cheques (أوراق دفع):
//   ISSUED                  Dr party (AP…)                   / Cr Notes Payable      ← supplier/contractor payment by cheque, or stand-alone
//   → CLEARED               Dr Notes Payable / Cr Bank                           (bank movement)
//   → BOUNCED / CANCELLED   Dr Notes Payable / Cr party                          (liability restored)
//   BOUNCED → ISSUED        Dr party / Cr Notes Payable                          (re-issued)
// Optional bank charges on clear/bounce/deposit: Dr Bank Charges / Cr Bank.
// Bounce/cancel of a payment cheque also reduces the paid amount of the linked invoice/extract (and re-presenting restores it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ChequeStatus, Cheque } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, r2 } from "@/lib/money";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { accountIdByKey, createJournalEntry, type LineInput } from "./accounting";
import { assertPeriodOpen } from "./periods";
import { assertSameCurrency, resolveDocFx } from "./fx";
import { isForeign, toBase } from "@/lib/fx";

export type ChequeAction = "collect" | "deposit" | "clear" | "bounce" | "cancel" | "represent";

const TRANSITIONS: Record<"RECEIVED" | "ISSUED", Partial<Record<ChequeStatus, Partial<Record<ChequeAction, ChequeStatus>>>>> = {
  RECEIVED: {
    RECEIVED: { collect: "UNDER_COLLECTION", deposit: "DEPOSITED", cancel: "CANCELLED" },
    UNDER_COLLECTION: { clear: "CLEARED", bounce: "BOUNCED" },
    DEPOSITED: { clear: "CLEARED", bounce: "BOUNCED" },
    BOUNCED: { represent: "RECEIVED" },
  },
  ISSUED: {
    ISSUED: { clear: "CLEARED", bounce: "BOUNCED", cancel: "CANCELLED" },
    BOUNCED: { represent: "ISSUED" },
  },
};

export function allowedActions(type: "RECEIVED" | "ISSUED", status: ChequeStatus): ChequeAction[] {
  return Object.keys(TRANSITIONS[type][status] ?? {}) as ChequeAction[];
}

const PAYMENT_PARTY: Record<string, { key: string; partyType: string; field: string }> = {
  CLIENT_RECEIPT: { key: "AR", partyType: "CLIENT", field: "clientId" },
  SUPPLIER_PAYMENT: { key: "AP_SUPPLIERS", partyType: "SUPPLIER", field: "supplierId" },
  CONTRACTOR_PAYMENT: { key: "AP_CONTRACTORS", partyType: "CONTRACTOR", field: "contractorId" },
  CONTRACTOR_ADVANCE: { key: "CONTRACTOR_ADVANCES", partyType: "CONTRACTOR", field: "contractorId" },
};

async function bankGl(tx: Tx, companyId: string, bankAccountId: string | null | undefined) {
  if (!bankAccountId) throw badRequest("Bank account is required for this step");
  const b = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId } });
  if (!b) throw badRequest("Bank account not found in this company");
  return b;
}

/** Called when a payment with method CHEQUE is posted. */
export async function registerPaymentCheque(tx: Tx, ctx: Ctx | null, pay: any) {
  const map = PAYMENT_PARTY[pay.type];
  const partyId = pay[map.field] as string;
  const partyName =
    map.partyType === "CLIENT"
      ? (await tx.client.findUnique({ where: { id: partyId } }))?.name
      : map.partyType === "SUPPLIER"
        ? (await tx.supplier.findUnique({ where: { id: partyId } }))?.name
        : (await tx.contractor.findUnique({ where: { id: partyId } }))?.name;
  const posted = await tx.payment.findUnique({ where: { id: pay.id }, select: { journalEntryId: true } });
  const type = pay.type === "CLIENT_RECEIPT" ? "RECEIVED" : "ISSUED";
  const ch = await tx.cheque.create({
    data: {
      companyId: pay.companyId,
      number: pay.chequeNumber || pay.number,
      type,
      status: type,
      bankAccountId: pay.bankAccountId ?? null,
      amount: pay.amount,
      currency: pay.currency ?? "EGP",
      exchangeRate: pay.exchangeRate ?? 1,
      issueDate: pay.date,
      dueDate: pay.chequeDueDate ?? pay.date,
      partyName: partyName ?? "-",
      partyType: map.partyType,
      partyId,
      counterAccountId: await accountIdByKey(tx, pay.companyId, map.key),
      paymentId: pay.id,
      journalEntryId: posted?.journalEntryId ?? null,
      createdById: ctx?.user.id ?? null,
      movements: { create: { companyId: pay.companyId, toStatus: type, date: pay.date, journalEntryId: posted?.journalEntryId ?? null, notes: `Payment ${pay.number}`, createdById: ctx?.user.id ?? null } },
    } as any,
  });
  return ch;
}

/** Called when a cheque payment is reversed: the payment's reversing entry already unwinds the ledger. */
export async function cancelPaymentCheque(tx: Tx, ctx: Ctx | null, pay: any) {
  const cheques = await tx.cheque.findMany({ where: { paymentId: pay.id, status: { in: ["RECEIVED", "ISSUED"] } } });
  for (const ch of cheques) {
    await tx.cheque.update({ where: { id: ch.id }, data: { status: "CANCELLED", movements: { create: { companyId: ch.companyId, fromStatus: ch.status, toStatus: "CANCELLED", date: new Date(), notes: `Payment ${pay.number} reversed`, createdById: ctx?.user.id ?? null } } } });
  }
}

/** Stand-alone cheque (not created from a payment): posts its initial entry against counterAccountId. */
export async function createStandaloneCheque(tx: Tx, ctx: Ctx, data: any) {
  if (!data.counterAccountId) throw badRequest("Counter account is required (the account this cheque settles)");
  const counter = await tx.account.findFirst({ where: { id: data.counterAccountId, companyId: data.companyId, isPostable: true, isActive: true } });
  if (!counter) throw badRequest("Counter account is invalid for this company");
  await resolveDocFx(tx, data.companyId, data, undefined, "issueDate");
  if (data.type === "ISSUED" || data.bankAccountId) {
    const b = await bankGl(tx, data.companyId, data.bankAccountId);
    assertSameCurrency(`Bank account ${b.bankName} ${b.accountNumber}`, b.currency, data.currency);
  }
  const amount = r2(data.amount);
  if (!amount.greaterThan(0)) throw unprocessable("Cheque amount must be greater than zero");
  const rate = D(data.exchangeRate ?? 1);
  const base = toBase(amount, rate);
  const fx = isForeign(data.currency) ? { currency: data.currency, fxAmount: amount, exchangeRate: rate } : {};
  const notes = await accountIdByKey(tx, data.companyId, data.type === "RECEIVED" ? "NOTES_RECEIVABLE" : "NOTES_PAYABLE");
  const party = data.partyType && data.partyId ? { partyType: data.partyType, partyId: data.partyId } : {};
  const lines: LineInput[] =
    data.type === "RECEIVED"
      ? [{ accountId: notes, debit: base, ...fx }, { accountId: counter.id, credit: base, ...party, ...fx }]
      : [{ accountId: counter.id, debit: base, ...party, ...fx }, { accountId: notes, credit: base, ...fx }];
  const je = await createJournalEntry(tx, ctx, {
    companyId: data.companyId,
    date: data.issueDate,
    description: `${data.type === "RECEIVED" ? "شيك وارد" : "شيك صادر"} رقم ${data.number} - ${data.partyName}`,
    status: "POSTED",
    sourceType: "CHEQUE",
    lines,
  });
  const ch = await tx.cheque.create({
    data: {
      ...data,
      status: data.type,
      journalEntryId: je.id,
      createdById: ctx.user.id,
      movements: { create: { companyId: data.companyId, toStatus: data.type, date: data.issueDate, journalEntryId: je.id, notes: data.notes ?? null, createdById: ctx.user.id } },
    },
  });
  await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: ch.id } });
  return ch;
}

async function adjustPaidAmount(tx: Tx, ch: Cheque, sign: 1 | -1) {
  if (!ch.paymentId) return;
  const pay = await tx.payment.findUnique({ where: { id: ch.paymentId } });
  if (!pay) return;
  const amt = r2(pay.amount).mul(sign);
  const check = async (total: unknown, paid: unknown) => {
    if (sign === 1 && r2(D(paid).plus(amt)).greaterThan(r2(D(total)))) throw unprocessable("Re-presenting this cheque would exceed the remaining balance of the linked invoice/extract");
  };
  if (pay.supplierInvoiceId) {
    const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: pay.supplierInvoiceId } });
    await check(inv.total, inv.paidAmount);
    await tx.supplierInvoice.update({ where: { id: inv.id }, data: { paidAmount: { increment: amt } } });
  }
  if (pay.contractorExtractId) {
    const ex = await tx.contractorExtract.findUniqueOrThrow({ where: { id: pay.contractorExtractId } });
    await check(ex.netAmount, ex.paidAmount);
    await tx.contractorExtract.update({ where: { id: ex.id }, data: { paidAmount: { increment: amt } } });
  }
  if (pay.clientExtractId) {
    const ex = await tx.clientExtract.findUniqueOrThrow({ where: { id: pay.clientExtractId } });
    await check(ex.netAmount, ex.paidAmount);
    await tx.clientExtract.update({ where: { id: ex.id }, data: { paidAmount: { increment: amt } } });
  }
}

export interface TransitionInput {
  date?: string | Date;
  bankAccountId?: string | null;
  charges?: number | string | null;
  notes?: string | null;
}

export async function chequeTransition(tx: Tx, ctx: Ctx, id: string, action: ChequeAction, input: TransitionInput = {}) {
  const ch = await tx.cheque.findUnique({ where: { id } });
  if (!ch) throw notFound();
  const to = TRANSITIONS[ch.type][ch.status]?.[action];
  if (!to) throw unprocessable(`Action "${action}" is not allowed for a ${ch.type.toLowerCase()} cheque in status ${ch.status}. Allowed: ${allowedActions(ch.type, ch.status).join(", ") || "none"}`);
  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) throw badRequest("Invalid date");
  if (date < ch.issueDate) throw unprocessable("Date cannot be before the cheque issue date");
  const charges = r2(D(input.charges ?? 0));
  if (charges.lessThan(0)) throw badRequest("Charges cannot be negative");
  let bankAccountId = ch.bankAccountId;
  if ((action === "collect" || action === "deposit") && input.bankAccountId) bankAccountId = input.bankAccountId;
  const c = ch.companyId;
  const acc = (k: string) => accountIdByKey(tx, c, k);
  // lifecycle entries use the cheque's original rate (no FX revaluation between receipt and clearing)
  const rate = D(ch.exchangeRate ?? 1);
  const base = toBase(ch.amount, rate);
  const fx = isForeign(ch.currency) ? { currency: ch.currency, fxAmount: r2(ch.amount), exchangeRate: rate } : {};
  const party: Partial<LineInput> = ch.partyType && ch.partyId ? { partyType: ch.partyType, partyId: ch.partyId } : {};
  const counter = async () => {
    if (!ch.counterAccountId) throw unprocessable("Cheque has no counter account");
    return ch.counterAccountId;
  };
  let lines: LineInput[] = [];
  const needsBank = ["collect", "deposit"].includes(action) || (action === "clear" && ch.status === "UNDER_COLLECTION") || (ch.type === "ISSUED" && action === "clear") || (action === "bounce" && ch.status === "DEPOSITED") || charges.greaterThan(0);
  const bank = needsBank ? await bankGl(tx, c, bankAccountId) : null;
  if (bank) assertSameCurrency(`Bank account ${bank.bankName} ${bank.accountNumber}`, bank.currency, ch.currency);

  if (ch.ledger) {
    const R = ch.type === "RECEIVED";
    switch (`${ch.type}:${ch.status}:${action}`) {
      case "RECEIVED:RECEIVED:collect":
        lines = [{ accountId: await acc("CHEQUES_UNDER_COLLECTION"), debit: base, ...fx }, { accountId: await acc("NOTES_RECEIVABLE"), credit: base, ...fx }];
        break;
      case "RECEIVED:RECEIVED:deposit":
        lines = [{ accountId: bank!.accountId, debit: base, ...fx }, { accountId: await acc("NOTES_RECEIVABLE"), credit: base, ...fx }];
        break;
      case "RECEIVED:UNDER_COLLECTION:clear":
        lines = [{ accountId: bank!.accountId, debit: base, ...fx }, { accountId: await acc("CHEQUES_UNDER_COLLECTION"), credit: base, ...fx }];
        break;
      case "RECEIVED:DEPOSITED:clear":
        lines = [];
        break;
      case "RECEIVED:UNDER_COLLECTION:bounce":
        lines = [{ accountId: await counter(), debit: base, ...party, ...fx }, { accountId: await acc("CHEQUES_UNDER_COLLECTION"), credit: base, ...fx }];
        break;
      case "RECEIVED:DEPOSITED:bounce":
        lines = [{ accountId: await counter(), debit: base, ...party, ...fx }, { accountId: bank!.accountId, credit: base, ...fx }];
        break;
      case "RECEIVED:RECEIVED:cancel":
        lines = [{ accountId: await counter(), debit: base, ...party, ...fx }, { accountId: await acc("NOTES_RECEIVABLE"), credit: base, ...fx }];
        break;
      case "RECEIVED:BOUNCED:represent":
        lines = [{ accountId: await acc("NOTES_RECEIVABLE"), debit: base, ...fx }, { accountId: await counter(), credit: base, ...party, ...fx }];
        break;
      case "ISSUED:ISSUED:clear":
        lines = [{ accountId: await acc("NOTES_PAYABLE"), debit: base, ...fx }, { accountId: bank!.accountId, credit: base, ...fx }];
        break;
      case "ISSUED:ISSUED:bounce":
      case "ISSUED:ISSUED:cancel":
        lines = [{ accountId: await acc("NOTES_PAYABLE"), debit: base, ...fx }, { accountId: await counter(), credit: base, ...party, ...fx }];
        break;
      case "ISSUED:BOUNCED:represent":
        lines = [{ accountId: await counter(), debit: base, ...party, ...fx }, { accountId: await acc("NOTES_PAYABLE"), credit: base, ...fx }];
        break;
      default:
        throw unprocessable("Unsupported cheque transition");
    }
    if (charges.greaterThan(0)) {
      // charges are in the bank account's (= cheque's) currency
      const chBase = toBase(charges, rate);
      const chFx = isForeign(ch.currency) ? { currency: ch.currency, fxAmount: charges, exchangeRate: rate } : {};
      lines.push({ accountId: await acc("BANK_CHARGES"), debit: chBase, description: "مصاريف بنكية", ...chFx }, { accountId: bank!.accountId, credit: chBase, description: "مصاريف بنكية", ...chFx });
    }
    void R;
  } else {
    await assertPeriodOpen(tx, c, date, "Cheque movements");
  }

  let journalEntryId: string | null = null;
  if (lines.length) {
    const je = await createJournalEntry(tx, ctx, {
      companyId: c,
      date,
      description: `شيك ${ch.number} (${ch.partyName}): ${ch.status} → ${to}`,
      status: "POSTED",
      sourceType: "CHEQUE",
      sourceId: ch.id,
      lines,
    });
    journalEntryId = je.id;
  }
  if (action === "bounce" || action === "cancel") await adjustPaidAmount(tx, ch, -1);
  if (action === "represent") await adjustPaidAmount(tx, ch, 1);
  const res = await tx.cheque.updateMany({ where: { id, status: ch.status }, data: { status: to, bankAccountId } });
  if (res.count !== 1) throw unprocessable("Cheque was modified concurrently");
  await tx.chequeMovement.create({ data: { chequeId: id, companyId: c, fromStatus: ch.status, toStatus: to, date, bankAccountId, charges, journalEntryId, notes: input.notes ?? null, createdById: ctx.user.id } });
  await audit(tx, ctx, { action: `CHEQUE_${action.toUpperCase()}`, entity: "cheque", entityId: id, companyId: c, before: { status: ch.status }, after: { status: to, journalEntryId, charges: charges.toFixed(2) } });
  return tx.cheque.findUnique({ where: { id } });
}
