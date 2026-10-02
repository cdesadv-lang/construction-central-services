/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { D, r2 } from "@/lib/money";
import { badRequest, unprocessable } from "@/lib/errors";
import { createJournalEntry, updateDraftJournalEntry } from "../services/accounting";
import type { ResourceDef } from "./engine";
import { optDate, optId, optStr, money, pct, reqDate, reqId, reqStr, optMoney, bool } from "./z";

const ledgerByProject = async (projectIds: string[]) => {
  if (!projectIds.length) return new Map<string, { revenue: number; cost: number }>();
  const lines = await prisma.journalLine.groupBy({
    by: ["projectId", "accountId"],
    where: { projectId: { in: projectIds }, entry: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } }, select: { id: true, type: true } });
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const out = new Map<string, { revenue: number; cost: number }>();
  for (const l of lines) {
    const t = typeOf.get(l.accountId);
    const o = out.get(l.projectId!) ?? { revenue: 0, cost: 0 };
    if (t === "REVENUE") o.revenue += Number(D(l._sum.credit).minus(D(l._sum.debit)));
    if (t === "EXPENSE") o.cost += Number(D(l._sum.debit).minus(D(l._sum.credit)));
    out.set(l.projectId!, o);
  }
  return out;
};

const projectFields = {
  code: optStr,
  name: reqStr,
  clientId: optId,
  contractValue: money,
  startDate: optDate,
  endDate: optDate,
  projectManager: optStr,
  consultant: optStr,
  location: optStr,
  budget: optMoney,
  completionPct: pct.optional(),
  clientRetentionPct: pct.optional(),
  clientTaxPct: pct.optional(),
  clientInsurancePct: pct.optional(),
  status: z.enum(["PLANNING", "ACTIVE", "SUSPENDED", "COMPLETED", "CLOSED"]).optional(),
};

export const coreResources: Record<string, ResourceDef> = {
  projects: {
    model: "project",
    module: "projects",
    create: z.object(projectFields),
    update: z.object(projectFields).partial(),
    search: ["code", "name", "location", "projectManager"],
    filters: ["status", "clientId"],
    projectField: "id",
    refs: { clientId: "client" },
    numbering: { key: "PRJ", prefix: "PRJ", field: "code" },
    include: { client: { select: { id: true, name: true } }, company: { select: { id: true, name: true, code: true } } },
    orderBy: { code: "asc" },
    afterCreate: async (tx, _ctx, row) => {
      await tx.costCenter.create({ data: { companyId: row.companyId, code: `CC-${row.code}`, name: `مركز تكلفة ${row.name}`, projectId: row.id } });
    },
    decorate: async (rows) => {
      const m = await ledgerByProject(rows.map((r) => r.id));
      const today = new Date();
      return rows.map((r) => {
        const x = m.get(r.id) ?? { revenue: 0, cost: 0 };
        const delayed = r.endDate && new Date(r.endDate) < today && ["ACTIVE", "SUSPENDED"].includes(r.status) && Number(r.completionPct) < 100;
        return { ...r, revenue: r2(x.revenue).toFixed(2), actualCost: r2(x.cost).toFixed(2), profit: r2(x.revenue - x.cost).toFixed(2), delayed: !!delayed };
      });
    },
    canDelete: async (tx, row) => {
      const n = (await tx.journalLine.count({ where: { projectId: row.id } })) + (await tx.contractorExtract.count({ where: { projectId: row.id } }));
      if (n) return "Project has financial transactions and cannot be deleted (close it instead)";
      await tx.costCenter.deleteMany({ where: { projectId: row.id } });
      await tx.projectBudget.deleteMany({ where: { projectId: row.id } });
      return null;
    },
  },
  clients: {
    model: "client",
    module: "projects",
    create: z.object({ code: optStr, name: reqStr, taxNumber: optStr, contactPerson: optStr, phone: optStr, email: optStr, address: optStr }),
    update: z.object({ code: optStr, name: reqStr, taxNumber: optStr, contactPerson: optStr, phone: optStr, email: optStr, address: optStr }).partial(),
    search: ["code", "name", "phone"],
    numbering: { key: "CL", prefix: "CL", field: "code" },
    orderBy: { code: "asc" },
    include: { company: { select: { name: true } } },
    decorate: async (rows) => {
      const ids = rows.map((r) => r.id);
      const ar = await prisma.clientExtract.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "POSTED" }, _sum: { netAmount: true, paidAmount: true } });
      const m = new Map(ar.map((a) => [a.clientId, a]));
      return rows.map((r) => {
        const a = m.get(r.id);
        return { ...r, billed: D(a?._sum.netAmount).toFixed(2), collected: D(a?._sum.paidAmount).toFixed(2), balance: D(a?._sum.netAmount).minus(D(a?._sum.paidAmount)).toFixed(2) };
      });
    },
  },
  "project-budgets": {
    model: "projectBudget",
    module: "costing",
    create: z.object({ projectId: reqId, category: z.enum(["MATERIALS", "LABOR", "EQUIPMENT", "SUBCONTRACTORS", "TRANSPORT", "OTHER"]), amount: money, notes: optStr }),
    update: z.object({ amount: money, notes: optStr }).partial(),
    filters: ["projectId", "category"],
    projectField: "projectId",
    refs: { projectId: "project" },
    include: { project: { select: { code: true, name: true } } },
    orderBy: [{ projectId: "asc" }, { category: "asc" }],
  },
  accounts: {
    model: "account",
    module: "accounting",
    create: z.object({ code: reqStr, name: reqStr, nameEn: optStr, type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]), parentId: optId, isPostable: bool.optional(), projectId: optId, costCategory: z.enum(["MATERIALS", "LABOR", "EQUIPMENT", "SUBCONTRACTORS", "TRANSPORT", "OTHER"]).nullable().optional(), isActive: bool.optional() }),
    update: z.object({ name: reqStr, nameEn: optStr, isActive: bool, projectId: optId, costCategory: z.enum(["MATERIALS", "LABOR", "EQUIPMENT", "SUBCONTRACTORS", "TRANSPORT", "OTHER"]).nullable() }).partial(),
    search: ["code", "name", "nameEn"],
    filters: ["type", "parentId", "projectId"],
    boolFilters: ["isPostable", "isActive"],
    refs: { parentId: "account", projectId: "project" },
    include: { parent: { select: { id: true, code: true, name: true } }, project: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
    prepareCreate: async (tx, _ctx, data) => {
      if (data.parentId) {
        const parent = await tx.account.findUnique({ where: { id: data.parentId } });
        if (!parent) throw badRequest("Parent not found");
        if (parent.type !== data.type) throw unprocessable("Sub-account type must match the parent account type");
        if (parent.isPostable) {
          const used = await tx.journalLine.count({ where: { accountId: parent.id } });
          if (used) throw unprocessable("Parent account has postings; it cannot become a header account");
          await tx.account.update({ where: { id: parent.id }, data: { isPostable: false } });
        }
        if (!data.code.startsWith(parent.code)) throw unprocessable(`Sub-account code must start with parent code ${parent.code}`);
      }
      return data;
    },
    decorate: async (rows) => {
      const ids = rows.map((r) => r.id);
      const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: ids }, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
      const m = new Map(sums.map((s) => [s.accountId, s._sum]));
      return rows.map((r) => {
        const s = m.get(r.id);
        return { ...r, debit: D(s?.debit).toFixed(2), credit: D(s?.credit).toFixed(2), balance: D(s?.debit).minus(D(s?.credit)).toFixed(2) };
      });
    },
    canDelete: async (tx, row) => {
      if (row.systemKey) return "System accounts cannot be deleted";
      if (await tx.journalLine.count({ where: { accountId: row.id } })) return "Account has journal lines";
      if (await tx.account.count({ where: { parentId: row.id } })) return "Account has sub-accounts";
      return null;
    },
  },
  "cost-centers": {
    model: "costCenter",
    module: "accounting",
    create: z.object({ code: reqStr, name: reqStr, projectId: optId }),
    update: z.object({ code: reqStr, name: reqStr, projectId: optId }).partial(),
    search: ["code", "name"],
    filters: ["projectId"],
    refs: { projectId: "project" },
    include: { project: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
    canDelete: async (tx, row) => ((await tx.journalLine.count({ where: { costCenterId: row.id } })) ? "Cost center has postings" : null),
  },
  "journal-entries": {
    model: "journalEntry",
    module: "journals",
    docType: "JOURNAL",
    create: z.object({
      date: reqDate,
      description: reqStr,
      projectId: optId,
      lines: z
        .array(
          z.object({
            accountId: reqId,
            debit: optMoney,
            credit: optMoney,
            costCenterId: optId,
            projectId: optId,
            description: optStr,
            partyType: optStr,
            partyId: optId,
          }),
        )
        .min(2),
    }),
    update: z
      .object({
        date: reqDate,
        description: reqStr,
        projectId: optId,
        lines: z.array(z.object({ accountId: reqId, debit: optMoney, credit: optMoney, costCenterId: optId, projectId: optId, description: optStr, partyType: optStr, partyId: optId })).min(2),
      })
      .partial(),
    search: ["number", "description"],
    filters: ["status", "sourceType"],
    dateField: "date",
    projectField: "projectId",
    refs: { projectId: "project" },
    listInclude: { project: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
    include: {
      project: { select: { code: true, name: true } },
      lines: { include: { account: { select: { code: true, name: true, nameEn: true } }, costCenter: { select: { code: true, name: true } }, project: { select: { code: true, name: true } } } },
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    customCreate: async (tx, ctx, data) =>
      createJournalEntry(tx, ctx, { companyId: data.companyId, date: data.date, description: data.description, projectId: data.projectId, lines: data.lines, status: "DRAFT" }),
    customUpdate: async (tx, ctx, existing, data) =>
      updateDraftJournalEntry(tx, ctx, existing.id, {
        date: data.date ?? existing.date,
        description: data.description ?? existing.description,
        projectId: data.projectId === undefined ? existing.projectId : data.projectId,
        lines: data.lines ?? (await tx.journalLine.findMany({ where: { entryId: existing.id } })),
      }),
    canDelete: async (_tx, row) => (row.sourceType ? "System-generated entries cannot be deleted" : null),
  },
};
