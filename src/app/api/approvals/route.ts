import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { route, listParams } from "@/server/api";
import { companyScope } from "@/server/context";
import { DOC_TYPES } from "@/server/services/doctypes";

export const GET = route(async ({ req, ctx }) => {
  const p = listParams(req);
  const scope = p.sp.get("scope") ?? "mine";
  const where: Prisma.ApprovalRequestWhereInput = { companyId: { in: companyScope(ctx, p.companyId) } };
  if (scope === "mine" || scope === "pending") where.status = "PENDING";
  if (p.sp.get("status")) where.status = p.sp.get("status") as "PENDING";
  let items = await prisma.approvalRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { company: { select: { name: true } }, actions: { include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (scope === "mine") {
    items = items.filter((r) => {
      const steps = r.steps as { role: string }[];
      return (ctx.role === "SUPER_ADMIN" || steps[r.currentStep - 1]?.role === ctx.role) && r.submittedBy !== ctx.user.id;
    });
  }
  const submitters = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.submittedBy))] } }, select: { id: true, name: true } });
  const names = new Map(submitters.map((s) => [s.id, s.name]));
  return {
    items: items.map((i) => ({
      ...i,
      submittedByName: names.get(i.submittedBy),
      docLabel: DOC_TYPES[i.docType as keyof typeof DOC_TYPES]?.label,
      docLink: DOC_TYPES[i.docType as keyof typeof DOC_TYPES]?.link,
    })),
    total: items.length,
  };
});
