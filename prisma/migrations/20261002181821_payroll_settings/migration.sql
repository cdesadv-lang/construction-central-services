-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeInsPct" DECIMAL(6,3) NOT NULL DEFAULT 11,
    "companyInsPct" DECIMAL(6,3) NOT NULL DEFAULT 18.75,
    "insMinWage" DECIMAL(18,2) NOT NULL DEFAULT 2700,
    "insMaxWage" DECIMAL(18,2) NOT NULL DEFAULT 16700,
    "personalExemption" DECIMAL(18,2) NOT NULL DEFAULT 20000,
    "brackets" JSONB NOT NULL,
    "highIncomeSchedules" JSONB NOT NULL,
    "overtimeMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1.5,
    "hoursPerMonth" INTEGER NOT NULL DEFAULT 240,
    "daysPerMonth" INTEGER NOT NULL DEFAULT 30,
    "deductionsReduceTaxable" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceNote" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_companyId_key" ON "PayrollSettings"("companyId");

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Statutory defaults (Egypt 2026) for existing companies
INSERT INTO "PayrollSettings" ("id", "companyId", "brackets", "highIncomeSchedules", "sourceNote", "updatedAt")
SELECT 'pset_' || c."id", c."id",
  '[{"upTo":40000,"rate":0},{"upTo":55000,"rate":10},{"upTo":70000,"rate":15},{"upTo":200000,"rate":20},{"upTo":400000,"rate":22.5},{"upTo":1200000,"rate":25},{"upTo":null,"rate":27.5}]'::jsonb,
  '[{"minIncome":600000,"maxIncome":700000,"brackets":[{"upTo":55000,"rate":10},{"upTo":70000,"rate":15},{"upTo":200000,"rate":20},{"upTo":400000,"rate":22.5},{"upTo":null,"rate":25}]},{"minIncome":700000,"maxIncome":800000,"brackets":[{"upTo":70000,"rate":15},{"upTo":200000,"rate":20},{"upTo":400000,"rate":22.5},{"upTo":null,"rate":25}]},{"minIncome":800000,"maxIncome":900000,"brackets":[{"upTo":200000,"rate":20},{"upTo":400000,"rate":22.5},{"upTo":null,"rate":25}]},{"minIncome":900000,"maxIncome":1200000,"brackets":[{"upTo":400000,"rate":22.5},{"upTo":null,"rate":25}]},{"minIncome":1200000,"maxIncome":null,"brackets":[{"upTo":1200000,"rate":25},{"upTo":null,"rate":27.5}]}]'::jsonb,
  'Law 148/2019 + NOSI 2026 limits; Income Tax Law 91/2005 as amended by Law 7/2024',
  CURRENT_TIMESTAMP
FROM "Company" c
ON CONFLICT ("companyId") DO NOTHING;
