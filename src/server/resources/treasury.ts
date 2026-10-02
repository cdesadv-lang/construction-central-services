/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { D } from "@/lib/money";
import { badRequest, unprocessable } from "@/lib/errors";
import { createChildAccount } from "../services/accounting";
import { settleCustody } from "../services/posting";
import type { ResourceDef } from "./engine";
import { optDate, optId, optStr, money, reqDate, reqId, reqStr } from "./z";

const EXPENSE_TYPES = ["MATERIALS", "LABOR", "EQUIPMENT", "TRANSPORT", "FUEL", "RENT", "CONTRACTORS", "ADMIN", "OTHER"] as const;
const METHODS = ["CASH", "BANK", "CHEQUE", "CUSTODY", "CREDIT"] as const;

async function balancesFor(accountIds: string[]) {
  const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds }, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return new Map(sums.map((s) => [s.accountId, D(s._sum.debit).minus(D(s._sum.credit))]));
}

function checkMethod(data: any, partial = false) {
  const m = data.paymentMethod ?? data.method;
  if (!m) return;
  if (m === "CASH" && !data.cashBoxId && !partial) throw badRequest("Cash box is required for cash payments");
  if ((m === "BANK" || m === "CHEQUE") && !data.bankAccountId && !partial) throw badRequest("Bank account is required");
  if (m === "CUSTODY" && !data.custodyId && !partial) throw badRequest("Custody is required");
  if (m === "CREDIT" && !data.supplierId && !partial) throw badRequest("Supplier is required for credit purchases");
}

const expenseFields = {
  number: optStr,
  projectId: optId,
  type: z.enum(EXPENSE_TYPES),
  date: reqDate,
  amount: money,
  paymentMethod: z.enum(METHODS),
  cashBoxId: optId,
  bankAccountId: optId,
  supplierId: optId,
  employeeId: optId,
  custodyId: optId,
  costCenterId: optId,
  documentId: optId,
  description: optStr,
};

const paymentFields = {
  number: optStr,
  type: z.enum(["SUPPLIER_PAYMENT", "CONTRACTOR_PAYMENT", "CONTRACTOR_ADVANCE", "CLIENT_RECEIPT"]),
  date: reqDate,
  amount: money,
  method: z.enum(["CASH", "BANK", "CHEQUE"]),
  cashBoxId: optId,
  bankAccountId: optId,
  chequeNumber: optStr,
  chequeDueDate: optDate,
  projectId: optId,
  supplierId: optId,
  supplierInvoiceId: optId,
  contractorId: optId,
  contractorExtractId: optId,
  clientId: optId,
  clientExtractId: optId,
  description: optStr,
};

async function fillPaymentParties(tx: any, data: any) {
  if (data.supplierInvoiceId) {
    const inv = await tx.supplierInvoice.findUnique({ where: { id: data.supplierInvoiceId } });
    data.supplierId ??= inv.supplierId;
    data.projectId ??= inv.projectId;
  }
  if (data.contractorExtractId) {
    const ex = await tx.contractorExtract.findUnique({ where: { id: data.contractorExtractId } });
    data.contractorId ??= ex.contractorId;
    data.projectId ??= ex.projectId;
  }
  if (data.clientExtractId) {
    const ex = await tx.clientExtract.findUnique({ where: { id: data.clientExtractId } });
    data.clientId ??= ex.clientId;
    data.projectId ??= ex.projectId;
  }
  const t = data.type;
  if (t === "SUPPLIER_PAYMENT" && !data.supplierId) throw badRequest("Supplier is required");
  if ((t === "CONTRACTOR_PAYMENT" || t === "CONTRACTOR_ADVANCE") && !data.contractorId) throw badRequest("Contractor is required");
  if (t === "CLIENT_RECEIPT" && !data.clientId) throw badRequest("Client is required");
  if (t !== "SUPPLIER_PAYMENT") { data.supplierId = t === "SUPPLIER_PAYMENT" ? data.supplierId : null; data.supplierInvoiceId = null; }
  if (t !== "CONTRACTOR_PAYMENT" && t !== "CONTRACTOR_ADVANCE") { data.contractorId = null; data.contractorExtractId = null; }
  if (t === "CONTRACTOR_ADVANCE") data.contractorExtractId = null;
  if (t !== "CLIENT_RECEIPT") { data.clientId = null; data.clientExtractId = null; }
  if (t === "SUPPLIER_PAYMENT") { /* keep */ }
  checkMethod(data);
  return data;
}

const treasuryFields = {
  number: optStr,
  kind: z.enum(["CASH_RECEIPT", "CASH_PAYMENT", "CASH_TRANSFER", "BANK_DEPOSIT", "BANK_WITHDRAWAL", "BANK_TRANSFER", "BANK_RECEIPT", "BANK_PAYMENT"]),
  date: reqDate,
  amount: money,
  cashBoxId: optId,
  toCashBoxId: optId,
  bankAccountId: optId,
  toBankAccountId: optId,
  counterAccountId: optId,
  projectId: optId,
  description: optStr,
};

export const treasuryResources: Record<string, ResourceDef> = {
  expenses: {
    model: "expense",
    module: "expenses",
    docType: "EXPENSE",
    create: z.object(expenseFields),
    update: z.object(expenseFields).partial(),
    search: ["number", "description", "supplier.name", "employee.name"],
    filters: ["status", "type", "paymentMethod", "supplierId", "employeeId", "custodyId", "costCenterId"],
    dateField: "date",
    projectField: "projectId",
    refs: { projectId: "project", cashBoxId: "cashBox", bankAccountId: "bankAccount", supplierId: "supplier", employeeId: "employee", custodyId: "custody", costCenterId: "costCenter", documentId: "document" },
    numbering: { key: "EXP", prefix: "EXP" },
    include: {
      project: { select: { code: true, name: true } },
      supplier: { select: { code: true, name: true } },
      employee: { select: { code: true, name: true } },
      costCenter: { select: { code: true, name: true } },
      cashBox: { select: { name: true } },
      bankAccount: { select: { bankName: true, accountNumber: true } },
      custody: { select: { number: true } },
    },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => {
      checkMethod(data);
      if (data.custodyId) {
        const c = await tx.custody.findUnique({ where: { id: data.custodyId } });
        data.employeeId ??= c?.employeeId;
        data.projectId ??= c?.projectId;
      }
      if (data.projectId && !data.costCenterId) {
        const cc = await tx.costCenter.findFirst({ where: { projectId: data.projectId } });
        data.costCenterId = cc?.id ?? null;
      }
      return data;
    },
    prepareUpdate: async (_tx, _ctx, existing, data) => {
      checkMethod({ ...existing, ...data });
      return data;
    },
  },
  custodies: {
    model: "custody",
    module: "custody",
    docType: "CUSTODY",
    create: z.object({ number: optStr, employeeId: reqId, amount: money, date: reqDate, purpose: reqStr, cashBoxId: reqId, projectId: optId }),
    update: z.object({ employeeId: reqId, amount: money, date: reqDate, purpose: reqStr, cashBoxId: reqId, projectId: optId }).partial(),
    search: ["number", "purpose", "employee.name"],
    filters: ["status", "settlementStatus", "employeeId"],
    dateField: "date",
    projectField: "projectId",
    refs: { employeeId: "employee", cashBoxId: "cashBox", projectId: "project" },
    numbering: { key: "CUS", prefix: "CUS" },
    include: { employee: { select: { code: true, name: true } }, cashBox: { select: { name: true } }, project: { select: { code: true, name: true } } },
    orderBy: [{ date: "desc" }],
    decorate: async (rows) => {
      const sums = await prisma.expense.groupBy({ by: ["custodyId"], where: { custodyId: { in: rows.map((r) => r.id) }, status: "POSTED" }, _sum: { amount: true } });
      const m = new Map(sums.map((s) => [s.custodyId, D(s._sum.amount)]));
      return rows.map((r) => {
        const spent = m.get(r.id) ?? D(0);
        return { ...r, spent: spent.toFixed(2), remaining: D(r.amount).minus(spent).minus(D(r.returnedAmount)).toFixed(2) };
      });
    },
    detail: async (tx, row) => ({ expenses: await tx.expense.findMany({ where: { custodyId: row.id }, orderBy: { date: "asc" } }) }),
    actions: { settle: { perm: "approve", run: (tx, ctx, existing) => settleCustody(tx, ctx, existing.id) } },
  },
  payments: {
    model: "payment",
    module: "payments",
    docType: "PAYMENT",
    create: z.object(paymentFields),
    update: z.object(paymentFields).partial(),
    search: ["number", "description", "chequeNumber", "supplier.name", "contractor.name", "client.name"],
    filters: ["status", "type", "method", "supplierId", "contractorId", "clientId", "supplierInvoiceId", "contractorExtractId", "clientExtractId"],
    dateField: "date",
    projectField: "projectId",
    refs: {
      projectId: "project",
      supplierId: "supplier",
      supplierInvoiceId: "supplierInvoice",
      contractorId: "contractor",
      contractorExtractId: "contractorExtract",
      clientId: "client",
      clientExtractId: "clientExtract",
      cashBoxId: "cashBox",
      bankAccountId: "bankAccount",
    },
    numbering: { key: "PAY", prefix: "PAY" },
    include: {
      supplier: { select: { code: true, name: true } },
      contractor: { select: { code: true, name: true } },
      client: { select: { code: true, name: true } },
      project: { select: { code: true, name: true } },
      supplierInvoice: { select: { number: true } },
      contractorExtract: { select: { number: true } },
      clientExtract: { select: { number: true } },
      cashBox: { select: { name: true } },
      bankAccount: { select: { bankName: true, accountNumber: true } },
    },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => fillPaymentParties(tx, data),
    prepareUpdate: async (tx, _ctx, existing, data) => {
      const merged = await fillPaymentParties(tx, { ...existing, ...data });
      const out: any = {};
      for (const k of Object.keys(paymentFields)) if (k !== "number") out[k] = merged[k];
      return out;
    },
  },
  "cash-boxes": {
    model: "cashBox",
    module: "treasury",
    create: z.object({ code: optStr, name: reqStr, keeper: optStr }),
    update: z.object({ name: reqStr, keeper: optStr }).partial(),
    search: ["code", "name", "keeper"],
    numbering: { key: "CB", prefix: "CB", field: "code" },
    include: { account: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
    prepareCreate: async (tx, _ctx, data) => {
      const acc = await createChildAccount(tx, data.companyId, "CASH_PARENT", data.name);
      return { ...data, accountId: acc.id };
    },
    decorate: async (rows) => {
      const m = await balancesFor(rows.map((r) => r.accountId));
      return rows.map((r) => ({ ...r, balance: (m.get(r.accountId) ?? D(0)).toFixed(2) }));
    },
    canDelete: async (tx, row) => ((await tx.journalLine.count({ where: { accountId: row.accountId } })) ? "Cash box has transactions" : null),
    afterDelete: async (tx, row) => {
      await tx.account.delete({ where: { id: row.accountId } });
    },
  },
  "bank-accounts": {
    model: "bankAccount",
    module: "banks",
    create: z.object({ code: optStr, bankName: reqStr, branch: optStr, accountNumber: reqStr, iban: optStr, currency: optStr }),
    update: z.object({ bankName: reqStr, branch: optStr, accountNumber: reqStr, iban: optStr }).partial(),
    search: ["code", "bankName", "accountNumber", "iban"],
    numbering: { key: "BNK", prefix: "BNK", field: "code" },
    include: { account: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
    prepareCreate: async (tx, _ctx, data) => {
      const acc = await createChildAccount(tx, data.companyId, "BANK_PARENT", `${data.bankName} - ${data.accountNumber}`);
      return { ...data, currency: data.currency ?? "EGP", accountId: acc.id };
    },
    decorate: async (rows) => {
      const m = await balancesFor(rows.map((r) => r.accountId));
      return rows.map((r) => ({ ...r, balance: (m.get(r.accountId) ?? D(0)).toFixed(2) }));
    },
    canDelete: async (tx, row) => ((await tx.journalLine.count({ where: { accountId: row.accountId } })) ? "Bank account has transactions" : null),
    afterDelete: async (tx, row) => {
      await tx.account.delete({ where: { id: row.accountId } });
    },
  },
  "treasury-transactions": {
    model: "treasuryTransaction",
    module: "treasury",
    docType: "TREASURY",
    create: z.object(treasuryFields),
    update: z.object(treasuryFields).partial(),
    search: ["number", "description"],
    filters: ["status", "kind", "cashBoxId", "bankAccountId"],
    dateField: "date",
    projectField: "projectId",
    refs: { cashBoxId: "cashBox", toCashBoxId: "cashBox", bankAccountId: "bankAccount", toBankAccountId: "bankAccount", counterAccountId: "account", projectId: "project" },
    numbering: { key: "TRX", prefix: "TRX" },
    include: { project: { select: { code: true, name: true } } },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (_tx, _ctx, data) => {
      const k: string = data.kind;
      const need = (f: string, label: string) => {
        if (!data[f]) throw badRequest(`${label} is required for ${k}`);
      };
      if (k.startsWith("CASH") || k === "BANK_DEPOSIT" || k === "BANK_WITHDRAWAL") need("cashBoxId", "Cash box");
      if (k.startsWith("BANK")) need("bankAccountId", "Bank account");
      if (k === "CASH_TRANSFER") need("toCashBoxId", "Destination cash box");
      if (k === "BANK_TRANSFER") need("toBankAccountId", "Destination bank account");
      if (["CASH_RECEIPT", "CASH_PAYMENT", "BANK_RECEIPT", "BANK_PAYMENT"].includes(k)) need("counterAccountId", "Counter account");
      return data;
    },
  },
  cheques: {
    model: "cheque",
    module: "banks",
    create: z.object({ number: reqStr, type: z.enum(["ISSUED", "RECEIVED"]), bankAccountId: reqId, amount: money, issueDate: reqDate, dueDate: reqDate, partyName: reqStr, notes: optStr }),
    update: z.object({ status: z.enum(["PENDING", "CLEARED", "BOUNCED", "CANCELLED"]), dueDate: reqDate, notes: optStr }).partial(),
    search: ["number", "partyName"],
    filters: ["status", "type", "bankAccountId"],
    dateField: "dueDate",
    refs: { bankAccountId: "bankAccount" },
    include: { bankAccount: { select: { bankName: true, accountNumber: true } } },
    orderBy: [{ dueDate: "asc" }],
    canDelete: async (_tx, row) => (row.paymentId ? "Cheque is linked to a payment — reverse the payment instead" : null),
  },
  "bank-reconciliations": {
    model: "bankReconciliation",
    module: "banks",
    readOnly: true,
    filters: ["bankAccountId"],
    include: { bankAccount: { select: { bankName: true, accountNumber: true } } },
    orderBy: [{ statementDate: "desc" }],
  },
};

void unprocessable;
