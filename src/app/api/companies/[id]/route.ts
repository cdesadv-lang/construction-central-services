import { prisma } from "@/lib/db";
import { notFound, unprocessable } from "@/lib/errors";
import { route, readJson } from "@/server/api";
import { hasCompany, requirePerm } from "@/server/context";
import { audit } from "@/server/audit";
import { companySchema } from "../schema";

type P = { id: string };

export const GET = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "companies", "view");
  if (!hasCompany(ctx, params.id)) throw notFound();
  const c = await prisma.company.findUnique({
    where: { id: params.id },
    include: { _count: { select: { projects: true, employees: true, contractors: true, suppliers: true, clients: true, journalEntries: true } } },
  });
  if (!c) throw notFound();
  return c;
});

export const PATCH = route<P>(async ({ req, ctx, params }) => {
  requirePerm(ctx, "companies", "edit");
  if (!hasCompany(ctx, params.id)) throw notFound();
  const data = companySchema.partial().parse(await readJson(req));
  for (const k of Object.keys(data) as (keyof typeof data)[]) if (data[k] === undefined) delete data[k];
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findUniqueOrThrow({ where: { id: params.id } });
    const after = await tx.company.update({ where: { id: params.id }, data });
    await audit(tx, ctx, { action: "UPDATE", entity: "Company", entityId: params.id, companyId: params.id, before, after });
    return after;
  });
});

export const DELETE = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "companies", "delete");
  if (!hasCompany(ctx, params.id)) throw notFound();
  const n = await prisma.journalEntry.count({ where: { companyId: params.id } });
  if (n) throw unprocessable("Company has accounting history; set its status to INACTIVE instead of deleting");
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findUniqueOrThrow({ where: { id: params.id } });
    const id = params.id;
    await tx.cashBox.deleteMany({ where: { companyId: id } });
    await tx.bankAccount.deleteMany({ where: { companyId: id } });
    await tx.costCenter.deleteMany({ where: { companyId: id } });
    await tx.account.updateMany({ where: { companyId: id }, data: { parentId: null } });
    await tx.account.deleteMany({ where: { companyId: id } });
    await tx.sequence.deleteMany({ where: { companyId: id } });
    await tx.company.delete({ where: { id } });
    await audit(tx, ctx, { action: "DELETE", entity: "Company", entityId: id, before });
    return { id, deleted: true };
  });
});
