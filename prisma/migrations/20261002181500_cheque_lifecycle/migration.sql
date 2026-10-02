-- Cheque lifecycle: received/issued -> under collection / deposited -> cleared / bounced / cancelled, with automatic entries.
-- AlterEnum
BEGIN;
CREATE TYPE "ChequeStatus_new" AS ENUM ('RECEIVED', 'ISSUED', 'UNDER_COLLECTION', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED');
ALTER TABLE "public"."Cheque" ALTER COLUMN "status" DROP DEFAULT;
-- Map legacy PENDING cheques: payment-linked ones already hit the bank in the old posting rule.
ALTER TABLE "Cheque" ALTER COLUMN "status" TYPE "ChequeStatus_new" USING (
  CASE
    WHEN "status"::text = 'PENDING' AND "type"::text = 'RECEIVED' AND "paymentId" IS NOT NULL THEN 'DEPOSITED'
    WHEN "status"::text = 'PENDING' AND "type"::text = 'ISSUED' AND "paymentId" IS NOT NULL THEN 'CLEARED'
    WHEN "status"::text = 'PENDING' THEN "type"::text
    ELSE "status"::text
  END
)::"ChequeStatus_new";
ALTER TYPE "ChequeStatus" RENAME TO "ChequeStatus_old";
ALTER TYPE "ChequeStatus_new" RENAME TO "ChequeStatus";
DROP TYPE "public"."ChequeStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Cheque" DROP CONSTRAINT "Cheque_bankAccountId_fkey";

-- DropIndex
DROP INDEX "Cheque_companyId_bankAccountId_number_key";

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "counterAccountId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "drawerBank" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "ledger" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "partyType" TEXT,
ALTER COLUMN "bankAccountId" DROP NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- Cheques that existed before the lifecycle are register-only (their accounting was done by the old rules).
UPDATE "Cheque" SET "ledger" = false;

-- CreateTable
CREATE TABLE "ChequeMovement" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromStatus" "ChequeStatus",
    "toStatus" "ChequeStatus" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bankAccountId" TEXT,
    "charges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChequeMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChequeMovement_chequeId_idx" ON "ChequeMovement"("chequeId");

-- CreateIndex
CREATE INDEX "Cheque_companyId_status_idx" ON "Cheque"("companyId", "status");

-- CreateIndex
CREATE INDEX "Cheque_paymentId_idx" ON "Cheque"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_companyId_type_number_bankAccountId_key" ON "Cheque"("companyId", "type", "number", "bankAccountId");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeMovement" ADD CONSTRAINT "ChequeMovement_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- New system accounts for cheques in every existing company.
INSERT INTO "Account" ("id", "companyId", "code", "name", "nameEn", "type", "parentId", "isPostable", "systemKey", "isActive", "createdAt")
SELECT gen_random_uuid()::text, c."id", v.code, v.name, v."nameEn", v.type::"AccountType", p."id", true, v.key, true, CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('1109', 'أوراق قبض - شيكات بالحافظة', 'Notes Receivable - Cheques in Hand', 'ASSET', 'NOTES_RECEIVABLE', '11'),
  ('1110', 'شيكات تحت التحصيل', 'Cheques Under Collection', 'ASSET', 'CHEQUES_UNDER_COLLECTION', '11'),
  ('2110', 'أوراق دفع - شيكات صادرة', 'Notes Payable - Issued Cheques', 'LIABILITY', 'NOTES_PAYABLE', '21')
) AS v(code, name, "nameEn", type, key, parent)
JOIN "Account" p ON p."companyId" = c."id" AND p."code" = v.parent
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."systemKey" = v.key)
ON CONFLICT DO NOTHING;
-- Cheques that existed before the lifecycle are register-only (their accounting was done by the old rules).
UPDATE "Cheque" SET "ledger" = false;
