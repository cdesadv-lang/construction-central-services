import { badRequest } from "@/lib/errors";
import { readJson, route } from "@/server/api";
import { readPayrollSettings, savePayrollSettings } from "@/server/services/payroll";

export const GET = route(async ({ req, ctx }) => {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) throw badRequest("companyId is required");
  return readPayrollSettings(ctx, companyId);
});

export const PUT = route(async ({ req, ctx }) => {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) throw badRequest("companyId is required");
  return savePayrollSettings(ctx, companyId, await readJson(req));
});
