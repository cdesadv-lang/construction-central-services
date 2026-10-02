/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { closeFiscalYear, closePeriod, createFiscalYear, periodChecklist, reopenFiscalYear, reopenPeriod, setChecklistItem } from "../services/periods";
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
