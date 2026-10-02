import { prisma } from "@/lib/db";
import { forbidden, notFound, unprocessable } from "@/lib/errors";
import { route, readJson } from "@/server/api";
import { requirePerm, assertCompany } from "@/server/context";
import { hashPassword } from "@/server/auth";
import { audit } from "@/server/audit";
import { userUpdate, userSelect } from "../schema";

type P = { id: string };

export const GET = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "settings", "view");
  const u = await prisma.user.findUnique({ where: { id: params.id }, select: userSelect });
  if (!u) throw notFound();
  return u;
});

export const PATCH = route<P>(async ({ req, ctx, params }) => {
  requirePerm(ctx, "settings", "edit");
  const d = userUpdate.parse(await readJson(req));
  const before = await prisma.user.findUnique({ where: { id: params.id }, select: userSelect });
  if (!before) throw notFound();
  if ((before.role === "SUPER_ADMIN" || d.role === "SUPER_ADMIN") && ctx.role !== "SUPER_ADMIN") throw forbidden("Only a super admin can manage super admins");
  if (params.id === ctx.user.id && (d.isActive === false || (d.role && d.role !== ctx.role))) throw unprocessable("You cannot deactivate yourself or change your own role");
  for (const c of d.companyIds ?? []) assertCompany(ctx, c);
  return prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    for (const k of ["email", "name", "nameEn", "role", "allCompanies", "isActive"] as const) if (d[k] !== undefined) data[k] = d[k];
    if (d.password) data.passwordHash = await hashPassword(d.password);
    await tx.user.update({ where: { id: params.id }, data });
    if (d.companyIds) {
      await tx.userCompany.deleteMany({ where: { userId: params.id } });
      await tx.userCompany.createMany({ data: d.companyIds.map((companyId) => ({ userId: params.id, companyId })) });
    }
    if (d.projectIds) {
      await tx.userProject.deleteMany({ where: { userId: params.id } });
      await tx.userProject.createMany({ data: d.projectIds.map((projectId) => ({ userId: params.id, projectId })) });
    }
    if (d.isActive === false || d.password) await tx.session.deleteMany({ where: { userId: params.id } });
    const after = await tx.user.findUnique({ where: { id: params.id }, select: userSelect });
    await audit(tx, ctx, { action: "UPDATE", entity: "User", entityId: params.id, before, after: { ...after, passwordChanged: !!d.password } });
    return after;
  });
});

export const DELETE = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "settings", "delete");
  if (params.id === ctx.user.id) throw unprocessable("You cannot delete yourself");
  const u = await prisma.user.findUnique({ where: { id: params.id } });
  if (!u) throw notFound();
  if (u.role === "SUPER_ADMIN" && ctx.role !== "SUPER_ADMIN") throw forbidden();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: params.id }, data: { isActive: false } });
    await tx.session.deleteMany({ where: { userId: params.id } });
    await audit(tx, ctx, { action: "DEACTIVATE", entity: "User", entityId: params.id });
  });
  return { id: params.id, deactivated: true };
});
