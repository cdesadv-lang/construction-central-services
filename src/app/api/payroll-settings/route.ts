import { badRequest } from "@/lib/errors";
import { readJson, route } from "@/server/api";
import { deletePayrollSettingsVersion, readPayrollSettings, savePayrollSettings } from "@/server/services/payroll";

/** GET ?companyId=&date=YYYY-MM-DD — all rules versions plus the version in force on `date` (default today). */
export const GET = route(async ({ req, ctx }) => {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) throw badRequest("companyId is required");
  return readPayrollSettings(ctx, companyId, req.nextUrl.searchParams.get("date"));
});

/** PUT ?companyId= — create/update the version keyed by body.effectiveFrom (omitted = version in force today). */
export const PUT = route(async ({ req, ctx }) => {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) throw badRequest("companyId is required");
  return savePayrollSettings(ctx, companyId, await readJson(req));
});

/** DELETE ?companyId=&id= — remove a rules version (not the last one). */
export const DELETE = route(async ({ req, ctx }) => {
  const companyId = req.nextUrl.searchParams.get("companyId");
  const id = req.nextUrl.searchParams.get("id");
  if (!companyId || !id) throw badRequest("companyId and id are required");
  return deletePayrollSettingsVersion(ctx, companyId, id);
});
