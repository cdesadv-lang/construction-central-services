import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { route, readJson, listParams } from "@/server/api";
import { requirePerm, assertCompany } from "@/server/context";
import { hashPassword } from "@/server/auth";
import { audit } from "@/server/audit";
import { userCreate, userSelect } from "./schema";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "settings", "view");
  const p = listParams(req);
  const where = p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { email: { contains: p.q, mode: "insensitive" as const } }] } : {};
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "asc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize };
});

export const POST = route(async ({ req, ctx }) => {
  requirePerm(ctx, "settings", "create");
  const d = userCreate.parse(await readJson(req));
  if (d.role === "SUPER_ADMIN" && ctx.role !== "SUPER_ADMIN") throw forbidden("Only a super admin can create super admins");
  if (d.allCompanies && !ctx.user.allCompanies) throw forbidden();
  for (const c of d.companyIds ?? []) assertCompany(ctx, c);
  return prisma.$transaction(async (tx) => {
    const projects = d.projectIds?.length ? await tx.project.findMany({ where: { id: { in: d.projectIds } }, select: { id: true, companyId: true } }) : [];
    if (projects.some((p) => !(d.allCompanies || d.companyIds?.includes(p.companyId)))) throw forbidden("Project access must be within the user's companies");
    const user = await tx.user.create({
      data: {
        email: d.email, name: d.name, nameEn: d.nameEn ?? null, role: d.role, allCompanies: d.allCompanies ?? false, isActive: d.isActive ?? true,
        passwordHash: await hashPassword(d.password),
        companies: { create: (d.companyIds ?? []).map((companyId) => ({ companyId })) },
        projects: { create: projects.map((p) => ({ projectId: p.id })) },
      },
      select: userSelect,
    });
    await audit(tx, ctx, { action: "CREATE", entity: "User", entityId: user.id, after: user });
    return user;
  });
});
