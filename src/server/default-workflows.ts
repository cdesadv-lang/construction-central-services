import type { Role } from "@prisma/client";

/** Global (all companies) approval workflows created by the seed and by `npm run db:bootstrap`. */
export const DEFAULT_WORKFLOWS: { docType: string; name: string; steps: [string, Role][] }[] = [
  { docType: "JOURNAL", name: "اعتماد القيود اليومية", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"], ["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "EXPENSE", name: "اعتماد المصروفات", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"], ["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "SUPPLIER_INVOICE", name: "اعتماد فواتير الموردين", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"]] },
  { docType: "PAYMENT", name: "اعتماد المدفوعات والتحصيلات", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"], ["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "CONTRACTOR_EXTRACT", name: "اعتماد مستخلصات المقاولين", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"], ["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "CLIENT_EXTRACT", name: "اعتماد مستخلصات العملاء", steps: [["مراجعة رئيس الحسابات", "CHIEF_ACCOUNTANT"], ["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "PAYROLL", name: "اعتماد مسيرات الرواتب", steps: [["اعتماد المدير المالي", "FINANCE_MANAGER"], ["اعتماد المدير العام", "GENERAL_MANAGER"]] },
  { docType: "TREASURY", name: "اعتماد حركات الخزينة والبنوك", steps: [["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "CUSTODY", name: "اعتماد صرف العهد", steps: [["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
  { docType: "PURCHASE_ORDER", name: "اعتماد أوامر الشراء", steps: [["اعتماد المدير المالي", "FINANCE_MANAGER"]] },
];
