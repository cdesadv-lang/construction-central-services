import { prisma } from "@/lib/db";
import { route } from "@/server/api";

export const GET = route(async ({ ctx }) => {
  const companies = await prisma.company.findMany({ where: { id: { in: ctx.companyIds } }, select: { id: true, code: true, name: true, nameEn: true }, orderBy: { code: "asc" } });
  return { user: ctx.user, permissions: [...ctx.perms], companies, projectIds: ctx.projectIds };
});
