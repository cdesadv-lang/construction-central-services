import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("seed data invariants", () => {
  it("no cash box or bank account is overdrawn at any date (EGP, or in currency for foreign accounts)", async () => {
    const rows = await prisma.$queryRaw<{ code: string; company: string; min: number }[]>`
      SELECT code, company, MIN(run)::float AS min FROM (
        SELECT a."code", c."code" AS company,
               SUM(SUM(CASE WHEN l."currency" IS NOT NULL AND l."currency" <> 'EGP'
                            THEN (CASE WHEN l."debit" > 0 THEN l."fxAmount" ELSE -l."fxAmount" END)
                            ELSE l."debit" - l."credit" END)) OVER (PARTITION BY a."id" ORDER BY e."date") AS run
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e."id" = l."entryId"
        JOIN "Account" a ON a."id" = l."accountId"
        JOIN "Account" p ON p."id" = a."parentId"
        JOIN "Company" c ON c."id" = e."companyId"
        WHERE e."status" = 'POSTED' AND p."systemKey" IN ('CASH_PARENT', 'BANK_PARENT')
        GROUP BY a."id", a."code", c."code", e."date") r
      GROUP BY code, company`;
    expect(rows.length).toBeGreaterThan(10);
    const negative = rows.filter((r) => r.min < -0.005);
    expect(negative).toEqual([]);
  });
});
