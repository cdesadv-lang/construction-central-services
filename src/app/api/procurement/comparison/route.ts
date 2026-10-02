import { prisma } from "@/lib/db";
import { D, num } from "@/lib/money";
import { badRequest, notFound } from "@/lib/errors";
import { listParams, route } from "@/server/api";
import { hasCompany, requirePerm } from "@/server/context";

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "procurement", "view");
  const requestId = listParams(req).sp.get("requestId");
  if (!requestId) throw badRequest("requestId is required");
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: requestId },
    include: { items: true, quotations: { include: { supplier: { select: { id: true, name: true } }, items: true } }, project: { select: { code: true, name: true } } },
  });
  if (!pr || !hasCompany(ctx, pr.companyId)) throw notFound();
  const rows = pr.items.map((it) => {
    const prices = pr.quotations.map((q) => {
      const qi = q.items.find((x) => x.requestItemId === it.id) ?? q.items.find((x) => x.description === it.description);
      return { quotationId: q.id, unitPrice: qi ? num(qi.unitPrice) : null, total: qi ? num(qi.total) : null };
    });
    const valid = prices.filter((p) => p.unitPrice !== null);
    const best = valid.length ? valid.reduce((a, b) => (a.unitPrice! <= b.unitPrice! ? a : b)) : null;
    return { itemId: it.id, description: it.description, unit: it.unit, quantity: num(it.quantity), prices, bestQuotationId: best?.quotationId ?? null };
  });
  const quotations = pr.quotations.map((q) => ({ id: q.id, number: q.number, supplier: q.supplier.name, total: num(q.total), deliveryDays: q.deliveryDays, validUntil: q.validUntil, selected: q.selected }));
  const lowest = quotations.length ? quotations.reduce((a, b) => (D(a.total).lessThanOrEqualTo(D(b.total)) ? a : b)) : null;
  return { request: { id: pr.id, number: pr.number, status: pr.status, project: pr.project }, quotations, rows, lowestQuotationId: lowest?.id ?? null };
});
