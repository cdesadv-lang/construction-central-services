import { z } from "zod";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { ResourceDef } from "./engine";
import { optStr, reqDate } from "./z";
import { requirePerm } from "../context";
import { reverseRevaluation, runRevaluation } from "../services/revaluation";

const code = z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code"));

export const fxResources: Record<string, ResourceDef> = {
  /** EGP per 1 unit of currency, per company and day. Documents take the latest rate on or before their date. */
  "exchange-rates": {
    model: "exchangeRate",
    module: "accounting",
    create: z.object({ currency: code, date: reqDate, rate: z.coerce.number().positive().max(1e6), source: optStr }),
    update: z.object({ rate: z.coerce.number().positive().max(1e6), source: optStr }).partial(),
    search: ["currency", "source"],
    filters: ["currency"],
    dateField: "date",
    orderBy: [{ date: "desc" }, { currency: "asc" }],
    prepareCreate: async (_tx, ctx, data) => {
      if (data.currency === "EGP") throw badRequest("EGP is the base currency (rate is always 1)");
      return { ...data, createdById: ctx.user.id };
    },
  },
  /**
   * Period-end revaluation of open foreign-currency balances (unrealized FX). Creating one posts the adjustment
   * entry immediately; with autoReverse (default) the reversal is posted on the next day.
   */
  "fx-revaluations": {
    model: "fxRevaluation",
    module: "accounting",
    entity: "FxRevaluation",
    create: z.object({
      date: reqDate,
      autoReverse: z.preprocess((v) => (v === "false" ? false : v === "true" ? true : v), z.boolean()).optional(),
      rates: z.record(z.string(), z.union([z.coerce.number().positive().max(1e6), z.literal(""), z.null()])).optional(),
      notes: optStr,
    }),
    noDelete: true,
    search: ["number", "notes"],
    filters: ["status"],
    dateField: "date",
    orderBy: [{ date: "desc" }, { number: "desc" }],
    customCreate: async (tx, ctx, data) => {
      requirePerm(ctx, "accounting", "approve");
      return runRevaluation(tx, ctx, { companyId: data.companyId, date: data.date, rates: data.rates ?? {}, autoReverse: data.autoReverse, notes: data.notes });
    },
    decorate: async (rows) => {
      const ids = rows.flatMap((r) => [r.journalEntryId, r.reversalEntryId]).filter(Boolean);
      const jes = await prisma.journalEntry.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, date: true } });
      const m = new Map(jes.map((j) => [j.id, j]));
      return rows.map((r) => ({ ...r, journalEntry: m.get(r.journalEntryId) ?? null, reversalEntry: m.get(r.reversalEntryId) ?? null, lineCount: Array.isArray(r.lines) ? r.lines.length : 0 }));
    },
    actions: {
      reverse: { perm: "approve", run: (tx, ctx, e, body) => reverseRevaluation(tx, ctx, e.id, body?.date ? new Date(`${String(body.date).slice(0, 10)}T00:00:00Z`) : undefined, body?.reason ? String(body.reason) : undefined) },
    },
  },
};
