-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_startDate_idx" ON "FiscalYear"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_name_key" ON "FiscalYear"("companyId", "name");

-- CreateIndex
CREATE INDEX "AccountingPeriod_fiscalYearId_idx" ON "AccountingPeriod"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_companyId_year_month_key" ON "AccountingPeriod"("companyId", "year", "month");

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default grants for the new "periods" module (existing deployments; fresh installs get them from the seed).
INSERT INTO "RolePermission" ("id", "role", "module", "action")
SELECT gen_random_uuid()::text, r.role::"Role", 'periods', r.action
FROM (VALUES
  ('SUPER_ADMIN','view'),('SUPER_ADMIN','create'),('SUPER_ADMIN','edit'),('SUPER_ADMIN','approve'),('SUPER_ADMIN','delete'),
  ('FINANCE_MANAGER','view'),('FINANCE_MANAGER','create'),('FINANCE_MANAGER','edit'),('FINANCE_MANAGER','approve'),
  ('CHIEF_ACCOUNTANT','view'),('CHIEF_ACCOUNTANT','create'),('CHIEF_ACCOUNTANT','edit'),
  ('GENERAL_MANAGER','view'),('FINANCIAL_CONTROLLER','view'),('ACCOUNTANT','view')
) AS r(role, action)
ON CONFLICT ("role", "module", "action") DO NOTHING;
