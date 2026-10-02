-- AlterTable
ALTER TABLE "ClientExtract" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ContractorExtract" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Custody" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "salaryCurrency" VARCHAR(3) NOT NULL DEFAULT 'EGP';

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP';

-- AlterTable
ALTER TABLE "SubContract" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP';
