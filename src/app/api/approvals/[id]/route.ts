import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, readJson } from "@/server/api";
import { actOnRequest } from "@/server/services/approval";

const body = z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().max(1000).optional() });

export const POST = route<{ id: string }>(
  async ({ req, ctx, params }) => {
    const d = body.parse(await readJson(req));
    return prisma.$transaction((tx) => actOnRequest(tx, ctx, params.id, d.decision, d.comment));
  },
  { status: 200 },
);
