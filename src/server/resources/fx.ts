import { z } from "zod";
import { badRequest } from "@/lib/errors";
import type { ResourceDef } from "./engine";
import { optStr, reqDate } from "./z";

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
};
