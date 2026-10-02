import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { route, listParams, csvResponse, toCsv } from "@/server/api";
import { companyScope, requirePerm } from "@/server/context";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "audit", "view");
  const p = listParams(req);
  const scope = companyScope(ctx, p.companyId);
  const where: Prisma.AuditLogWhereInput = {
    OR: p.companyId || !ctx.user.allCompanies ? [{ companyId: { in: scope } }] : [{ companyId: { in: scope } }, { companyId: null }],
  };
  for (const f of ["entity", "action", "userId", "entityId"] as const) {
    const v = p.sp.get(f);
    if (v) (where as Record<string, unknown>)[f] = v;
  }
  if (p.from || p.to) where.createdAt = { ...(p.from ? { gte: new Date(p.from) } : {}), ...(p.to ? { lte: new Date(p.to + "T23:59:59Z") } : {}) };
  const csv = p.sp.get("format") === "csv";
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: csv ? 0 : (p.page - 1) * p.pageSize,
      take: csv ? 10000 : p.pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  if (csv)
    return csvResponse(
      "audit-log.csv",
      toCsv(items.map((i) => ({ createdAt: i.createdAt.toISOString(), user: i.user?.email, action: i.action, entity: i.entity, entityId: i.entityId, companyId: i.companyId, ip: i.ip }))),
    );
  return { items, total, page: p.page, pageSize: p.pageSize };
});
