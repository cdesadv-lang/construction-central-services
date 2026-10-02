-- DropIndex
DROP INDEX "PayrollSettings_companyId_key";

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "rulesId" TEXT;

-- AlterTable
ALTER TABLE "PayrollLine" ADD COLUMN     "companyHealthInsurance" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "healthInsurance" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "martyrsFund" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollSettings" ADD COLUMN     "martyrsFundPct" DECIMAL(6,3) NOT NULL DEFAULT 0.05,
ADD COLUMN     "uhiEmployeePct" DECIMAL(6,3) NOT NULL DEFAULT 1,
ADD COLUMN     "uhiEmployerMin" DECIMAL(18,2) NOT NULL DEFAULT 50,
ADD COLUMN     "uhiEmployerPct" DECIMAL(6,3) NOT NULL DEFAULT 4,
ADD COLUMN     "uhiEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PayrollSettings_companyId_idx" ON "PayrollSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_companyId_effectiveFrom_key" ON "PayrollSettings"("companyId", "effectiveFrom");

-- Martyrs' Fund payable (withheld 0.05% of salaries, remitted to the Ministry of Finance) for existing companies
INSERT INTO "Account" ("id", "companyId", "code", "name", "nameEn", "type", "parentId", "isPostable", "systemKey", "isActive", "createdAt")
SELECT gen_random_uuid()::text, c."id", '2111', 'صندوق تكريم الشهداء - مستحق', 'Martyrs'' Fund Payable', 'LIABILITY'::"AccountType", p."id", true, 'MARTYRS_FUND_PAYABLE', true, CURRENT_TIMESTAMP
FROM "Company" c
JOIN "Account" p ON p."companyId" = c."id" AND p."code" = '21'
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."systemKey" = 'MARTYRS_FUND_PAYABLE')
ON CONFLICT DO NOTHING;
