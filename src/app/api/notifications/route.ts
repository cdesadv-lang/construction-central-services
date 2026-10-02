import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, readJson, listParams } from "@/server/api";

export const GET = route(async ({ req, ctx }) => {
  const p = listParams(req);
  const unreadOnly = p.sp.get("unread") === "true";
  const where = { userId: ctx.user.id, ...(unreadOnly ? { read: false } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: ctx.user.id, read: false } }),
  ]);
  return { items, total, unread, page: p.page, pageSize: p.pageSize };
});

const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() });
export const PATCH = route(async ({ req, ctx }) => {
  const d = body.parse(await readJson(req));
  const res = await prisma.notification.updateMany({
    where: { userId: ctx.user.id, ...(d.all ? {} : { id: { in: d.ids ?? [] } }) },
    data: { read: true },
  });
  return { updated: res.count };
});
