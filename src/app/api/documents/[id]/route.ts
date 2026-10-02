import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { route } from "@/server/api";
import { hasCompany, requirePerm } from "@/server/context";
import { audit } from "@/server/audit";
import { storage } from "@/server/storage";

type P = { id: string };

export const GET = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "documents", "view");
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc || !hasCompany(ctx, doc.companyId)) throw notFound();
  const data = await storage.get(doc.storageKey).catch(() => {
    throw notFound("File missing from storage");
  });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": doc.mimeType,
      "content-length": String(data.length),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "x-content-type-options": "nosniff",
    },
  });
});

export const DELETE = route<P>(async ({ ctx, params }) => {
  requirePerm(ctx, "documents", "delete");
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc || !hasCompany(ctx, doc.companyId)) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.document.delete({ where: { id: doc.id } });
    await audit(tx, ctx, { action: "DELETE", entity: "Document", entityId: doc.id, companyId: doc.companyId, before: doc });
  });
  await storage.remove(doc.storageKey);
  return { id: doc.id, deleted: true };
});
