import { badRequest } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { route } from "@/server/api";
import { assertCompany, requirePerm } from "@/server/context";
import { computeRevaluation } from "@/server/services/revaluation";

/** GET /api/fx-revaluations/preview?companyId=&date=YYYY-MM-DD[&rate.USD=48.1] — what a revaluation would post. */
export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "accounting", "view");
  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId");
  const date = sp.get("date");
  if (!companyId) throw badRequest("companyId is required");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date (YYYY-MM-DD) is required");
  assertCompany(ctx, companyId);
  const rates: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("rate.")) rates[k.slice(5)] = v;
  return computeRevaluation(prisma, companyId, new Date(`${date}T00:00:00Z`), rates);
});
