import type { ModuleKey } from "@/lib/permissions";

export const DOC_TYPES = {
  JOURNAL: { model: "journalEntry", module: "journals", label: "قيد يومية / Journal Entry", link: "/journal-entries" },
  EXPENSE: { model: "expense", module: "expenses", label: "مصروف / Expense", link: "/expenses" },
  SUPPLIER_INVOICE: { model: "supplierInvoice", module: "suppliers", label: "فاتورة مورد / Supplier Invoice", link: "/suppliers?tab=invoices" },
  PAYMENT: { model: "payment", module: "payments", label: "سداد / تحصيل - Payment", link: "/treasury?tab=payments" },
  CONTRACTOR_EXTRACT: { model: "contractorExtract", module: "contractorExtracts", label: "مستخلص مقاول / Contractor Extract", link: "/contractor-extracts" },
  CLIENT_EXTRACT: { model: "clientExtract", module: "clientExtracts", label: "مستخلص عميل / Client Extract", link: "/client-extracts" },
  PAYROLL: { model: "payroll", module: "payroll", label: "مسير رواتب / Payroll", link: "/payroll" },
  TREASURY: { model: "treasuryTransaction", module: "treasury", label: "حركة خزينة/بنك / Treasury", link: "/treasury" },
  CUSTODY: { model: "custody", module: "custody", label: "عهدة / Custody", link: "/expenses?tab=custody" },
  PURCHASE_ORDER: { model: "purchaseOrder", module: "procurement", label: "أمر شراء / Purchase Order", link: "/procurement?tab=orders" },
} as const satisfies Record<string, { model: string; module: ModuleKey; label: string; link: string }>;

export type DocType = keyof typeof DOC_TYPES;
export const isDocType = (s: string): s is DocType => s in DOC_TYPES;
