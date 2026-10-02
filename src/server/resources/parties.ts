/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { D, r2 } from "@/lib/money";
import { badRequest } from "@/lib/errors";
import { computeClientExtract, computeContractorExtract } from "../services/posting";
import type { ResourceDef } from "./engine";
import { optDate, optId, optStr, money, pct, reqDate, reqId, reqStr, optMoney, optInt, fxFields, currency, optRate } from "./z";
import { unprocessable } from "@/lib/errors";
import { resolveDocFx } from "../services/fx";

const EXPENSE_TYPES = ["MATERIALS", "LABOR", "EQUIPMENT", "TRANSPORT", "FUEL", "RENT", "CONTRACTORS", "ADMIN", "OTHER"] as const;

async function partyLedgerBalance(key: string, partyType: string, ids: string[]) {
  if (!ids.length) return new Map<string, { debit: number; credit: number }>();
  const accs = await prisma.account.findMany({ where: { systemKey: key }, select: { id: true } });
  const sums = await prisma.journalLine.groupBy({
    by: ["partyId"],
    where: { accountId: { in: accs.map((a) => a.id) }, partyType, partyId: { in: ids }, entry: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return new Map(sums.map((s) => [s.partyId!, { debit: Number(D(s._sum.debit)), credit: Number(D(s._sum.credit)) }]));
}

const supplierFields = {
  code: optStr,
  name: reqStr,
  taxNumber: optStr,
  contactPerson: optStr,
  phone: optStr,
  email: optStr,
  address: optStr,
  paymentTermsDays: optInt,
  bankName: optStr,
  bankAccount: optStr,
};
const contractorFields = { code: optStr, name: reqStr, specialty: optStr, taxNumber: optStr, contactPerson: optStr, phone: optStr, address: optStr };
const contractFields = {
  number: optStr,
  contractorId: reqId,
  projectId: reqId,
  scope: reqStr,
  contractValue: money,
  retentionPct: pct,
  taxPct: pct,
  insurancePct: pct,
  advanceRecoveryPct: pct.optional(),
  startDate: optDate,
  endDate: optDate,
  /** contract currency (extracts and their payments are in it) */
  currency,
};

export const partyResources: Record<string, ResourceDef> = {
  suppliers: {
    model: "supplier",
    module: "suppliers",
    create: z.object(supplierFields),
    update: z.object(supplierFields).partial(),
    search: ["code", "name", "taxNumber", "phone"],
    numbering: { key: "SUP", prefix: "SUP", field: "code" },
    orderBy: { code: "asc" },
    include: { company: { select: { name: true } } },
    prepareCreate: async (_tx, _ctx, data) => ({ ...data, paymentTermsDays: data.paymentTermsDays ?? 30 }),
    decorate: async (rows) => {
      const m = await partyLedgerBalance("AP_SUPPLIERS", "SUPPLIER", rows.map((r) => r.id));
      return rows.map((r) => {
        const b = m.get(r.id) ?? { debit: 0, credit: 0 };
        return { ...r, totalInvoiced: r2(b.credit).toFixed(2), totalPaid: r2(b.debit).toFixed(2), balance: r2(b.credit - b.debit).toFixed(2) };
      });
    },
  },
  "supplier-invoices": {
    model: "supplierInvoice",
    module: "suppliers",
    docType: "SUPPLIER_INVOICE",
    create: z.object({
      number: optStr,
      supplierRef: optStr,
      supplierId: reqId,
      projectId: optId,
      purchaseOrderId: optId,
      date: reqDate,
      dueDate: optDate,
      category: z.enum(EXPENSE_TYPES).optional(),
      description: optStr,
      subtotal: money,
      taxAmount: optMoney,
      ...fxFields,
    }),
    update: z
      .object({ supplierRef: optStr, supplierId: reqId, projectId: optId, purchaseOrderId: optId, date: reqDate, dueDate: optDate, category: z.enum(EXPENSE_TYPES), description: optStr, subtotal: money, taxAmount: optMoney, ...fxFields })
      .partial(),
    search: ["number", "supplierRef", "description", "supplier.name"],
    filters: ["status", "supplierId", "projectId", "category"],
    dateField: "date",
    projectField: "projectId",
    refs: { supplierId: "supplier", projectId: "project", purchaseOrderId: "purchaseOrder" },
    numbering: { key: "SINV", prefix: "SINV" },
    include: { supplier: { select: { id: true, code: true, name: true } }, project: { select: { code: true, name: true } }, purchaseOrder: { select: { number: true } } },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => {
      const s = await tx.supplier.findUnique({ where: { id: data.supplierId } });
      const total = r2(D(data.subtotal).plus(D(data.taxAmount)));
      const dueDate = data.dueDate ?? new Date(new Date(data.date).getTime() + (s?.paymentTermsDays ?? 30) * 86400000);
      return resolveDocFx(tx, data.companyId, { ...data, total, dueDate });
    },
    prepareUpdate: async (tx, _ctx, existing, data) => {
      const subtotal = data.subtotal ?? existing.subtotal;
      const tax = data.taxAmount ?? existing.taxAmount;
      return resolveDocFx(tx, existing.companyId, { ...data, total: r2(D(subtotal).plus(D(tax))) }, existing);
    },
    decorate: async (rows) => rows.map((r) => ({ ...r, remaining: D(r.total).minus(D(r.paidAmount)).toFixed(2) })),
  },
  contractors: {
    model: "contractor",
    module: "contractors",
    create: z.object(contractorFields),
    update: z.object(contractorFields).partial(),
    search: ["code", "name", "specialty", "phone"],
    numbering: { key: "CON", prefix: "CON", field: "code" },
    orderBy: { code: "asc" },
    include: { company: { select: { name: true } } },
    decorate: async (rows) => {
      const ids = rows.map((r) => r.id);
      const [contracts, extracts] = await Promise.all([
        prisma.subContract.groupBy({ by: ["contractorId"], where: { contractorId: { in: ids } }, _sum: { contractValue: true } }),
        prisma.contractorExtract.groupBy({
          by: ["contractorId"],
          where: { contractorId: { in: ids }, status: "POSTED" },
          _sum: { currentGross: true, netAmount: true, paidAmount: true, retentionAmount: true },
        }),
      ]);
      const cm = new Map(contracts.map((c) => [c.contractorId, c._sum.contractValue]));
      const em = new Map(extracts.map((e) => [e.contractorId, e._sum]));
      return rows.map((r) => {
        const e = em.get(r.id);
        return {
          ...r,
          contractValue: D(cm.get(r.id)).toFixed(2),
          executed: D(e?.currentGross).toFixed(2),
          totalNet: D(e?.netAmount).toFixed(2),
          paid: D(e?.paidAmount).toFixed(2),
          retention: D(e?.retentionAmount).toFixed(2),
          remaining: D(e?.netAmount).minus(D(e?.paidAmount)).toFixed(2),
        };
      });
    },
  },
  subcontracts: {
    model: "subContract",
    module: "contractors",
    create: z.object(contractFields),
    update: z.object(contractFields).partial(),
    search: ["number", "scope", "contractor.name"],
    filters: ["contractorId", "projectId"],
    projectField: "projectId",
    refs: { contractorId: "contractor", projectId: "project" },
    numbering: { key: "SC", prefix: "SC" },
    include: { contractor: { select: { id: true, code: true, name: true } }, project: { select: { id: true, code: true, name: true } } },
    orderBy: { number: "asc" },
    decorate: async (rows) => {
      const sums = await prisma.contractorExtract.groupBy({
        by: ["contractId"],
        where: { contractId: { in: rows.map((r) => r.id) }, status: "POSTED" },
        _sum: { currentGross: true, netAmount: true, paidAmount: true },
      });
      const m = new Map(sums.map((s) => [s.contractId, s._sum]));
      return rows.map((r) => {
        const s = m.get(r.id);
        return {
          ...r,
          executed: D(s?.currentGross).toFixed(2),
          executedPct: D(r.contractValue).isZero() ? "0" : D(s?.currentGross).div(D(r.contractValue)).mul(100).toFixed(1),
          paid: D(s?.paidAmount).toFixed(2),
          remaining: D(s?.netAmount).minus(D(s?.paidAmount)).toFixed(2),
          remainingWork: D(r.contractValue).minus(D(s?.currentGross)).toFixed(2),
        };
      });
    },
    prepareUpdate: async (tx, _ctx, existing, data) => {
      if (data.currency && data.currency !== existing.currency && (await tx.contractorExtract.count({ where: { contractId: existing.id, status: { not: "CANCELLED" } } })))
        throw unprocessable("The contract currency cannot change once extracts exist");
      return data;
    },
    canDelete: async (tx, row) => ((await tx.contractorExtract.count({ where: { contractId: row.id } })) ? "Contract has extracts" : null),
  },
  "contractor-extracts": {
    model: "contractorExtract",
    module: "contractorExtracts",
    docType: "CONTRACTOR_EXTRACT",
    // currency comes from the contract; the rate is entered or taken from the rate table for the extract date
    create: z.object({ number: optStr, contractId: reqId, periodFrom: reqDate, periodTo: reqDate, date: reqDate, cumulativeGross: money, otherDeductions: optMoney, description: optStr, exchangeRate: optRate }),
    update: z.object({ periodFrom: reqDate, periodTo: reqDate, date: reqDate, cumulativeGross: money, otherDeductions: optMoney, description: optStr, exchangeRate: optRate }).partial(),
    search: ["number", "description", "contractor.name"],
    filters: ["status", "contractorId", "contractId", "projectId"],
    dateField: "date",
    projectField: "projectId",
    refs: { contractId: "subContract" },
    numbering: { key: "CEX", prefix: "CEX" },
    include: {
      contractor: { select: { id: true, code: true, name: true } },
      contract: { select: { id: true, number: true, scope: true, contractValue: true, retentionPct: true, taxPct: true, insurancePct: true } },
      project: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => {
      if (new Date(data.periodTo) < new Date(data.periodFrom)) throw badRequest("Period end must be after period start");
      const { contract, calc } = await computeContractorExtract(tx, data);
      await resolveDocFx(tx, data.companyId, Object.assign(data, { currency: contract.currency }));
      return { ...data, ...calc, contractorId: contract.contractorId, projectId: contract.projectId };
    },
    prepareUpdate: async (tx, _ctx, existing, data) => {
      const { calc } = await computeContractorExtract(tx, {
        companyId: existing.companyId,
        contractId: existing.contractId,
        cumulativeGross: data.cumulativeGross ?? existing.cumulativeGross,
        otherDeductions: data.otherDeductions ?? existing.otherDeductions,
        excludeId: existing.id,
      });
      await resolveDocFx(tx, existing.companyId, Object.assign(data, { currency: existing.currency }), existing);
      return { ...data, ...calc };
    },
    decorate: async (rows) => rows.map((r) => ({ ...r, remaining: D(r.netAmount).minus(D(r.paidAmount)).toFixed(2) })),
  },
  "client-extracts": {
    model: "clientExtract",
    module: "clientExtracts",
    docType: "CLIENT_EXTRACT",
    // currency comes from the project (billing currency); rate entered or taken from the rate table
    create: z.object({ number: optStr, projectId: reqId, clientId: optId, periodFrom: reqDate, periodTo: reqDate, date: reqDate, cumulativeWork: money, otherDeductions: optMoney, description: optStr, exchangeRate: optRate }),
    update: z.object({ periodFrom: reqDate, periodTo: reqDate, date: reqDate, cumulativeWork: money, otherDeductions: optMoney, description: optStr, exchangeRate: optRate }).partial(),
    search: ["number", "description", "client.name", "project.name"],
    filters: ["status", "clientId", "projectId"],
    dateField: "date",
    projectField: "projectId",
    refs: { projectId: "project", clientId: "client" },
    numbering: { key: "CLX", prefix: "CLX" },
    include: { project: { select: { id: true, code: true, name: true, contractValue: true } }, client: { select: { id: true, code: true, name: true } } },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => {
      if (new Date(data.periodTo) < new Date(data.periodFrom)) throw badRequest("Period end must be after period start");
      const { project, calc } = await computeClientExtract(tx, data);
      const clientId = data.clientId ?? project.clientId;
      if (!clientId) throw badRequest("Project has no client; select a client");
      await resolveDocFx(tx, data.companyId, Object.assign(data, { currency: project.currency }));
      return { ...data, ...calc, clientId };
    },
    prepareUpdate: async (tx, _ctx, existing, data) => {
      const { calc } = await computeClientExtract(tx, {
        companyId: existing.companyId,
        projectId: existing.projectId,
        cumulativeWork: data.cumulativeWork ?? existing.cumulativeWork,
        otherDeductions: data.otherDeductions ?? existing.otherDeductions,
        excludeId: existing.id,
      });
      await resolveDocFx(tx, existing.companyId, Object.assign(data, { currency: existing.currency }), existing);
      return { ...data, ...calc };
    },
    decorate: async (rows) => rows.map((r) => ({ ...r, remaining: D(r.netAmount).minus(D(r.paidAmount)).toFixed(2) })),
  },
};
