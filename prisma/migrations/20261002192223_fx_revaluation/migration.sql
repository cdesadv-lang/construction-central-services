-- CreateEnum
CREATE TYPE "FxRevaluationStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "FxRevaluation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "FxRevaluationStatus" NOT NULL DEFAULT 'POSTED',
    "autoReverse" BOOLEAN NOT NULL DEFAULT true,
    "rates" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totalGain" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "reversalEntryId" TEXT,
    "reversalDate" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRevaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRevaluation_companyId_date_idx" ON "FxRevaluation"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FxRevaluation_companyId_number_key" ON "FxRevaluation"("companyId", "number");

-- AddForeignKey
ALTER TABLE "FxRevaluation" ADD CONSTRAINT "FxRevaluation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unrealized foreign-exchange differences account for existing companies
INSERT INTO "Account" ("id", "companyId", "code", "name", "nameEn", "type", "parentId", "isPostable", "systemKey", "isActive", "createdAt")
SELECT gen_random_uuid()::text, c."id", '5207', 'فروق عملة غير محققة (إعادة تقييم)', 'Unrealized FX Differences (Revaluation)', 'EXPENSE'::"AccountType", p."id", true, 'FX_UNREALIZED', true, CURRENT_TIMESTAMP
FROM "Company" c
JOIN "Account" p ON p."companyId" = c."id" AND p."code" = '52'
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."systemKey" = 'FX_UNREALIZED')
ON CONFLICT DO NOTHING;
