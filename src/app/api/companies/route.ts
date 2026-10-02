import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { route, readJson, listParams } from "@/server/api";
import { requirePerm } from "@/server/context";
import { audit } from "@/server/audit";
import { setupCompanyAccounts } from "@/server/services/accounting";
import { createDefaultPayrollSettings } from "@/server/services/payroll";
import { companySchema } from "./schema";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "companies", "view");
  const p = listParams(req);
  const where = {
    id: { in: ctx.companyIds },
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }] } : {}),
    ...(p.sp.get("status") ? { status: p.sp.get("status") as "ACTIVE" } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      include: { _count: { select: { projects: true, employees: true, contractors: true, suppliers: true } } },
    }),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize };
});

export const POST = route(async ({ req, ctx }) => {
  requirePerm(ctx, "companies", "create");
  if (!ctx.user.allCompanies) throw forbidden("Only central management users can register new companies");
  const data = companySchema.parse(await readJson(req));
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data });
    await setupCompanyAccounts(tx, company.id);
    await createDefaultPayrollSettings(tx, company.id);
    await tx.costCenter.create({ data: { companyId: company.id, code: "CC-HQ", name: "الإدارة العامة / Head Office" } });
    const cbAcc = await tx.account.findUniqueOrThrow({ where: { companyId_systemKey: { companyId: company.id, systemKey: "CASH_PARENT" } } });
    const acc = await tx.account.create({ data: { companyId: company.id, code: `${cbAcc.code}01`, name: "الخزينة الرئيسية", nameEn: "Main Cash Box", type: "ASSET", parentId: cbAcc.id } });
    await tx.cashBox.create({ data: { companyId: company.id, code: "CB-00001", name: "الخزينة الرئيسية", accountId: acc.id } });
    await tx.sequence.create({ data: { companyId: company.id, key: "CB", value: 1 } });
    await audit(tx, ctx, { action: "CREATE", entity: "Company", entityId: company.id, companyId: company.id, after: company });
    return company;
  }, { timeout: 30000 });
});

void z;
