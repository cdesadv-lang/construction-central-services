import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { listParams, route } from "@/server/api";
import { assertCompany, companyScope, requirePerm } from "@/server/context";
import { audit } from "@/server/audit";
import { ALLOWED_MIME, makeKey, storage } from "@/server/storage";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "documents", "view");
  const p = listParams(req);
  const where: Prisma.DocumentWhereInput = { companyId: { in: companyScope(ctx, p.companyId) } };
  if (p.sp.get("entityType")) where.entityType = p.sp.get("entityType");
  if (p.sp.get("entityId")) where.entityId = p.sp.get("entityId");
  if (p.q) where.OR = [{ title: { contains: p.q, mode: "insensitive" } }, { fileName: { contains: p.q, mode: "insensitive" } }];
  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { company: { select: { name: true } } } }),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize };
});

export const POST = route(async ({ req, ctx }) => {
  requirePerm(ctx, "documents", "create");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected multipart/form-data");
  }
  const file = form.get("file");
  const companyId = String(form.get("companyId") ?? "");
  assertCompany(ctx, companyId);
  if (!(file instanceof File)) throw badRequest("file is required");
  const max = Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024;
  if (file.size > max) throw badRequest(`File exceeds ${process.env.MAX_UPLOAD_MB ?? 20} MB`);
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.includes(mime)) throw badRequest(`File type ${mime} is not allowed`);
  const entityType = (form.get("entityType") as string) || null;
  const entityId = (form.get("entityId") as string) || null;
  const key = makeKey(companyId, file.name);
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { companyId, entityType, entityId, title: (form.get("title") as string) || file.name, fileName: file.name, mimeType: mime, size: file.size, storageKey: key, uploadedById: ctx.user.id },
    });
    await audit(tx, ctx, { action: "UPLOAD", entity: "Document", entityId: doc.id, companyId, after: doc });
    return doc;
  });
});
