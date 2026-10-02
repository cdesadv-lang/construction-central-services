import { notFound } from "@/lib/errors";
import { csvResponse, listParams, route, toCsv } from "@/server/api";
import { requirePerm } from "@/server/context";
import { REPORTS } from "@/server/services/reports";

export const GET = route<{ report: string }>(async ({ req, ctx, params }) => {
  requirePerm(ctx, "reports", "view");
  const fn = REPORTS[params.report];
  if (!fn) throw notFound(`Unknown report ${params.report}`);
  const p = listParams(req);
  const result = await fn(ctx, {
    companyId: p.companyId,
    projectId: p.projectId,
    from: p.from,
    to: p.to,
    asOf: p.sp.get("asOf") ?? undefined,
    accountId: p.sp.get("accountId") ?? undefined,
    partyId: p.sp.get("partyId") ?? undefined,
  });
  if (p.sp.get("format") === "csv") {
    const rows = result.sections?.length ? result.sections.flatMap((s) => [...s.rows, ...(s.totals ? [s.totals] : [])]) : result.rows;
    const all = result.totals ? [...rows, result.totals] : rows;
    return csvResponse(`${params.report}.csv`, toCsv(all as Record<string, unknown>[], result.columns.map((c) => ({ key: c.key, label: c.key }))));
  }
  return result;
});
