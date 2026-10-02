/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { badRequest, forbidden, notFound, unprocessable } from "@/lib/errors";
import type { ActionKey, ModuleKey } from "@/lib/permissions";
import { csvResponse, listParams, toCsv } from "../api";
import { audit } from "../audit";
import { assertCompany, assertProject, companyScope, hasCompany, hasProject, requirePerm, type Ctx } from "../context";
import { nextNumber } from "../sequence";
import { actOnRequest, approvalHistory, cancelDocument, pendingRequestFor, submitForApproval } from "../services/approval";
import { postDocument, reverseDocument } from "../services/posting";
import type { DocType } from "../services/doctypes";

export interface ResourceDef {
  model: string;
  module: ModuleKey;
  entity?: string;
  create?: z.AnyZodObject;
  update?: z.AnyZodObject;
  search?: string[];
  filters?: string[];
  boolFilters?: string[];
  dateField?: string;
  include?: any;
  listInclude?: any;
  orderBy?: any;
  /** field -> prisma model; validated to exist in the same company */
  refs?: Record<string, string>;
  /** field holding projectId for project-level access control ("id" for the projects table itself) */
  projectField?: string;
  numbering?: { key: string; prefix: string; field?: string };
  docType?: DocType;
  /** statuses that allow edit/delete (default for docs: DRAFT) */
  editableStatuses?: string[];
  readOnly?: boolean;
  noDelete?: boolean;
  prepareCreate?: (tx: Tx, ctx: Ctx, data: any) => Promise<any>;
  prepareUpdate?: (tx: Tx, ctx: Ctx, existing: any, data: any) => Promise<any>;
  afterCreate?: (tx: Tx, ctx: Ctx, row: any) => Promise<void>;
  customCreate?: (tx: Tx, ctx: Ctx, data: any) => Promise<any>;
  customUpdate?: (tx: Tx, ctx: Ctx, existing: any, data: any) => Promise<any>;
  canDelete?: (tx: Tx, existing: any) => Promise<string | null>;
  afterDelete?: (tx: Tx, existing: any) => Promise<void>;
  decorate?: (rows: any[], ctx: Ctx) => Promise<any[]>;
  detail?: (tx: Tx, row: any, ctx: Ctx) => Promise<Record<string, unknown>>;
  actions?: Record<string, { perm: ActionKey; run: (tx: Tx, ctx: Ctx, existing: any, body: any) => Promise<any> }>;
  csv?: { key: string; label: string }[];
}

const d = (tx: Tx | typeof prisma, model: string) => (tx as any)[model];

async function validateRefs(tx: Tx, def: ResourceDef, companyId: string, data: any, ctx: Ctx) {
  for (const [field, model] of Object.entries(def.refs ?? {})) {
    const v = data[field];
    if (v === undefined || v === null || v === "") continue;
    const row = await d(tx, model).findUnique({ where: { id: v }, select: { id: true, companyId: true } });
    if (!row || row.companyId !== companyId) throw badRequest(`${field}: referenced record not found in this company`);
    if (model === "project") assertProject(ctx, v);
  }
}

function scopeWhere(ctx: Ctx, def: ResourceDef, requestedCompany?: string) {
  const where: any = { companyId: { in: companyScope(ctx, requestedCompany) } };
  if (def.projectField && ctx.projectIds) where[def.projectField] = { in: ctx.projectIds };
  return where;
}

async function loadScoped(def: ResourceDef, ctx: Ctx, id: string, include?: any) {
  const row = await d(prisma, def.model).findUnique({ where: { id }, ...(include ? { include } : {}) });
  // Return 404 (not 403) for records in other companies so existence is not leaked.
  if (!row || !hasCompany(ctx, row.companyId)) throw notFound();
  if (def.projectField && !hasProject(ctx, row[def.projectField])) throw notFound();
  return row;
}

export async function listResource(def: ResourceDef, ctx: Ctx, req: NextRequest) {
  requirePerm(ctx, def.module, "view");
  const p = listParams(req);
  const where = scopeWhere(ctx, def, p.companyId);
  if (p.projectId && def.projectField) {
    assertProject(ctx, p.projectId);
    where[def.projectField] = p.projectId;
  }
  for (const f of def.filters ?? []) {
    const v = p.sp.get(f);
    if (v) where[f] = v.includes(",") ? { in: v.split(",") } : v;
  }
  for (const f of def.boolFilters ?? []) {
    const v = p.sp.get(f);
    if (v === "true" || v === "false") where[f] = v === "true";
  }
  if (p.q && def.search?.length) {
    where.OR = def.search.map((f) => {
      if (f.includes(".")) {
        const [rel, field] = f.split(".");
        return { [rel]: { [field]: { contains: p.q, mode: "insensitive" } } };
      }
      return { [f]: { contains: p.q, mode: "insensitive" } };
    });
  }
  if (def.dateField && (p.from || p.to)) {
    where[def.dateField] = { ...(p.from ? { gte: new Date(p.from) } : {}), ...(p.to ? { lte: new Date(p.to + "T23:59:59Z") } : {}) };
  }
  const csv = p.sp.get("format") === "csv";
  const take = csv ? 10000 : p.pageSize;
  const [total, rows] = await Promise.all([
    d(prisma, def.model).count({ where }),
    d(prisma, def.model).findMany({
      where,
      include: def.listInclude ?? def.include,
      orderBy: def.orderBy ?? { createdAt: "desc" },
      skip: csv ? 0 : (p.page - 1) * p.pageSize,
      take,
    }),
  ]);
  const items = def.decorate ? await def.decorate(rows, ctx) : rows;
  if (csv) {
    const flat = items.map((r: any) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && !("toFixed" in (v as any))) {
          const vv = v as any;
          o[k] = vv.name ?? vv.number ?? vv.code ?? "";
        } else if (!Array.isArray(v)) o[k] = v;
      }
      return o;
    });
    return csvResponse(`${def.model}.csv`, toCsv(flat, def.csv));
  }
  return { items, total, page: p.page, pageSize: p.pageSize };
}

export async function getResource(def: ResourceDef, ctx: Ctx, id: string) {
  requirePerm(ctx, def.module, "view");
  const row = await loadScoped(def, ctx, id, def.include);
  const [decorated] = def.decorate ? await def.decorate([row], ctx) : [row];
  const extra: Record<string, unknown> = {};
  if (def.docType) extra.approvals = await approvalHistory(prisma, def.docType, id);
  if (row.journalEntryId) {
    extra.journalEntry = await prisma.journalEntry.findUnique({
      where: { id: row.journalEntryId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  }
  extra.documents = await prisma.document.findMany({ where: { entityType: def.model, entityId: id, companyId: row.companyId } });
  if (def.detail) Object.assign(extra, await def.detail(prisma, row, ctx));
  return { ...decorated, _extra: extra };
}

export async function createResource(def: ResourceDef, ctx: Ctx, body: any) {
  if (def.readOnly) throw forbidden("This resource is read-only");
  requirePerm(ctx, def.module, "create");
  if (!def.create) throw badRequest("Create not supported");
  const companyId = body?.companyId;
  if (!companyId || typeof companyId !== "string") throw badRequest("companyId is required");
  assertCompany(ctx, companyId);
  const data: any = def.create.parse(body);
  data.companyId = companyId;
  if (def.projectField && def.projectField !== "id" && ctx.projectIds) {
    if (!data[def.projectField]) throw forbidden("Project-restricted users must select a project");
    assertProject(ctx, data[def.projectField]);
  }
  return prisma.$transaction(
    async (tx) => {
      await validateRefs(tx, def, companyId, data, ctx);
      if (def.numbering) {
        const f = def.numbering.field ?? "number";
        if (!data[f]) data[f] = await nextNumber(tx, companyId, def.numbering.key, def.numbering.prefix);
      }
      let row;
      if (def.customCreate) {
        row = await def.customCreate(tx, ctx, data);
      } else {
        const prepared = def.prepareCreate ? await def.prepareCreate(tx, ctx, data) : data;
        if (def.docType || "createdById" in (def.create!.shape ?? {})) prepared.createdById ??= ctx.user.id;
        row = await d(tx, def.model).create({ data: prepared });
      }
      if (def.afterCreate) await def.afterCreate(tx, ctx, row);
      await audit(tx, ctx, { action: "CREATE", entity: def.entity ?? def.model, entityId: row.id, companyId, after: row });
      return row;
    },
    { timeout: 20000 },
  );
}

function assertEditable(def: ResourceDef, existing: any) {
  const allowed = def.editableStatuses ?? (def.docType ? ["DRAFT"] : null);
  if (allowed && existing.status && !allowed.includes(existing.status))
    throw unprocessable(`Record in status ${existing.status} cannot be modified`);
}

export async function updateResource(def: ResourceDef, ctx: Ctx, id: string, body: any) {
  if (def.readOnly) throw forbidden("This resource is read-only");
  requirePerm(ctx, def.module, "edit");
  if (!def.update) throw badRequest("Update not supported");
  const existing = await loadScoped(def, ctx, id);
  assertEditable(def, existing);
  const data: any = def.update.parse(body ?? {});
  delete data.companyId;
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (def.projectField && def.projectField !== "id" && data[def.projectField] !== undefined && ctx.projectIds) assertProject(ctx, data[def.projectField]);
  return prisma.$transaction(
    async (tx) => {
      await validateRefs(tx, def, existing.companyId, data, ctx);
      let row;
      if (def.customUpdate) row = await def.customUpdate(tx, ctx, existing, data);
      else {
        const prepared = def.prepareUpdate ? await def.prepareUpdate(tx, ctx, existing, data) : data;
        row = await d(tx, def.model).update({ where: { id }, data: prepared });
      }
      await audit(tx, ctx, { action: "UPDATE", entity: def.entity ?? def.model, entityId: id, companyId: existing.companyId, before: existing, after: row });
      return row;
    },
    { timeout: 20000 },
  );
}

export async function deleteResource(def: ResourceDef, ctx: Ctx, id: string) {
  if (def.readOnly || def.noDelete) throw forbidden("Delete is not allowed for this resource");
  requirePerm(ctx, def.module, "delete");
  const existing = await loadScoped(def, ctx, id);
  assertEditable(def, existing);
  return prisma.$transaction(async (tx) => {
    if (def.canDelete) {
      const reason = await def.canDelete(tx, existing);
      if (reason) throw unprocessable(reason);
    }
    await d(tx, def.model).delete({ where: { id } });
    if (def.afterDelete) await def.afterDelete(tx, existing);
    await audit(tx, ctx, { action: "DELETE", entity: def.entity ?? def.model, entityId: id, companyId: existing.companyId, before: existing });
    return { id, deleted: true };
  });
}

export async function actionResource(def: ResourceDef, ctx: Ctx, id: string, action: string, body: any) {
  const existing = await loadScoped(def, ctx, id);
  const run = async (fn: (tx: Tx) => Promise<any>) => prisma.$transaction(fn, { timeout: 30000 });
  if (def.docType) {
    const dt = def.docType;
    switch (action) {
      case "submit":
        return run((tx) => submitForApproval(tx, ctx, dt, id));
      case "approve":
      case "reject": {
        const reqRow = await pendingRequestFor(prisma, dt, id);
        if (!reqRow) throw unprocessable("No pending approval request for this document");
        return run((tx) => actOnRequest(tx, ctx, reqRow.id, action === "approve" ? "APPROVE" : "REJECT", body?.comment));
      }
      case "post":
        requirePerm(ctx, def.module, "approve");
        return run((tx) => postDocument(tx, ctx, dt, id));
      case "cancel":
        requirePerm(ctx, def.module, "edit");
        return run((tx) => cancelDocument(tx, ctx, dt, id));
      case "reverse":
        requirePerm(ctx, def.module, "approve");
        return run((tx) => reverseDocument(tx, ctx, dt, id, body?.reason));
    }
  }
  const a = def.actions?.[action];
  if (!a) throw notFound(`Unknown action ${action}`);
  requirePerm(ctx, def.module, a.perm);
  return run((tx) => a.run(tx, ctx, existing, body ?? {}));
}
