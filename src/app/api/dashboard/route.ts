import { listParams, route } from "@/server/api";
import { requirePerm } from "@/server/context";
import { dashboard } from "@/server/services/dashboard";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "dashboard", "view");
  return dashboard(ctx, listParams(req).companyId);
});
