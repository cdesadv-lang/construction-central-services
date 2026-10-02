import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { ACTIONS, MODULES, ROLES } from "@/lib/permissions";
import { route, readJson } from "@/server/api";
import { requirePerm } from "@/server/context";
import { audit } from "@/server/audit";

export const GET = route(async ({ ctx }) => {
  requirePerm(ctx, "settings", "view");
  const rows = await prisma.rolePermission.findMany();
  return { roles: ROLES, modules: MODULES, actions: ACTIONS, grants: rows.map((r) => `${r.role}:${r.module}:${r.action}`) };
});

const body = z.object({ role: z.enum(ROLES), module: z.enum(MODULES), action: z.enum(ACTIONS), granted: z.boolean() });

export const PUT = route(async ({ req, ctx }) => {
  requirePerm(ctx, "settings", "edit");
  if (ctx.role !== "SUPER_ADMIN") throw forbidden("Only super admins can change the permission matrix");
  const d = body.parse(await readJson(req));
  if (d.role === "SUPER_ADMIN") throw forbidden("Super admin permissions are fixed");
  await prisma.$transaction(async (tx) => {
    if (d.granted) await tx.rolePermission.upsert({ where: { role_module_action: { role: d.role, module: d.module, action: d.action } }, create: { role: d.role, module: d.module, action: d.action }, update: {} });
    else await tx.rolePermission.deleteMany({ where: { role: d.role, module: d.module, action: d.action } });
    await audit(tx, ctx, { action: d.granted ? "GRANT" : "REVOKE", entity: "RolePermission", entityId: `${d.role}:${d.module}:${d.action}` });
  });
  return d;
});
