/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { D, r2, sum } from "@/lib/money";
import { badRequest, unprocessable } from "@/lib/errors";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import { buildPayrollLines } from "../services/payroll";
import { monthEnd } from "../services/posting";
import type { ResourceDef } from "./engine";
import { optDate, optId, optStr, money, pct, reqDate, reqId, reqStr, optMoney, optInt, month, currency, fxFields } from "./z";
import { resolveDocFx } from "../services/fx";

const qty = z.coerce.number().positive().max(1e9);
const prItem = z.object({ description: reqStr, unit: optStr, quantity: qty });
// Quotation lines must reference a line of the purchase request by id; description/quantity default from it.
const qItem = z.object({ requestItemId: reqId, description: optStr, quantity: qty.optional(), unitPrice: money });
const poItem = z.object({ description: reqStr, unit: optStr, quantity: qty, unitPrice: money });

const prItems = (items: any[]) => items.map((i) => ({ description: i.description, unit: i.unit || "unit", quantity: i.quantity }));
/** Validates quotation lines against the request's items (by id) and fills defaults. */
async function quotationItems(tx: any, requestId: string, items: any[]) {
  const reqItems = await tx.purchaseRequestItem.findMany({ where: { requestId } });
  const byId = new Map<string, any>(reqItems.map((i: any) => [i.id, i]));
  const seen = new Set<string>();
  return items.map((it) => {
    const ri = byId.get(it.requestItemId);
    if (!ri) throw badRequest("Quotation line does not reference an item of this purchase request");
    if (seen.has(ri.id)) throw badRequest(`Request item "${ri.description}" is quoted more than once`);
    seen.add(ri.id);
    return { requestItemId: ri.id, description: it.description || ri.description, quantity: it.quantity ?? ri.quantity, unitPrice: it.unitPrice };
  });
}

const priced = (items: any[]) => items.map((i) => ({ ...i, unit: i.unit || "unit", total: r2(D(i.quantity).mul(D(i.unitPrice))) }));

function poTotals(items: any[], taxPct: unknown) {
  const p = priced(items);
  const subtotal = sum(p.map((i) => i.total));
  const taxAmount = r2(subtotal.mul(D(taxPct ?? 14)).div(100));
  return { items: p, subtotal: r2(subtotal), taxAmount, total: r2(subtotal.plus(taxAmount)) };
}

const employeeFields = {
  code: optStr,
  name: reqStr,
  nationalId: optStr,
  phone: optStr,
  email: optStr,
  departmentId: optId,
  positionId: optId,
  projectId: optId,
  hireDate: optDate,
  basicSalary: money,
  allowances: optMoney,
  insuranceSalary: optMoney,
  bankAccount: optStr,
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
  /** salary currency (payrolls are run per currency) */
  salaryCurrency: currency,
};

export const opsResources: Record<string, ResourceDef> = {
  "purchase-requests": {
    model: "purchaseRequest",
    module: "procurement",
    create: z.object({ number: optStr, projectId: optId, date: reqDate, requestedBy: optStr, notes: optStr, items: z.array(prItem).min(1) }),
    update: z.object({ projectId: optId, date: reqDate, requestedBy: optStr, notes: optStr, items: z.array(prItem).min(1) }).partial(),
    search: ["number", "notes", "requestedBy"],
    filters: ["status", "projectId"],
    dateField: "date",
    projectField: "projectId",
    refs: { projectId: "project" },
    numbering: { key: "PR", prefix: "PR" },
    editableStatuses: ["DRAFT", "SUBMITTED"],
    include: { project: { select: { code: true, name: true } }, items: true, _count: { select: { quotations: true, orders: true } } },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (_tx, ctx, data) => ({ ...data, createdById: ctx.user.id, items: { create: prItems(data.items) } }),
    prepareUpdate: async (tx, _ctx, e, data) => {
      if (!data.items) return data;
      // Quotation lines reference request items by id, so items are locked once quotations exist.
      if (await tx.quotation.count({ where: { requestId: e.id } })) throw unprocessable("Items cannot be changed after quotations were received — cancel the quotations or create a new request");
      return { ...data, items: { deleteMany: {}, create: prItems(data.items) } };
    },
    actions: {
      submit: {
        perm: "create",
        run: async (tx, ctx, e) => {
          if (e.status !== "DRAFT") throw unprocessable("Only draft requests can be submitted");
          await audit(tx, ctx, { action: "SUBMIT", entity: "purchaseRequest", entityId: e.id, companyId: e.companyId });
          return tx.purchaseRequest.update({ where: { id: e.id }, data: { status: "SUBMITTED" } });
        },
      },
      close: { perm: "edit", run: async (tx, _ctx, e) => tx.purchaseRequest.update({ where: { id: e.id }, data: { status: "CLOSED" } }) },
      cancel: {
        perm: "edit",
        run: async (tx, _ctx, e) => {
          if (["ORDERED", "CLOSED"].includes(e.status)) throw unprocessable("Ordered/closed requests cannot be cancelled");
          return tx.purchaseRequest.update({ where: { id: e.id }, data: { status: "CANCELLED" } });
        },
      },
    },
  },
  quotations: {
    model: "quotation",
    module: "procurement",
    create: z.object({ number: optStr, requestId: reqId, supplierId: reqId, date: reqDate, validUntil: optDate, deliveryDays: optInt, notes: optStr, items: z.array(qItem).min(1) }),
    update: z.object({ supplierId: reqId, date: reqDate, validUntil: optDate, deliveryDays: optInt, notes: optStr, items: z.array(qItem).min(1) }).partial(),
    search: ["number", "notes", "supplier.name"],
    filters: ["requestId", "supplierId"],
    boolFilters: ["selected"],
    dateField: "date",
    refs: { requestId: "purchaseRequest", supplierId: "supplier" },
    numbering: { key: "QT", prefix: "QT" },
    include: { supplier: { select: { code: true, name: true } }, request: { select: { number: true, status: true } }, items: true },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, _ctx, data) => {
      const pr = await tx.purchaseRequest.findUnique({ where: { id: data.requestId } });
      if (!pr || ["CANCELLED", "CLOSED"].includes(pr.status)) throw unprocessable("Purchase request is closed or cancelled");
      const items = priced(await quotationItems(tx, data.requestId, data.items));
      return { ...data, total: sum(items.map((i) => i.total)), items: { create: items.map(({ unit: _u, ...i }) => i) } };
    },
    prepareUpdate: async (tx, _ctx, e, data) => {
      if (!data.items) return data;
      if (await tx.purchaseOrder.count({ where: { quotationId: e.id, status: { not: "CANCELLED" } } })) throw unprocessable("A purchase order was already created from this quotation");
      const items = priced(await quotationItems(tx, e.requestId, data.items));
      return { ...data, total: sum(items.map((i) => i.total)), items: { deleteMany: {}, create: items.map(({ unit: _u, ...i }) => i) } };
    },
    afterCreate: async (tx, _ctx, row) => {
      await tx.purchaseRequest.updateMany({ where: { id: row.requestId, status: { in: ["DRAFT", "SUBMITTED"] } }, data: { status: "QUOTING" } });
    },
    actions: {
      select: {
        perm: "edit",
        run: async (tx, ctx, q) => {
          await tx.quotation.updateMany({ where: { requestId: q.requestId }, data: { selected: false } });
          await audit(tx, ctx, { action: "SELECT_QUOTATION", entity: "quotation", entityId: q.id, companyId: q.companyId });
          return tx.quotation.update({ where: { id: q.id }, data: { selected: true } });
        },
      },
      "create-order": {
        perm: "create",
        run: async (tx, ctx, q) => {
          const full = await tx.quotation.findUnique({ where: { id: q.id }, include: { items: { include: { requestItem: true } }, request: true } });
          if (!full) throw badRequest("Quotation not found");
          const existing = await tx.purchaseOrder.findFirst({ where: { quotationId: q.id, status: { not: "CANCELLED" } } });
          if (existing) throw unprocessable(`Purchase order ${existing.number} already exists for this quotation`);
          await tx.quotation.updateMany({ where: { requestId: q.requestId }, data: { selected: false } });
          await tx.quotation.update({ where: { id: q.id }, data: { selected: true } });
          const t = poTotals(
            full.items.map((i) => ({ requestItemId: i.requestItemId, quotationItemId: i.id, description: i.description, unit: i.requestItem.unit, quantity: i.quantity, unitPrice: i.unitPrice })),
            14,
          );
          const po = await tx.purchaseOrder.create({
            data: {
              companyId: q.companyId,
              number: await nextNumber(tx, q.companyId, "PO", "PO"),
              requestId: q.requestId,
              quotationId: q.id,
              supplierId: q.supplierId,
              projectId: full.request.projectId,
              date: new Date(),
              subtotal: t.subtotal,
              taxPct: 14,
              taxAmount: t.taxAmount,
              total: t.total,
              createdById: ctx.user.id,
              items: { create: t.items },
            },
          });
          await audit(tx, ctx, { action: "CREATE", entity: "purchaseOrder", entityId: po.id, companyId: po.companyId, after: po });
          return po;
        },
      },
    },
  },
  "purchase-orders": {
    model: "purchaseOrder",
    module: "procurement",
    docType: "PURCHASE_ORDER",
    create: z.object({ number: optStr, requestId: optId, supplierId: reqId, projectId: optId, date: reqDate, taxPct: pct.optional(), notes: optStr, items: z.array(poItem).min(1) }),
    update: z.object({ supplierId: reqId, projectId: optId, date: reqDate, taxPct: pct, notes: optStr, items: z.array(poItem).min(1) }).partial(),
    search: ["number", "notes", "supplier.name"],
    filters: ["status", "supplierId", "projectId", "requestId"],
    boolFilters: ["received"],
    dateField: "date",
    projectField: "projectId",
    refs: { requestId: "purchaseRequest", supplierId: "supplier", projectId: "project" },
    numbering: { key: "PO", prefix: "PO" },
    include: { supplier: { select: { code: true, name: true } }, project: { select: { code: true, name: true } }, request: { select: { number: true } }, items: true, _count: { select: { receipts: true, invoices: true } } },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (_tx, _ctx, data) => {
      const t = poTotals(data.items, data.taxPct ?? 14);
      return { ...data, taxPct: data.taxPct ?? 14, subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, items: { create: t.items } };
    },
    prepareUpdate: async (_tx, _ctx, e, data) => {
      if (!data.items && data.taxPct === undefined) return data;
      const items = data.items ?? (await prisma.purchaseOrderItem.findMany({ where: { orderId: e.id } })).map((i) => ({ description: i.description, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice }));
      const t = poTotals(items, data.taxPct ?? e.taxPct);
      return { ...data, subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, items: { deleteMany: {}, create: t.items } };
    },
  },
  "goods-receipts": {
    model: "goodsReceipt",
    module: "procurement",
    noDelete: true,
    create: z.object({ number: optStr, orderId: reqId, date: reqDate, notes: optStr, items: z.array(z.object({ orderItemId: reqId, quantity: qty })).min(1) }),
    search: ["number", "notes"],
    filters: ["orderId"],
    dateField: "date",
    refs: { orderId: "purchaseOrder" },
    numbering: { key: "GRN", prefix: "GRN" },
    include: { order: { select: { number: true, supplier: { select: { name: true } } } }, items: true },
    orderBy: [{ date: "desc" }],
    prepareCreate: async (tx, ctx, data) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: data.orderId }, include: { items: true } });
      if (!po || po.status !== "POSTED") throw unprocessable("Goods can only be received against an approved & issued (posted) purchase order");
      const byId = new Map(po.items.map((i) => [i.id, i]));
      const create = [];
      for (const it of data.items) {
        const oi = byId.get(it.orderItemId);
        if (!oi) throw badRequest("Item does not belong to this purchase order");
        const remaining = D(oi.quantity).minus(D(oi.receivedQty));
        if (D(it.quantity).greaterThan(remaining)) throw unprocessable(`Received qty for "${oi.description}" exceeds remaining (${remaining.toString()})`);
        await tx.purchaseOrderItem.update({ where: { id: oi.id }, data: { receivedQty: { increment: it.quantity } } });
        create.push({ orderItemId: oi.id, description: oi.description, quantity: it.quantity });
      }
      const after = await tx.purchaseOrderItem.findMany({ where: { orderId: po.id } });
      if (after.every((i) => D(i.receivedQty).greaterThanOrEqualTo(D(i.quantity)))) await tx.purchaseOrder.update({ where: { id: po.id }, data: { received: true } });
      return { ...data, createdById: ctx.user.id, items: { create } };
    },
  },
  departments: {
    model: "department",
    module: "hr",
    create: z.object({ code: optStr, name: reqStr }),
    update: z.object({ code: reqStr, name: reqStr }).partial(),
    search: ["code", "name"],
    numbering: { key: "DEP", prefix: "DEP", field: "code" },
    include: { _count: { select: { employees: true } } },
    orderBy: { code: "asc" },
  },
  positions: {
    model: "position",
    module: "hr",
    create: z.object({ code: optStr, name: reqStr }),
    update: z.object({ code: reqStr, name: reqStr }).partial(),
    search: ["code", "name"],
    numbering: { key: "POS", prefix: "POS", field: "code" },
    include: { _count: { select: { employees: true } } },
    orderBy: { code: "asc" },
  },
  employees: {
    model: "employee",
    module: "hr",
    create: z.object(employeeFields),
    update: z.object(employeeFields).partial(),
    search: ["code", "name", "nationalId", "phone"],
    filters: ["status", "departmentId", "positionId", "projectId"],
    refs: { departmentId: "department", positionId: "position", projectId: "project" },
    numbering: { key: "EMP", prefix: "EMP", field: "code" },
    include: { department: { select: { name: true } }, position: { select: { name: true } }, project: { select: { code: true, name: true } }, allocations: { include: { project: { select: { code: true, name: true } } } } },
    orderBy: { code: "asc" },
    prepareCreate: async (_tx, _ctx, data) => ({ ...data, insuranceSalary: data.insuranceSalary || data.basicSalary }),
    canDelete: async (tx, row) => ((await tx.custody.count({ where: { employeeId: row.id } })) + (await tx.payrollLine.count({ where: { employeeId: row.id } })) ? "Employee has custody/payroll history — terminate instead" : null),
  },
  "employee-allocations": {
    model: "employeeAllocation",
    module: "hr",
    create: z.object({ employeeId: reqId, projectId: reqId, percent: pct }),
    update: z.object({ percent: pct }).partial(),
    filters: ["employeeId", "projectId"],
    refs: { employeeId: "employee", projectId: "project" },
    include: { employee: { select: { code: true, name: true } }, project: { select: { code: true, name: true } } },
    orderBy: { employeeId: "asc" },
    prepareCreate: async (tx, _ctx, data) => {
      const s = await tx.employeeAllocation.aggregate({ where: { employeeId: data.employeeId }, _sum: { percent: true } });
      if (D(s._sum.percent).plus(D(data.percent)).greaterThan(100)) throw unprocessable("Total allocation for the employee would exceed 100%");
      return data;
    },
    prepareUpdate: async (tx, _ctx, e, data) => {
      const s = await tx.employeeAllocation.aggregate({ where: { employeeId: e.employeeId, id: { not: e.id } }, _sum: { percent: true } });
      if (D(s._sum.percent).plus(D(data.percent ?? e.percent)).greaterThan(100)) throw unprocessable("Total allocation for the employee would exceed 100%");
      return data;
    },
  },
  "employee-contracts": {
    model: "employeeContract",
    module: "hr",
    create: z.object({ employeeId: reqId, type: z.enum(["FIXED_TERM", "OPEN_ENDED", "PROJECT_BASED", "PART_TIME"]).optional(), startDate: reqDate, endDate: optDate, salary: money, notes: optStr }),
    update: z.object({ type: z.enum(["FIXED_TERM", "OPEN_ENDED", "PROJECT_BASED", "PART_TIME"]), startDate: reqDate, endDate: optDate, salary: money, notes: optStr }).partial(),
    filters: ["employeeId", "type"],
    refs: { employeeId: "employee" },
    include: { employee: { select: { code: true, name: true } } },
    orderBy: { startDate: "desc" },
  },
  attendance: {
    model: "attendance",
    module: "hr",
    create: z.object({ employeeId: reqId, date: reqDate, status: z.enum(["PRESENT", "ABSENT", "LATE", "LEAVE"]), hours: z.coerce.number().min(0).max(24).optional(), overtimeHours: z.coerce.number().min(0).max(16).optional() }),
    update: z.object({ status: z.enum(["PRESENT", "ABSENT", "LATE", "LEAVE"]), hours: z.coerce.number().min(0).max(24), overtimeHours: z.coerce.number().min(0).max(16) }).partial(),
    filters: ["employeeId", "status"],
    dateField: "date",
    refs: { employeeId: "employee" },
    include: { employee: { select: { code: true, name: true } } },
    orderBy: [{ date: "desc" }],
  },
  "leave-requests": {
    model: "leaveRequest",
    module: "hr",
    create: z.object({ employeeId: reqId, type: z.enum(["ANNUAL", "SICK", "UNPAID", "EMERGENCY"]), fromDate: reqDate, toDate: reqDate, reason: optStr }),
    update: z.object({ type: z.enum(["ANNUAL", "SICK", "UNPAID", "EMERGENCY"]), fromDate: reqDate, toDate: reqDate, reason: optStr }).partial(),
    filters: ["employeeId", "status", "type"],
    dateField: "fromDate",
    refs: { employeeId: "employee" },
    editableStatuses: ["PENDING"],
    include: { employee: { select: { code: true, name: true } } },
    orderBy: [{ fromDate: "desc" }],
    prepareCreate: async (_tx, _ctx, data) => {
      const days = Math.round((new Date(data.toDate).getTime() - new Date(data.fromDate).getTime()) / 86400000) + 1;
      if (days < 1) throw badRequest("End date must be on/after start date");
      return { ...data, days };
    },
    actions: {
      approve: { perm: "approve", run: async (tx, _ctx, e) => (e.status !== "PENDING" ? Promise.reject(unprocessable("Not pending")) : tx.leaveRequest.update({ where: { id: e.id }, data: { status: "APPROVED" } })) },
      reject: { perm: "approve", run: async (tx, _ctx, e) => (e.status !== "PENDING" ? Promise.reject(unprocessable("Not pending")) : tx.leaveRequest.update({ where: { id: e.id }, data: { status: "REJECTED" } })) },
    },
  },
  "hr-adjustments": {
    model: "hrAdjustment",
    module: "hr",
    create: z.object({ employeeId: reqId, type: z.enum(["OVERTIME", "BONUS", "DEDUCTION"]), month, amount: money, reason: optStr }),
    update: z.object({ type: z.enum(["OVERTIME", "BONUS", "DEDUCTION"]), month, amount: money, reason: optStr }).partial(),
    filters: ["employeeId", "type", "month"],
    refs: { employeeId: "employee" },
    include: { employee: { select: { code: true, name: true } } },
    orderBy: [{ month: "desc" }],
  },
  payrolls: {
    model: "payroll",
    module: "payroll",
    docType: "PAYROLL",
    // one payroll per salary currency; the month-end rate is taken from the rate table unless entered
    create: z.object({ number: optStr, month, projectId: optId, ...fxFields }),
    update: z.object({}).partial(),
    filters: ["status", "month", "projectId"],
    projectField: "projectId",
    refs: { projectId: "project" },
    numbering: { key: "PRL", prefix: "PRL" },
    periodDate: (r) => (r?.month ? monthEnd(r.month) : null),
    listInclude: { project: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
    include: { project: { select: { code: true, name: true } }, lines: { orderBy: { employeeName: "asc" } } },
    orderBy: [{ month: "desc" }],
    customCreate: async (tx, ctx, data) => {
      const fx = await resolveDocFx(tx, data.companyId, { currency: data.currency, exchangeRate: data.exchangeRate, date: monthEnd(data.month) });
      const b = await buildPayrollLines(tx, data.companyId, data.month, data.projectId, undefined, { currency: fx.currency, rate: fx.exchangeRate });
      return tx.payroll.create({
        data: {
          companyId: data.companyId,
          number: data.number,
          month: data.month,
          projectId: data.projectId ?? null,
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          totalGross: b.totalGross,
          totalNet: b.totalNet,
          totalDeductions: b.totalDeductions,
          createdById: ctx.user.id,
          lines: { create: b.lines },
        },
      });
    },
    actions: {
      recalculate: {
        perm: "edit",
        run: async (tx, ctx, e) => {
          if (e.status !== "DRAFT") throw unprocessable("Only draft payrolls can be recalculated");
          const b = await buildPayrollLines(tx, e.companyId, e.month, e.projectId, e.id, { currency: e.currency, rate: e.exchangeRate });
          await audit(tx, ctx, { action: "RECALCULATE", entity: "payroll", entityId: e.id, companyId: e.companyId });
          return tx.payroll.update({
            where: { id: e.id },
            data: { totalGross: b.totalGross, totalNet: b.totalNet, totalDeductions: b.totalDeductions, lines: { deleteMany: {}, create: b.lines } },
          });
        },
      },
    },
  },
};
