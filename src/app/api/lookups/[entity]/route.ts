/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import type { ModuleKey } from "@/lib/permissions";
import { listParams, route } from "@/server/api";
import { can, companyScope } from "@/server/context";

/** Minimal id/label lists for form dropdowns. Allowed when the user can view ANY module that references the entity. */
const LOOKUPS: Record<string, { model: string; modules: ModuleKey[]; select: any; label: (r: any) => string; orderBy: any; projectField?: string; where?: any; filters?: string[]; scope?: (companyIds: string[]) => any }> = {
  projects: { model: "project", modules: ["projects", "accounting", "journals", "expenses", "contractors", "clientExtracts", "contractorExtracts", "procurement", "costing", "hr", "payroll", "treasury", "payments", "custody", "reports", "suppliers"], select: { id: true, code: true, name: true, clientId: true, contractValue: true, clientRetentionPct: true, clientTaxPct: true, clientInsurancePct: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" }, projectField: "id" },
  clients: { model: "client", modules: ["projects", "clientExtracts", "payments", "treasury", "reports"], select: { id: true, code: true, name: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" } },
  suppliers: { model: "supplier", modules: ["suppliers", "expenses", "procurement", "payments", "treasury", "journals", "reports"], select: { id: true, code: true, name: true, paymentTermsDays: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" } },
  contractors: { model: "contractor", modules: ["contractors", "contractorExtracts", "payments", "treasury", "journals", "reports"], select: { id: true, code: true, name: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" } },
  employees: { model: "employee", modules: ["hr", "payroll", "expenses", "custody"], select: { id: true, code: true, name: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" }, where: { status: { not: "TERMINATED" } } },
  accounts: { model: "account", modules: ["accounting", "journals", "treasury", "banks", "reports"], select: { id: true, code: true, name: true, type: true, isPostable: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" }, filters: ["isPostable", "type"] },
  "cost-centers": { model: "costCenter", modules: ["accounting", "journals", "expenses", "costing"], select: { id: true, code: true, name: true, projectId: true }, label: (r) => `${r.code} - ${r.name}`, orderBy: { code: "asc" } },
  "cash-boxes": { model: "cashBox", modules: ["treasury", "expenses", "payments", "custody", "banks"], select: { id: true, code: true, name: true, accountId: true, currency: true }, label: (r) => `${r.code} - ${r.name}${r.currency !== "EGP" ? ` (${r.currency})` : ""}`, orderBy: { code: "asc" } },
  "bank-accounts": { model: "bankAccount", modules: ["banks", "treasury", "expenses", "payments"], select: { id: true, code: true, bankName: true, accountNumber: true, accountId: true, currency: true }, label: (r) => `${r.bankName} - ${r.accountNumber}${r.currency !== "EGP" ? ` (${r.currency})` : ""}`, orderBy: { code: "asc" } },
  subcontracts: { model: "subContract", modules: ["contractors", "contractorExtracts", "payments"], select: { id: true, number: true, scope: true, contractorId: true, projectId: true, contractValue: true, retentionPct: true, taxPct: true, insurancePct: true, advanceRecoveryPct: true }, label: (r) => `${r.number} - ${r.scope}`, orderBy: { number: "asc" }, projectField: "projectId", filters: ["contractorId", "projectId"] },
  "supplier-invoices": { model: "supplierInvoice", modules: ["suppliers", "payments", "treasury"], select: { id: true, number: true, supplierId: true, total: true, paidAmount: true, status: true, currency: true }, label: (r) => `${r.number} (${Number(r.total) - Number(r.paidAmount)}${r.currency !== "EGP" ? " " + r.currency : ""})`, orderBy: { date: "desc" }, where: { status: "POSTED" }, projectField: "projectId", filters: ["supplierId"] },
  "contractor-extracts": { model: "contractorExtract", modules: ["contractorExtracts", "payments", "treasury"], select: { id: true, number: true, contractorId: true, netAmount: true, paidAmount: true }, label: (r) => `${r.number} (${Number(r.netAmount) - Number(r.paidAmount)})`, orderBy: { date: "desc" }, where: { status: "POSTED" }, projectField: "projectId", filters: ["contractorId"] },
  "client-extracts": { model: "clientExtract", modules: ["clientExtracts", "payments", "treasury"], select: { id: true, number: true, clientId: true, netAmount: true, paidAmount: true }, label: (r) => `${r.number} (${Number(r.netAmount) - Number(r.paidAmount)})`, orderBy: { date: "desc" }, where: { status: "POSTED" }, projectField: "projectId", filters: ["clientId"] },
  custodies: { model: "custody", modules: ["custody", "expenses"], select: { id: true, number: true, purpose: true, employeeId: true, amount: true }, label: (r) => `${r.number} - ${r.purpose}`, orderBy: { date: "desc" }, where: { status: "POSTED", settlementStatus: "OPEN" } },
  "purchase-requests": { model: "purchaseRequest", modules: ["procurement"], select: { id: true, number: true, status: true }, label: (r) => `${r.number} (${r.status})`, orderBy: { date: "desc" } },
  "purchase-orders": { model: "purchaseOrder", modules: ["procurement", "suppliers"], select: { id: true, number: true, supplierId: true, status: true, total: true }, label: (r) => `${r.number} (${r.status})`, orderBy: { date: "desc" } },
  "purchase-request-items": { model: "purchaseRequestItem", modules: ["procurement"], select: { id: true, requestId: true, description: true, unit: true, quantity: true }, label: (r) => `${r.description} (${Number(r.quantity)} ${r.unit})`, orderBy: { id: "asc" }, filters: ["requestId"], scope: (ids) => ({ request: { companyId: { in: ids } } }) },
  departments: { model: "department", modules: ["hr"], select: { id: true, code: true, name: true }, label: (r) => r.name, orderBy: { code: "asc" } },
  positions: { model: "position", modules: ["hr"], select: { id: true, code: true, name: true }, label: (r) => r.name, orderBy: { code: "asc" } },
};

export const GET = route<{ entity: string }>(async ({ req, ctx, params }) => {
  const def = LOOKUPS[params.entity];
  if (!def) throw notFound();
  if (!def.modules.some((m) => can(ctx, m, "view"))) throw forbidden();
  const p = listParams(req);
  const ids = companyScope(ctx, p.companyId);
  const where: any = { ...(def.scope ? def.scope(ids) : { companyId: { in: ids } }), ...(def.where ?? {}) };
  if (def.projectField && ctx.projectIds) where[def.projectField] = { in: ctx.projectIds };
  for (const f of def.filters ?? []) {
    const v = p.sp.get(f);
    if (v) where[f] = v === "true" ? true : v === "false" ? false : v;
  }
  if (p.q) where.OR = Object.keys(def.select).filter((k) => ["code", "name", "number", "description"].includes(k)).map((k) => ({ [k]: { contains: p.q, mode: "insensitive" } }));
  const rows = await (prisma as any)[def.model].findMany({ where, select: { ...def.select, ...(def.scope ? {} : { companyId: true }) }, orderBy: def.orderBy, take: 1000 });
  return rows.map((r: any) => ({ ...r, label: def.label(r) }));
});
