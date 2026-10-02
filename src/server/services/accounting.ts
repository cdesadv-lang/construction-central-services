import type { AccountType, CostCategory, ExpenseType, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { checkBalanced, UnbalancedError } from "@/lib/accounting";
import { D, r2 } from "@/lib/money";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { assertPeriodOpen } from "./periods";

interface TplAccount {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  parent?: string;
  postable?: boolean;
  key?: string;
  cat?: CostCategory;
}

/** Standard chart of accounts for an Egyptian contracting company. */
export const COA_TEMPLATE: TplAccount[] = [
  { code: "1", name: "الأصول", nameEn: "Assets", type: "ASSET", postable: false },
  { code: "11", name: "الأصول المتداولة", nameEn: "Current Assets", type: "ASSET", parent: "1", postable: false },
  { code: "1101", name: "النقدية بالخزائن", nameEn: "Cash on Hand", type: "ASSET", parent: "11", postable: false, key: "CASH_PARENT" },
  { code: "1102", name: "النقدية بالبنوك", nameEn: "Cash at Banks", type: "ASSET", parent: "11", postable: false, key: "BANK_PARENT" },
  { code: "1103", name: "العملاء (مستخلصات)", nameEn: "Accounts Receivable - Clients", type: "ASSET", parent: "11", key: "AR" },
  { code: "1104", name: "تأمينات محتجزة لدى العملاء", nameEn: "Retention Receivable", type: "ASSET", parent: "11", key: "RETENTION_RECEIVABLE" },
  { code: "1105", name: "ضرائب خصم من المنبع (مدينة)", nameEn: "Withholding Tax Receivable", type: "ASSET", parent: "11", key: "WHT_RECEIVABLE" },
  { code: "1106", name: "دفعات مقدمة لمقاولي الباطن", nameEn: "Advances to Subcontractors", type: "ASSET", parent: "11", key: "CONTRACTOR_ADVANCES" },
  { code: "1107", name: "عهد الموظفين", nameEn: "Employee Custody", type: "ASSET", parent: "11", key: "CUSTODY" },
  { code: "1108", name: "ضريبة القيمة المضافة - مدخلات", nameEn: "Input VAT", type: "ASSET", parent: "11", key: "VAT_INPUT" },
  { code: "1109", name: "أوراق قبض - شيكات بالحافظة", nameEn: "Notes Receivable - Cheques in Hand", type: "ASSET", parent: "11", key: "NOTES_RECEIVABLE" },
  { code: "1110", name: "شيكات تحت التحصيل", nameEn: "Cheques Under Collection", type: "ASSET", parent: "11", key: "CHEQUES_UNDER_COLLECTION" },
  { code: "12", name: "الأصول الثابتة", nameEn: "Fixed Assets", type: "ASSET", parent: "1", postable: false },
  { code: "1201", name: "معدات وآلات", nameEn: "Equipment & Machinery", type: "ASSET", parent: "12", key: "FA_EQUIPMENT" },
  { code: "1202", name: "سيارات", nameEn: "Vehicles", type: "ASSET", parent: "12", key: "FA_VEHICLES" },
  { code: "2", name: "الخصوم", nameEn: "Liabilities", type: "LIABILITY", postable: false },
  { code: "21", name: "الخصوم المتداولة", nameEn: "Current Liabilities", type: "LIABILITY", parent: "2", postable: false },
  { code: "2101", name: "الموردون", nameEn: "Accounts Payable - Suppliers", type: "LIABILITY", parent: "21", key: "AP_SUPPLIERS" },
  { code: "2102", name: "مقاولو الباطن", nameEn: "Accounts Payable - Subcontractors", type: "LIABILITY", parent: "21", key: "AP_CONTRACTORS" },
  { code: "2103", name: "تأمينات محتجزة لمقاولي الباطن", nameEn: "Retention Payable", type: "LIABILITY", parent: "21", key: "RETENTION_PAYABLE" },
  { code: "2104", name: "ضرائب خصم وإضافة مستحقة", nameEn: "Withholding Tax Payable", type: "LIABILITY", parent: "21", key: "WHT_PAYABLE" },
  { code: "2105", name: "هيئة التأمينات الاجتماعية", nameEn: "Social Insurance Payable", type: "LIABILITY", parent: "21", key: "INSURANCE_PAYABLE" },
  { code: "2106", name: "رواتب مستحقة", nameEn: "Salaries Payable", type: "LIABILITY", parent: "21", key: "SALARIES_PAYABLE" },
  { code: "2107", name: "ضريبة كسب العمل", nameEn: "Payroll Tax Payable", type: "LIABILITY", parent: "21", key: "PAYROLL_TAX_PAYABLE" },
  { code: "2108", name: "دفعات مقدمة من العملاء", nameEn: "Client Advances", type: "LIABILITY", parent: "21", key: "CLIENT_ADVANCES" },
  { code: "2109", name: "ضريبة القيمة المضافة - مخرجات", nameEn: "Output VAT", type: "LIABILITY", parent: "21", key: "VAT_OUTPUT" },
  { code: "2110", name: "أوراق دفع - شيكات صادرة", nameEn: "Notes Payable - Issued Cheques", type: "LIABILITY", parent: "21", key: "NOTES_PAYABLE" },
  { code: "3", name: "حقوق الملكية", nameEn: "Equity", type: "EQUITY", postable: false },
  { code: "3101", name: "رأس المال", nameEn: "Capital", type: "EQUITY", parent: "3", key: "CAPITAL" },
  { code: "3201", name: "أرباح مرحلة", nameEn: "Retained Earnings", type: "EQUITY", parent: "3", key: "RETAINED_EARNINGS" },
  { code: "4", name: "الإيرادات", nameEn: "Revenue", type: "REVENUE", postable: false },
  { code: "4101", name: "إيرادات المقاولات (مستخلصات)", nameEn: "Contract Revenue", type: "REVENUE", parent: "4", key: "REVENUE_CONTRACTS" },
  { code: "4201", name: "إيرادات أخرى", nameEn: "Other Income", type: "REVENUE", parent: "4", key: "OTHER_INCOME" },
  { code: "4202", name: "إيرادات خصومات وغرامات", nameEn: "Deductions & Penalties Income", type: "REVENUE", parent: "4", key: "PENALTIES_INCOME" },
  { code: "5", name: "المصروفات والتكاليف", nameEn: "Expenses & Costs", type: "EXPENSE", postable: false },
  { code: "51", name: "تكاليف المشروعات المباشرة", nameEn: "Direct Project Costs", type: "EXPENSE", parent: "5", postable: false },
  { code: "5101", name: "تكلفة مواد", nameEn: "Materials Cost", type: "EXPENSE", parent: "51", key: "COST_MATERIALS", cat: "MATERIALS" },
  { code: "5102", name: "تكلفة عمالة", nameEn: "Labor Cost", type: "EXPENSE", parent: "51", key: "COST_LABOR", cat: "LABOR" },
  { code: "5103", name: "تكلفة معدات", nameEn: "Equipment Cost", type: "EXPENSE", parent: "51", key: "COST_EQUIPMENT", cat: "EQUIPMENT" },
  { code: "5104", name: "تكلفة مقاولي الباطن", nameEn: "Subcontractors Cost", type: "EXPENSE", parent: "51", key: "COST_SUBCONTRACTORS", cat: "SUBCONTRACTORS" },
  { code: "5105", name: "نقل ومواصلات", nameEn: "Transport", type: "EXPENSE", parent: "51", key: "COST_TRANSPORT", cat: "TRANSPORT" },
  { code: "5106", name: "وقود ومحروقات", nameEn: "Fuel", type: "EXPENSE", parent: "51", key: "COST_FUEL", cat: "EQUIPMENT" },
  { code: "5107", name: "إيجارات مواقع", nameEn: "Site Rent", type: "EXPENSE", parent: "51", key: "COST_RENT", cat: "OTHER" },
  { code: "5108", name: "رواتب وأجور المشروعات", nameEn: "Project Salaries", type: "EXPENSE", parent: "51", key: "COST_SALARIES", cat: "LABOR" },
  { code: "5109", name: "تكاليف مباشرة أخرى", nameEn: "Other Direct Costs", type: "EXPENSE", parent: "51", key: "COST_OTHER", cat: "OTHER" },
  { code: "52", name: "مصروفات عمومية وإدارية", nameEn: "General & Administrative", type: "EXPENSE", parent: "5", postable: false },
  { code: "5201", name: "مصروفات إدارية", nameEn: "Administrative Expenses", type: "EXPENSE", parent: "52", key: "ADMIN_EXPENSES" },
  { code: "5202", name: "رواتب الإدارة", nameEn: "Admin Salaries", type: "EXPENSE", parent: "52", key: "ADMIN_SALARIES" },
  { code: "5203", name: "تأمينات مخصومة بمعرفة العملاء", nameEn: "Insurance Deducted by Clients", type: "EXPENSE", parent: "52", key: "CLIENT_INSURANCE_EXP" },
  { code: "5204", name: "خصومات العملاء", nameEn: "Client Deductions", type: "EXPENSE", parent: "52", key: "CLIENT_DEDUCTIONS_EXP" },
  { code: "5205", name: "مصروفات بنكية", nameEn: "Bank Charges", type: "EXPENSE", parent: "52", key: "BANK_CHARGES" },
  { code: "5206", name: "فروق تغيير العملة", nameEn: "Foreign Exchange Differences", type: "EXPENSE", parent: "52", key: "FX_DIFFERENCES" },
  { code: "5207", name: "فروق عملة غير محققة (إعادة تقييم)", nameEn: "Unrealized FX Differences (Revaluation)", type: "EXPENSE", parent: "52", key: "FX_UNREALIZED" },
];

export const EXPENSE_TYPE_ACCOUNT: Record<ExpenseType, string> = {
  MATERIALS: "COST_MATERIALS",
  LABOR: "COST_LABOR",
  EQUIPMENT: "COST_EQUIPMENT",
  TRANSPORT: "COST_TRANSPORT",
  FUEL: "COST_FUEL",
  RENT: "COST_RENT",
  CONTRACTORS: "COST_SUBCONTRACTORS",
  ADMIN: "ADMIN_EXPENSES",
  OTHER: "COST_OTHER",
};

export async function setupCompanyAccounts(tx: Tx, companyId: string) {
  const ids = new Map<string, string>();
  for (const a of COA_TEMPLATE) {
    const created = await tx.account.create({
      data: {
        companyId,
        code: a.code,
        name: a.name,
        nameEn: a.nameEn,
        type: a.type,
        isPostable: a.postable ?? true,
        systemKey: a.key ?? null,
        costCategory: a.cat ?? null,
        parentId: a.parent ? ids.get(a.parent) : null,
      },
    });
    ids.set(a.code, created.id);
  }
}

export async function accountIdByKey(tx: Tx, companyId: string, key: string) {
  const a = await tx.account.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } }, select: { id: true } });
  if (!a) throw unprocessable(`System account ${key} is not configured for this company`);
  return a.id;
}

/** Creates a child ledger account under a system parent (used for cash boxes / bank accounts). */
export async function createChildAccount(tx: Tx, companyId: string, parentKey: string, name: string, nameEn?: string) {
  const parent = await tx.account.findUnique({ where: { companyId_systemKey: { companyId, systemKey: parentKey } } });
  if (!parent) throw unprocessable(`Parent account ${parentKey} missing`);
  const count = await tx.account.count({ where: { companyId, parentId: parent.id } });
  let n = count + 1;
  let code = `${parent.code}${String(n).padStart(2, "0")}`;
  while (await tx.account.findUnique({ where: { companyId_code: { companyId, code } } })) {
    n++;
    code = `${parent.code}${String(n).padStart(2, "0")}`;
  }
  return tx.account.create({ data: { companyId, code, name, nameEn, type: parent.type, parentId: parent.id, isPostable: true } });
}

export interface LineInput {
  accountId: string;
  debit?: number | string | Prisma.Decimal | null;
  credit?: number | string | Prisma.Decimal | null;
  costCenterId?: string | null;
  projectId?: string | null;
  description?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  /** foreign-currency tag: debit/credit are base (EGP); fxAmount is the original amount */
  currency?: string | null;
  fxAmount?: number | string | Prisma.Decimal | null;
  exchangeRate?: number | string | Prisma.Decimal | null;
}

export interface EntryInput {
  companyId: string;
  date: Date;
  description: string;
  projectId?: string | null;
  lines: LineInput[];
  status?: "DRAFT" | "POSTED";
  sourceType?: string | null;
  sourceId?: string | null;
  reversalOfId?: string | null;
  /** internal only: year-end closing entries are posted into the closed last period of the year */
  skipPeriodCheck?: boolean;
  /** informational: currency/rate the entry was entered in (lines already carry EGP amounts + fx tags) */
  currency?: string | null;
  exchangeRate?: number | string | Prisma.Decimal | null;
}

/** Journal sources produced by year-end closing; excluded from profit & loss reporting (they zero revenue/expense accounts). */
export const CLOSING_SOURCE_TYPES = ["YEAR_END_CLOSE", "YEAR_END_CLOSE_REVERSAL"];
/** Prisma JournalEntry filter excluding closing entries (null sourceType = manual entries are kept). */
export const EXCLUDE_CLOSING: Prisma.JournalEntryWhereInput = { OR: [{ sourceType: null }, { sourceType: { notIn: CLOSING_SOURCE_TYPES } }] };

async function validateLines(tx: Tx, companyId: string, lines: LineInput[]) {
  let totals;
  try {
    totals = checkBalanced(lines);
  } catch (e) {
    if (e instanceof UnbalancedError) throw unprocessable(e.message);
    throw e;
  }
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, companyId } });
  if (accounts.length !== accountIds.length) throw badRequest("One or more accounts do not belong to this company");
  const bad = accounts.find((a) => !a.isPostable || !a.isActive);
  if (bad) throw unprocessable(`Account ${bad.code} - ${bad.name} is a header/inactive account and cannot be posted to`);
  const ccIds = [...new Set(lines.map((l) => l.costCenterId).filter(Boolean) as string[])];
  if (ccIds.length) {
    const n = await tx.costCenter.count({ where: { id: { in: ccIds }, companyId } });
    if (n !== ccIds.length) throw badRequest("Cost center does not belong to this company");
  }
  const prjIds = [...new Set(lines.map((l) => l.projectId).filter(Boolean) as string[])];
  if (prjIds.length) {
    const n = await tx.project.count({ where: { id: { in: prjIds }, companyId } });
    if (n !== prjIds.length) throw badRequest("Project does not belong to this company");
  }
  return totals;
}

function lineData(companyId: string, entryProjectId: string | null | undefined, l: LineInput) {
  return {
    companyId,
    accountId: l.accountId,
    debit: r2(D(l.debit)),
    credit: r2(D(l.credit)),
    costCenterId: l.costCenterId || null,
    projectId: l.projectId || entryProjectId || null,
    description: l.description || null,
    partyType: l.partyType || null,
    partyId: l.partyId || null,
    ...(l.currency && l.currency !== "EGP" ? { currency: l.currency, fxAmount: r2(D(l.fxAmount)), exchangeRate: D(l.exchangeRate ?? 1) } : {}),
  };
}

export async function createJournalEntry(tx: Tx, ctx: Ctx | null, input: EntryInput) {
  if (!input.skipPeriodCheck) await assertPeriodOpen(tx, input.companyId, input.date, "Journal entries");
  if (input.projectId) {
    const p = await tx.project.findFirst({ where: { id: input.projectId, companyId: input.companyId } });
    if (!p) throw badRequest("Project does not belong to this company");
  }
  const totals = await validateLines(tx, input.companyId, input.lines);
  const number = await nextNumber(tx, input.companyId, "JE", "JE");
  const posted = input.status === "POSTED";
  const entry = await tx.journalEntry.create({
    data: {
      companyId: input.companyId,
      number,
      date: input.date,
      description: input.description,
      projectId: input.projectId || null,
      status: input.status ?? "DRAFT",
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      currency: input.currency || "EGP",
      exchangeRate: D(input.exchangeRate ?? 1),
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      createdById: ctx?.user.id ?? null,
      postedById: posted ? (ctx?.user.id ?? null) : null,
      approvedById: posted ? (ctx?.user.id ?? null) : null,
      postedAt: posted ? new Date() : null,
      lines: { create: input.lines.map((l) => lineData(input.companyId, input.projectId, l)) },
    },
    include: { lines: true },
  });
  await audit(tx, ctx, { action: posted ? "CREATE_POSTED" : "CREATE", entity: "JournalEntry", entityId: entry.id, companyId: entry.companyId, after: entry });
  return entry;
}

export async function updateDraftJournalEntry(tx: Tx, ctx: Ctx, id: string, input: Omit<EntryInput, "companyId" | "status" | "skipPeriodCheck">) {
  const existing = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) throw notFound();
  if (existing.status !== "DRAFT") throw unprocessable("Only draft entries can be edited");
  if (existing.sourceType) throw unprocessable("System-generated entries cannot be edited");
  await assertPeriodOpen(tx, existing.companyId, existing.date, "Journal entries");
  await assertPeriodOpen(tx, existing.companyId, input.date, "Journal entries");
  const totals = await validateLines(tx, existing.companyId, input.lines);
  const entry = await tx.journalEntry.update({
    where: { id },
    data: {
      date: input.date,
      description: input.description,
      projectId: input.projectId || null,
      currency: input.currency || "EGP",
      exchangeRate: D(input.exchangeRate ?? 1),
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      lines: { deleteMany: {}, create: input.lines.map((l) => lineData(existing.companyId, input.projectId, l)) },
    },
    include: { lines: true },
  });
  await audit(tx, ctx, { action: "UPDATE", entity: "JournalEntry", entityId: id, companyId: existing.companyId, before: existing, after: entry });
  return entry;
}

/** Posts an APPROVED manual journal entry to the ledger. */
export async function postJournalEntry(tx: Tx, ctx: Ctx, id: string) {
  const e = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!e) throw notFound();
  if (e.status !== "APPROVED") throw unprocessable(`Only approved entries can be posted (current status: ${e.status})`);
  await assertPeriodOpen(tx, e.companyId, e.date, "Journal entries");
  await validateLines(tx, e.companyId, e.lines);
  const res = await tx.journalEntry.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "POSTED", postedById: ctx.user.id, postedAt: new Date() },
  });
  if (res.count !== 1) throw unprocessable("Entry was modified concurrently");
  await audit(tx, ctx, { action: "POST", entity: "JournalEntry", entityId: id, companyId: e.companyId, before: { status: e.status }, after: { status: "POSTED" } });
  return tx.journalEntry.findUnique({ where: { id } });
}

/** Creates and posts a reversing entry (swaps debits/credits). The original stays posted, so the net effect is zero. */
export async function reverseJournalEntry(tx: Tx, ctx: Ctx | null, id: string, reason?: string, date?: Date, opts: { skipPeriodCheck?: boolean } = {}) {
  const e = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!e) throw notFound();
  if (e.status !== "POSTED") throw unprocessable("Only posted entries can be reversed");
  const already = await tx.journalEntry.findFirst({ where: { reversalOfId: id } });
  if (already) throw unprocessable(`Entry already reversed by ${already.number}`);
  if (e.reversalOfId) throw unprocessable("A reversal entry cannot itself be reversed");
  const rev = await createJournalEntry(tx, ctx, {
    companyId: e.companyId,
    date: date ?? new Date(),
    description: `عكس قيد ${e.number}${reason ? " — " + reason : ""} / Reversal of ${e.number}`,
    projectId: e.projectId,
    status: "POSTED",
    sourceType: e.sourceType ? `${e.sourceType}_REVERSAL` : "REVERSAL",
    sourceId: e.sourceId,
    reversalOfId: e.id,
    skipPeriodCheck: opts.skipPeriodCheck,
    currency: e.currency,
    exchangeRate: e.exchangeRate,
    lines: e.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      costCenterId: l.costCenterId,
      projectId: l.projectId,
      description: l.description,
      partyType: l.partyType,
      partyId: l.partyId,
      currency: l.currency,
      fxAmount: l.fxAmount,
      exchangeRate: l.exchangeRate,
    })),
  });
  await audit(tx, ctx, { action: "REVERSE", entity: "JournalEntry", entityId: id, companyId: e.companyId, after: { reversalId: rev.id, number: rev.number } });
  return rev;
}

/** Ledger balance (debit - credit) of an account from posted entries only. */
export async function accountBalance(tx: Tx, accountId: string, opts: { to?: Date; partyId?: string } = {}) {
  const agg = await tx.journalLine.aggregate({
    where: { accountId, partyId: opts.partyId, entry: { status: "POSTED", ...(opts.to ? { date: { lte: opts.to } } : {}) } },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit).minus(D(agg._sum.credit));
}
