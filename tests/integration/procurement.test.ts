import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { act, company, create, ctxFor, expectApiError, update } from "../helpers";

let proc: Ctx, nileId: string, supA: string, supB: string;

beforeAll(async () => {
  proc = await ctxFor("procurement@ccs.local");
  nileId = (await company("NILE")).id;
  const sups = await prisma.supplier.findMany({ where: { companyId: nileId }, take: 2 });
  [supA, supB] = sups.map((s) => s.id);
});

describe("quotation lines are linked to request items by id", () => {
  it("matches by id even when descriptions differ, and copies links into the PO", async () => {
    const pr = await create(proc, "purchase-requests", { companyId: nileId, date: "2026-09-01", items: [{ description: "Cement", unit: "ton", quantity: 10 }, { description: "Cement", unit: "bag", quantity: 500 }] });
    const items = await prisma.purchaseRequestItem.findMany({ where: { requestId: pr.id }, orderBy: { id: "asc" } });
    // identical descriptions on the request and different descriptions on the quote: only ids can match correctly
    const q = await create(proc, "quotations", { companyId: nileId, requestId: pr.id, supplierId: supA, date: "2026-09-02", items: [
      { requestItemId: items[1].id, description: "أسمنت شكاير", unitPrice: 90 },
      { requestItemId: items[0].id, description: "أسمنت سائب", unitPrice: 2400 },
    ] });
    const qi = await prisma.quotationItem.findMany({ where: { quotationId: q.id } });
    expect(qi.find((x) => x.requestItemId === items[1].id)!.quantity.toString()).toBe("500"); // quantity defaulted from the request line
    expect(Number(q.total)).toBe(500 * 90 + 10 * 2400);
    const po = await act(proc, "quotations", q.id, "create-order");
    const poItems = await prisma.purchaseOrderItem.findMany({ where: { orderId: po.id } });
    expect(poItems.map((i) => i.requestItemId).sort()).toEqual(items.map((i) => i.id).sort());
    expect(poItems.find((i) => i.requestItemId === items[1].id)!.unit).toBe("bag");
    expect(poItems.every((i) => i.quotationItemId)).toBe(true);
  });

  it("rejects lines from another request, duplicates, and item edits after quoting", async () => {
    const pr1 = await create(proc, "purchase-requests", { companyId: nileId, date: "2026-09-01", items: [{ description: "Steel", quantity: 2 }] });
    const pr2 = await create(proc, "purchase-requests", { companyId: nileId, date: "2026-09-01", items: [{ description: "Sand", quantity: 3 }] });
    const [i1] = await prisma.purchaseRequestItem.findMany({ where: { requestId: pr1.id } });
    const [i2] = await prisma.purchaseRequestItem.findMany({ where: { requestId: pr2.id } });
    await expectApiError(create(proc, "quotations", { companyId: nileId, requestId: pr1.id, supplierId: supB, date: "2026-09-02", items: [{ requestItemId: i2.id, unitPrice: 1 }] }), 400);
    await expectApiError(create(proc, "quotations", { companyId: nileId, requestId: pr1.id, supplierId: supB, date: "2026-09-02", items: [{ requestItemId: i1.id, unitPrice: 1 }, { requestItemId: i1.id, unitPrice: 2 }] }), 400);
    // description-only lines (no requestItemId) fail validation (ZodError -> HTTP 400 at the route layer)
    await expect(create(proc, "quotations", { companyId: nileId, requestId: pr1.id, supplierId: supB, date: "2026-09-02", items: [{ description: "Steel", quantity: 2, unitPrice: 1 }] })).rejects.toThrow(/requestItemId/);
    await create(proc, "quotations", { companyId: nileId, requestId: pr1.id, supplierId: supB, date: "2026-09-02", items: [{ requestItemId: i1.id, unitPrice: 37000 }] });
    await expectApiError(update(proc, "purchase-requests", pr1.id, { items: [{ description: "Steel 2", quantity: 5 }] }), 422);
  });
});
