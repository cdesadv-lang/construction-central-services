import { prisma } from "@/lib/db";
import { publicRoute } from "@/server/api";

export const dynamic = "force-dynamic";
export const GET = publicRoute(async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: "ok", time: new Date().toISOString() };
});
