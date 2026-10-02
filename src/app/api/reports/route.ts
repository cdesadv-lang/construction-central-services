import { route } from "@/server/api";
import { requirePerm } from "@/server/context";
import { REPORTS } from "@/server/services/reports";

export const GET = route(async ({ ctx }) => {
  requirePerm(ctx, "reports", "view");
  return { reports: Object.keys(REPORTS) };
});
