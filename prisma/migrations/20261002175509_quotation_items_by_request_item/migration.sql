-- Quotation lines are now linked to purchase-request items by id (previously matched by description).

-- 1) Drop dangling links (there was no FK before).
UPDATE "QuotationItem" qi SET "requestItemId" = NULL
WHERE "requestItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PurchaseRequestItem" p WHERE p."id" = qi."requestItemId");

-- 2) Backfill unlinked lines by matching description within the same request.
UPDATE "QuotationItem" qi SET "requestItemId" = m."pid"
FROM (
  SELECT DISTINCT ON (qi2."id") qi2."id" AS "qid", pri."id" AS "pid"
  FROM "QuotationItem" qi2
  JOIN "Quotation" q ON q."id" = qi2."quotationId"
  JOIN "PurchaseRequestItem" pri ON pri."requestId" = q."requestId" AND lower(trim(pri."description")) = lower(trim(qi2."description"))
  WHERE qi2."requestItemId" IS NULL
  ORDER BY qi2."id", pri."id"
) m
WHERE qi."id" = m."qid";

-- 3) Lines that still don't match become new request items (no data is lost).
INSERT INTO "PurchaseRequestItem" ("id", "requestId", "description", "unit", "quantity")
SELECT 'mig_' || qi."id", q."requestId", qi."description", 'unit', qi."quantity"
FROM "QuotationItem" qi JOIN "Quotation" q ON q."id" = qi."quotationId"
WHERE qi."requestItemId" IS NULL;
UPDATE "QuotationItem" SET "requestItemId" = 'mig_' || "id" WHERE "requestItemId" IS NULL;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "quotationItemId" TEXT,
ADD COLUMN     "requestItemId" TEXT;

-- AlterTable
ALTER TABLE "QuotationItem" ALTER COLUMN "requestItemId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "PurchaseRequestItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "PurchaseRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "QuotationItem_requestItemId_idx" ON "QuotationItem"("requestItemId");
