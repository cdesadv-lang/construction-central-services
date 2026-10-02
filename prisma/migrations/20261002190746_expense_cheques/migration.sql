-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "expenseId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "chequeDueDate" TIMESTAMP(3),
ADD COLUMN     "chequeNumber" TEXT;

-- CreateIndex
CREATE INDEX "Cheque_expenseId_idx" ON "Cheque"("expenseId");
