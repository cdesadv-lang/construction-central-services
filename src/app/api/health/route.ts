import { prisma } from "@/lib/db";
import { publicRoute } from "@/server/api";
import { activeStorage } from "@/server/storage";

export const dynamic = "force-dynamic";
/** Liveness: DB ping. `?deep=1` also verifies the active storage driver is reachable/writable. */
export const GET = publicRoute(async ({ req }) => {
  await prisma.$queryRaw`SELECT 1`;
  const out: Record<string, unknown> = { status: "ok", time: new Date().toISOString() };
  if (req.nextUrl.searchParams.get("deep") === "1") {
    const s = activeStorage();
    try {
      await s.check();
      out.storage = { driver: s.name, status: "ok" };
    } catch {
      out.storage = { driver: s.name, status: "error" };
      out.status = "degraded";
    }
  }
  return out;
});
