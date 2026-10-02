import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { ROLES } from "@/lib/permissions";
import { route, readJson } from "@/server/api";
import { assertCompany, requirePerm } from "@/server/context";
import { audit } from "@/server/audit";
import { DOC_TYPES } from "@/server/services/doctypes";

export const GET = route(async ({ ctx }) => {
  requirePerm(ctx, "settings", "view");
  const items = await prisma.approvalWorkflow.findMany({
    where: { OR: [{ companyId: null }, { companyId: { in: ctx.companyIds } }] },
    include: { steps: { orderBy: { order: "asc" } }, company: { select: { name: true } } },
    orderBy: [{ docType: "asc" }],
  });
  return { items, docTypes: Object.entries(DOC_TYPES).map(([k, v]) => ({ key: k, label: v.label })) };
});

const body = z.object({
  companyId: z.string().nullable().optional(),
  docType: z.enum(Object.keys(DOC_TYPES) as [keyof typeof DOC_TYPES, ...(keyof typeof DOC_TYPES)[]]),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  steps: z.array(z.object({ name: z.string().min(1), role: z.enum(ROLES) })).max(6),
});

export const PUT = route(async ({ req, ctx }) => {
  requirePerm(ctx, "settings", "edit");
  const d = body.parse(await readJson(req));
  const companyId = d.companyId ?? null;
  if (companyId) assertCompany(ctx, companyId);
  else if (!ctx.user.allCompanies) throw forbidden("Only central users can edit global workflows");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.approvalWorkflow.findFirst({ where: { companyId, docType: d.docType } });
    const wf = existing
      ? await tx.approvalWorkflow.update({ where: { id: existing.id }, data: { name: d.name ?? existing.name, isActive: d.isActive ?? existing.isActive } })
      : await tx.approvalWorkflow.create({ data: { companyId, docType: d.docType, name: d.name ?? DOC_TYPES[d.docType].label, isActive: d.isActive ?? true } });
    await tx.approvalStep.deleteMany({ where: { workflowId: wf.id } });
    await tx.approvalStep.createMany({ data: d.steps.map((s, i) => ({ workflowId: wf.id, order: i + 1, name: s.name, role: s.role })) });
    await audit(tx, ctx, { action: "UPDATE", entity: "ApprovalWorkflow", entityId: wf.id, companyId, after: d });
    return tx.approvalWorkflow.findUnique({ where: { id: wf.id }, include: { steps: { orderBy: { order: "asc" } } } });
  });
});
