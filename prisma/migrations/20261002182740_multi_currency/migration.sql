-- AlterTable
ALTER TABLE "CashBox" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP';

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'EGP';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "exchangeRate" DECIMAL(18,6),
ADD COLUMN     "fxAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TreasuryTransaction" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_companyId_currency_date_idx" ON "ExchangeRate"("companyId", "currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_companyId_currency_date_key" ON "ExchangeRate"("companyId", "currency", "date");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Realized foreign-exchange differences account for existing companies
INSERT INTO "Account" ("id", "companyId", "code", "name", "nameEn", "type", "parentId", "isPostable", "systemKey", "isActive", "createdAt")
SELECT gen_random_uuid()::text, c."id", '5206', 'فروق تغيير العملة', 'Foreign Exchange Differences', 'EXPENSE'::"AccountType", p."id", true, 'FX_DIFFERENCES', true, CURRENT_TIMESTAMP
FROM "Company" c
JOIN "Account" p ON p."companyId" = c."id" AND p."code" = '52'
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."systemKey" = 'FX_DIFFERENCES')
ON CONFLICT DO NOTHING;
