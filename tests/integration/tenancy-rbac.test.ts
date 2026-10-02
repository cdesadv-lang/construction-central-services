import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/context";
import { trialBalance } from "@/server/services/reports";
import { company, create, ctxFor, expectApiError, get, list, update } from "../helpers";

let accNile: Ctx, accModern: Ctx, viewer: Ctx, procurement: Ctx, site: Ctx, cfo: Ctx;
let nileId: string, modernId: string;

beforeAll(async () => {
  accNile = await ctxFor("acc.nile@ccs.local");
  accModern = await ctxFor("acc.modern@ccs.local");
  viewer = await ctxFor("viewer@ccs.local");
  procurement = await ctxFor("procurement@ccs.local");
  site = await ctxFor("site.nile@ccs.local");
  cfo = await ctxFor("cfo@ccs.local");
  nileId = (await company("NILE")).id;
  modernId = (await company("MODERN")).id;
});

describe("multi-tenant isolation", () => {
  it("accountant of company A only lists company A data", async () => {
    for (const res of ["suppliers", "contractors", "projects", "expenses", "journal-entries", "payments", "contractor-extracts", "client-extracts"]) {
      const r = await list(accNile, res);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.every((x: { companyId: string }) => x.companyId === nileId)).toBe(true);
    }
  });

  it("cannot read a record of company B by id (404, no existence leak)", async () => {
    const sup = await prisma.supplier.findFirstOrThrow({ where: { companyId: modernId } });
    await expectApiError(get(accNile, "suppliers", sup.id), 404);
    const ex = await prisma.contractorExtract.findFirstOrThrow({ where: { companyId: modernId, currency: "EGP" } });
    await expectApiError(get(accNile, "contractor-extracts", ex.id), 404);
    await expectApiError(update(accNile, "suppliers", sup.id, { name: "hijack" }), 404);
  });

  it("cannot filter by or create in a company without access (403)", async () => {
    await expectApiError(list(accNile, "suppliers", `companyId=${modernId}`), 403);
    await expectApiError(create(accNile, "suppliers", { companyId: modernId, name: "x" }), 403);
    await expectApiError(trialBalance(accNile, { companyId: modernId }), 403);
  });

  it("cannot reference another company's records from own company (400)", async () => {
    const modernProject = await prisma.project.findFirstOrThrow({ where: { companyId: modernId } });
    const nileCash = await prisma.cashBox.findFirstOrThrow({ where: { companyId: nileId, currency: "EGP" } });
    await expectApiError(
      create(accNile, "expenses", { companyId: nileId, projectId: modernProject.id, type: "OTHER", date: "2026-09-01", amount: 10, paymentMethod: "CASH", cashBoxId: nileCash.id }),
      400,
    );
  });

  it("accountant assigned to two companies sees both, but not the third", async () => {
    const r = await list(accModern, "projects");
    const ids = new Set(r.items.map((x: { companyId: string }) => x.companyId));
    expect(ids.has(nileId)).toBe(false);
    expect(ids.size).toBe(2);
  });

  it("project-restricted user only sees assigned project data", async () => {
    const r = await list(site, "projects");
    expect(r.items.map((p: { code: string }) => p.code)).toEqual(["NIL-P01"]);
    const ex = await list(site, "expenses");
    const p1 = await prisma.project.findFirstOrThrow({ where: { code: "NIL-P01" } });
    expect(ex.items.every((e: { projectId: string }) => e.projectId === p1.id)).toBe(true);
    const p2 = await prisma.project.findFirstOrThrow({ where: { code: "NIL-P02" } });
    await expectApiError(list(site, "expenses", `projectId=${p2.id}`), 403);
  });
});

describe("RBAC module permissions", () => {
  it("viewer cannot create; procurement officer cannot see journals", async () => {
    await expectApiError(create(viewer, "projects", { companyId: nileId, name: "x", contractValue: 1 }), 403);
    await expectApiError(list(viewer, "journal-entries"), 403);
    await expectApiError(list(procurement, "journal-entries"), 403);
    const pr = await list(procurement, "purchase-requests");
    expect(pr.total).toBeGreaterThan(0);
  });
  it("accountant cannot post (approve permission required)", async () => {
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { companyId: nileId, status: "PENDING_APPROVAL" } });
    const { act } = await import("../helpers");
    await expectApiError(act(accNile, "journal-entries", je.id, "post"), 403);
  });
  it("central CFO sees all companies", async () => {
    expect(cfo.companyIds.length).toBe(await prisma.company.count());
  });
});
