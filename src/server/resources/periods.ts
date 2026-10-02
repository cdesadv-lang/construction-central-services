/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { closeFiscalYear, closePeriod, createFiscalYear, periodChecklist, reopenFiscalYear, reopenPeriod, setChecklistItem } from "../services/periods";
import { prisma } from "@/lib/db";
import type { ResourceDef } from "./engine";
import { optStr } from "./z";

export const periodResources: Record<string, ResourceDef> = {
  "fiscal-years": {
    model: "fiscalYear",
    module: "periods",
    entity: "FiscalYear",
    noDelete: true,
    create: z.object({ year: z.coerce.number().int().min(2000).max(2100), startMonth: z.coerce.number().int().min(1).max(12).optional(), notes: optStr }),
    update: z.object({ notes: optStr }).partial(),
    filters: ["status"],
    include: { periods: { orderBy: { startDate: "asc" } } },
    orderBy: [{ startDate: "desc" }],
    customCreate: async (tx, ctx, data) => createFiscalYear(tx, ctx, data),
    // closing entry number + the reversal entries of earlier closings (reopen history)
    decorate: async (rows) => {
      const ids = rows.map((r) => r.id);
      const entries = await prisma.journalEntry.findMany({ where: { sourceId: { in: ids }, sourceType: { in: ["YEAR_END_CLOSE", "YEAR_END_CLOSE_REVERSAL"] } }, select: { id: true, number: true, sourceId: true, sourceType: true, totalDebit: true }, orderBy: { createdAt: "asc" } });
      return rows.map((r) => ({
        ...r,
        closingEntry: entries.find((e) => e.id === r.closingEntryId) ?? null,
        closingHistory: entries.filter((e) => e.sourceId === r.id),
      }));
    },
    actions: {
      close: { perm: "approve", run: (tx, ctx, e) => closeFiscalYear(tx, ctx, e.id) },
      reopen: { perm: "approve", run: (tx, ctx, e, body) => reopenFiscalYear(tx, ctx, e.id, String(body?.reason ?? "")) },
    },
  },
  "accounting-periods": {
    model: "accountingPeriod",
    module: "periods",
    entity: "AccountingPeriod",
    readOnly: true,
    filters: ["fiscalYearId", "status", "year"],
    include: { fiscalYear: { select: { name: true, status: true } } },
    orderBy: [{ startDate: "asc" }],
    detail: async (tx, row) => {
      const { items, canClose } = await periodChecklist(tx as any, row.id);
      return { checklist: items, canClose };
    },
    actions: {
      checklist: { perm: "edit", run: (tx, ctx, e, body) => setChecklistItem(tx, ctx, e.id, String(body?.key ?? ""), body?.done !== false) },
      close: { perm: "approve", run: (tx, ctx, e, body) => closePeriod(tx, ctx, e.id, body?.notes ?? null) },
      reopen: { perm: "approve", run: (tx, ctx, e, body) => reopenPeriod(tx, ctx, e.id, String(body?.reason ?? "")) },
    },
  },
};
