import { z } from "zod";
import { prisma } from "@/lib/db";
import { D, num, r2 } from "@/lib/money";
import { badRequest, notFound } from "@/lib/errors";
import { listParams, readJson, route } from "@/server/api";
import { assertCompany, requirePerm } from "@/server/context";
import { audit } from "@/server/audit";

async function load(bankAccountId: string, statementDate: Date) {
  const bank = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bank) throw notFound("Bank account not found");
  const lines = await prisma.journalLine.findMany({
    where: { accountId: bank.accountId, entry: { status: "POSTED", date: { lte: statementDate } } },
    include: { entry: { select: { number: true, date: true, description: true } } },
    orderBy: { entry: { date: "asc" } },
  });
  const book = lines.reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
  const cleared = lines.filter((l) => l.reconciledAt).reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
  return { bank, lines, book, cleared };
}

export const GET = route(async ({ req, ctx }) => {
  requirePerm(ctx, "banks", "view");
  const p = listParams(req);
  const bankAccountId = p.sp.get("bankAccountId");
  if (!bankAccountId) throw badRequest("bankAccountId is required");
  const date = p.sp.get("statementDate") ? new Date(p.sp.get("statementDate") + "T23:59:59Z") : new Date();
  const { bank, lines, book, cleared } = await load(bankAccountId, date);
  assertCompany(ctx, bank.companyId);
  return {
    bank: { id: bank.id, bankName: bank.bankName, accountNumber: bank.accountNumber },
    bookBalance: num(book),
    clearedBalance: num(cleared),
    uncleared: lines.filter((l) => !l.reconciledAt).map((l) => ({ id: l.id, date: l.entry.date, entryNumber: l.entry.number, description: l.description || l.entry.description, debit: num(l.debit), credit: num(l.credit) })),
    history: await prisma.bankReconciliation.findMany({ where: { bankAccountId }, orderBy: { statementDate: "desc" }, take: 20 }),
  };
});

const body = z.object({
  bankAccountId: z.string(),
  statementDate: z.coerce.date(),
  statementBalance: z.coerce.number(),
  lineIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const POST = route(async ({ req, ctx }) => {
  requirePerm(ctx, "banks", "create");
  const d = body.parse(await readJson(req));
  const bank = await prisma.bankAccount.findUnique({ where: { id: d.bankAccountId } });
  if (!bank) throw notFound();
  assertCompany(ctx, bank.companyId);
  const stDate = new Date(d.statementDate);
  stDate.setUTCHours(23, 59, 59, 999);
  return prisma.$transaction(async (tx) => {
    const rec = await tx.bankReconciliation.create({
      data: { companyId: bank.companyId, bankAccountId: bank.id, statementDate: stDate, statementBalance: d.statementBalance, bookBalance: 0, clearedBalance: 0, difference: 0, notes: d.notes, createdById: ctx.user.id },
    });
    if (d.lineIds.length) {
      const res = await tx.journalLine.updateMany({
        where: { id: { in: d.lineIds }, accountId: bank.accountId, reconciledAt: null, entry: { status: "POSTED", date: { lte: stDate } } },
        data: { reconciledAt: new Date(), reconciliationId: rec.id },
      });
      if (res.count !== d.lineIds.length) throw badRequest("Some lines are invalid, already reconciled or after the statement date");
    }
    const lines = await tx.journalLine.findMany({ where: { accountId: bank.accountId, entry: { status: "POSTED", date: { lte: stDate } } } });
    const book = lines.reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
    const cleared = lines.filter((l) => l.reconciledAt).reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
    const updated = await tx.bankReconciliation.update({
      where: { id: rec.id },
      data: { bookBalance: r2(book), clearedBalance: r2(cleared), difference: r2(D(d.statementBalance).minus(cleared)) },
    });
    await audit(tx, ctx, { action: "RECONCILE", entity: "BankReconciliation", entityId: rec.id, companyId: bank.companyId, after: updated });
    return updated;
  });
});
