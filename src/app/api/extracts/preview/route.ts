import { z } from "zod";
import { prisma } from "@/lib/db";
import { readJson, route } from "@/server/api";
import { assertCompany } from "@/server/context";
import { computeClientExtract, computeContractorExtract } from "@/server/services/posting";

const body = z.object({
  kind: z.enum(["contractor", "client"]),
  companyId: z.string(),
  contractId: z.string().optional(),
  projectId: z.string().optional(),
  cumulative: z.coerce.number().min(0),
  otherDeductions: z.coerce.number().min(0).optional(),
  excludeId: z.string().optional(),
});

/** Read-only calculation preview for the extract forms. */
export const POST = route(
  async ({ req, ctx }) => {
    const d = body.parse(await readJson(req));
    assertCompany(ctx, d.companyId);
    if (d.kind === "contractor") {
      const { calc } = await computeContractorExtract(prisma, { companyId: d.companyId, contractId: d.contractId!, cumulativeGross: d.cumulative, otherDeductions: d.otherDeductions, excludeId: d.excludeId });
      return calc;
    }
    const { calc } = await computeClientExtract(prisma, { companyId: d.companyId, projectId: d.projectId!, cumulativeWork: d.cumulative, otherDeductions: d.otherDeductions, excludeId: d.excludeId });
    return calc;
  },
  { status: 200 },
);
