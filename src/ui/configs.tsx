"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";
import { useApp } from "@/components/app-provider";
import type { AnyRow, FieldDef, ResourceConfig } from "@/components/resource/types";
import { DataTable } from "@/components/resource/table";
import { ExtractPreview, JournalBalance, PartyStatement, ReportBlock } from "@/components/widgets";
import { useLookup } from "@/components/resource/lookup";
import { today } from "@/lib/client/format";
import { ProcurementComparison } from "./procurement-comparison";

type T = (k: string, f?: string) => string;

const DOC_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "CANCELLED"] as const;
const EXPENSE_TYPES = ["MATERIALS", "LABOR", "EQUIPMENT", "TRANSPORT", "FUEL", "RENT", "CONTRACTORS", "ADMIN", "OTHER"] as const;
const COST_CATS = ["MATERIALS", "LABOR", "EQUIPMENT", "SUBCONTRACTORS", "TRANSPORT", "OTHER"] as const;
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
const TREASURY_KINDS = ["CASH_RECEIPT", "CASH_PAYMENT", "CASH_TRANSFER", "BANK_DEPOSIT", "BANK_WITHDRAWAL", "BANK_TRANSFER", "BANK_RECEIPT", "BANK_PAYMENT"] as const;
const PAYMENT_TYPES = ["SUPPLIER_PAYMENT", "CONTRACTOR_PAYMENT", "CONTRACTOR_ADVANCE", "CLIENT_RECEIPT"] as const;

const statusFilter: FieldDef = { key: "status", type: "select", options: DOC_STATUSES };
const projectLookup: FieldDef = { key: "projectId", type: "lookup", lookup: "projects" };
const code = (r: AnyRow, k: string) => (r[k] ? `${r[k].code ?? r[k].number ?? ""} ${r[k].name ?? ""}`.trim() : "");
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function buildConfigs(t: T): Record<string, ResourceConfig> {
  return {
    companies: {
      resource: "companies", module: "companies", title: t("nav.companies"), global: true, noDelete: false,
      columns: [
        { key: "code" }, { key: "name" }, { key: "commercialRegister" }, { key: "taxNumber" }, { key: "contactPerson" }, { key: "phone" },
        { key: "contractStart", type: "date" }, { key: "contractEnd", type: "date" }, { key: "servicePackage", type: "enum" },
        { key: "projects", get: (r) => r._count?.projects, type: "number", label: t("f.projects") }, { key: "employees", get: (r) => r._count?.employees, type: "number", label: t("f.employees") },
        { key: "status", type: "status" },
      ],
      form: [
        { key: "code", required: true }, { key: "name", required: true, span: 2 }, { key: "nameEn" }, { key: "commercialRegister" }, { key: "taxNumber" },
        { key: "contactPerson" }, { key: "phone" }, { key: "email", type: "email" }, { key: "contractStart", type: "date" }, { key: "contractEnd", type: "date" },
        { key: "servicePackage", type: "select", options: ["BASIC", "STANDARD", "PREMIUM"], default: "STANDARD", required: true },
        { key: "status", type: "select", options: ["ACTIVE", "SUSPENDED", "INACTIVE"], default: "ACTIVE", required: true }, { key: "address", span: 3 },
      ],
      detail: (r) => <ReportBlock report="management-summary" params={{ companyId: r.id }} key={r.id} />,
    },
    projects: {
      resource: "projects", module: "projects", title: t("t.projects"), entityType: "project",
      columns: [
        { key: "code" }, { key: "name" }, { key: "client.name", label: t("f.client") }, { key: "contractValue", type: "money", total: true },
        { key: "budget", type: "money", total: true }, { key: "revenue", type: "money", total: true }, { key: "actualCost", type: "money", total: true },
        { key: "profit", type: "money", total: true }, { key: "completionPct", type: "pct" }, { key: "status", type: "status" }, { key: "delayed", type: "bool" },
      ],
      form: [
        { key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }, { key: "clientId", type: "lookup", lookup: "clients" },
        { key: "contractValue", type: "money", required: true }, { key: "budget", type: "money" }, { key: "startDate", type: "date" }, { key: "endDate", type: "date" },
        { key: "projectManager" }, { key: "consultant" }, { key: "location" }, { key: "completionPct", type: "pct", default: 0 },
        { key: "clientRetentionPct", type: "pct", default: 5 }, { key: "clientTaxPct", type: "pct", default: 1 }, { key: "clientInsurancePct", type: "pct", default: 0 },
        { key: "status", type: "select", options: ["PLANNING", "ACTIVE", "SUSPENDED", "COMPLETED", "CLOSED"], default: "PLANNING", required: true },
      ],
      filters: [{ key: "status", type: "select", options: ["PLANNING", "ACTIVE", "SUSPENDED", "COMPLETED", "CLOSED"] }, { key: "clientId", type: "lookup", lookup: "clients" }],
      detail: (r) => <ReportBlock report="budget-vs-actual" params={{ companyId: r.companyId, projectId: r.id }} key={r.id} />,
    },
    clients: {
      resource: "clients", module: "projects", title: t("t.clients"),
      columns: [{ key: "code" }, { key: "name" }, { key: "taxNumber" }, { key: "contactPerson" }, { key: "phone" }, { key: "billed", type: "money", total: true }, { key: "collected", type: "money", total: true }, { key: "balance", type: "money", total: true }],
      form: [{ key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }, { key: "taxNumber" }, { key: "contactPerson" }, { key: "phone" }, { key: "email", type: "email" }, { key: "address", span: 2 }],
      detail: (r) => <PartyStatement report="client-statement" partyId={r.id} companyId={r.companyId} />,
    },
    "project-budgets": {
      resource: "project-budgets", module: "costing", title: t("t.budgets"), pageSize: 100,
      columns: [{ key: "project", get: (r) => code(r, "project"), label: t("f.project") }, { key: "category", type: "enum" }, { key: "amount", type: "money", total: true }, { key: "notes" }],
      form: [{ ...projectLookup, required: true, createOnly: true }, { key: "category", type: "select", options: COST_CATS, required: true, createOnly: true }, { key: "amount", type: "money", required: true }, { key: "notes", span: 3 }],
      filters: [projectLookup, { key: "category", type: "select", options: COST_CATS }],
    },
    accounts: {
      resource: "accounts", module: "accounting", title: t("t.accounts"), pageSize: 100,
      columns: [
        { key: "code", className: "num" }, { key: "name" }, { key: "type", type: "enum" }, { key: "parent", get: (r) => code(r, "parent"), label: t("f.parent") },
        { key: "isPostable", type: "bool" }, { key: "costCategory", type: "enum" }, { key: "debit", type: "money" }, { key: "credit", type: "money" }, { key: "balance", type: "money" },
      ],
      form: [
        { key: "type", type: "select", options: ACCOUNT_TYPES, required: true, createOnly: true },
        { key: "parentId", type: "lookup", lookup: "accounts", lookupParams: (v) => ({ type: v.type }), createOnly: true, onPick: (_v, _vals, p) => (p ? { code: p.code } : undefined) },
        { key: "code", required: true, createOnly: true }, { key: "name", required: true }, { key: "nameEn" },
        { key: "isPostable", type: "bool", default: true, createOnly: true }, projectLookup,
        { key: "costCategory", type: "select", options: COST_CATS, showIf: (v) => v.type === "EXPENSE" || !v.type },
        { key: "isActive", type: "bool", default: true },
      ],
      toPayload: (p) => ({ ...p, costCategory: p.costCategory || null }),
      filters: [{ key: "type", type: "select", options: ACCOUNT_TYPES }],
    },
    "cost-centers": {
      resource: "cost-centers", module: "accounting", title: t("t.costCenters"),
      columns: [{ key: "code" }, { key: "name" }, { key: "project", get: (r) => code(r, "project"), label: t("f.project") }],
      form: [{ key: "code", required: true }, { key: "name", required: true }, projectLookup],
    },
    "journal-entries": {
      resource: "journal-entries", module: "journals", title: t("nav.journalEntries"), doc: true, dateFilter: true, entityType: "journalEntry",
      columns: [
        { key: "number", className: "num" }, { key: "date", type: "date" }, { key: "description" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") },
        { key: "sourceType", type: "enum", get: (r) => r.sourceType ?? "MANUAL" }, { key: "totalDebit", type: "money", total: true }, { key: "totalCredit", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [{ key: "date", type: "date", required: true, default: today }, projectLookup, { key: "description", required: true, span: 3 }],
      lines: {
        key: "lines", min: 2, totals: ["debit", "credit"],
        newLine: () => ({ debit: "", credit: "" }),
        columns: [
          { key: "accountId", type: "lookup", lookup: "accounts", lookupParams: () => ({ isPostable: "true" }), required: true },
          { key: "description" },
          { key: "debit", type: "money" }, { key: "credit", type: "money" },
          { key: "costCenterId", type: "lookup", lookup: "cost-centers" },
          { key: "projectId", type: "lookup", lookup: "projects" },
        ],
        fromRow: (r) => r.lines.map((l: AnyRow) => ({ accountId: l.accountId, description: l.description ?? "", debit: Number(l.debit) || "", credit: Number(l.credit) || "", costCenterId: l.costCenterId ?? "", projectId: l.projectId ?? "", partyType: l.partyType ?? "", partyId: l.partyId ?? "" })),
        display: [
          { key: "account", get: (l) => `${l.account?.code} - ${l.account?.name}`, label: t("f.account") }, { key: "description" },
          { key: "debit", type: "money", total: true }, { key: "credit", type: "money", total: true },
          { key: "costCenter", get: (l) => l.costCenter?.name, label: t("f.costCenter") }, { key: "project", get: (l) => l.project?.code, label: t("f.project") },
          { key: "partyType", type: "enum" },
        ],
        validate: (lines) => {
          const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
          const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
          if (lines.some((l) => (Number(l.debit) || 0) > 0 && (Number(l.credit) || 0) > 0)) return t("c.unbalanced") + " — debit & credit on one line";
          if (Math.abs(d - c) > 0.005 || d === 0) return `${t("c.unbalanced")}: ${d.toFixed(2)} ≠ ${c.toFixed(2)}`;
          return null;
        },
      },
      preview: (v) => <JournalBalance lines={v.lines ?? []} />,
      filters: [statusFilter, { key: "sourceType", type: "select", options: ["EXPENSE", "SUPPLIER_INVOICE", "PAYMENT", "CONTRACTOR_EXTRACT", "CLIENT_EXTRACT", "PAYROLL", "TREASURY", "CUSTODY", "CUSTODY_SETTLEMENT", "REVERSAL"] }],
    },
    suppliers: {
      resource: "suppliers", module: "suppliers", title: t("t.suppliers"), entityType: "supplier",
      columns: [{ key: "code" }, { key: "name" }, { key: "taxNumber" }, { key: "phone" }, { key: "paymentTermsDays", type: "number" }, { key: "totalInvoiced", type: "money", total: true }, { key: "totalPaid", type: "money", total: true }, { key: "balance", type: "money", total: true }],
      form: [
        { key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }, { key: "taxNumber" }, { key: "contactPerson" }, { key: "phone" }, { key: "email", type: "email" },
        { key: "paymentTermsDays", type: "number", default: 30 }, { key: "bankName" }, { key: "bankAccount" }, { key: "address", span: 3 },
      ],
      detail: (r) => <PartyStatement report="supplier-statement" partyId={r.id} companyId={r.companyId} />,
    },
    "supplier-invoices": {
      resource: "supplier-invoices", module: "suppliers", title: t("t.invoices"), doc: true, dateFilter: true, entityType: "supplierInvoice",
      columns: [
        { key: "number" }, { key: "supplierRef" }, { key: "date", type: "date" }, { key: "dueDate", type: "date" }, { key: "supplier.name", label: t("f.supplier") },
        { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "category", type: "enum" }, { key: "subtotal", type: "money", total: true },
        { key: "taxAmount", type: "money", total: true }, { key: "total", type: "money", total: true }, { key: "paidAmount", type: "money", total: true }, { key: "remaining", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [
        { key: "supplierId", type: "lookup", lookup: "suppliers", required: true }, { key: "supplierRef" }, projectLookup,
        { key: "purchaseOrderId", type: "lookup", lookup: "purchase-orders", lookupParams: (v) => ({ supplierId: v.supplierId }) },
        { key: "date", type: "date", required: true, default: today }, { key: "dueDate", type: "date" }, { key: "category", type: "select", options: EXPENSE_TYPES, default: "MATERIALS", required: true },
        { key: "subtotal", type: "money", required: true }, { key: "taxAmount", type: "money", default: 0 }, { key: "description", span: 3 },
      ],
      filters: [statusFilter, { key: "supplierId", type: "lookup", lookup: "suppliers" }],
    },
    contractors: {
      resource: "contractors", module: "contractors", title: t("t.contractors"), entityType: "contractor",
      columns: [
        { key: "code" }, { key: "name" }, { key: "specialty" }, { key: "phone" }, { key: "contractValue", type: "money", total: true }, { key: "executed", type: "money", total: true },
        { key: "totalNet", type: "money", total: true, label: t("f.netAmount") }, { key: "paid", type: "money", total: true }, { key: "remaining", type: "money", total: true },
      ],
      form: [{ key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }, { key: "specialty" }, { key: "taxNumber" }, { key: "contactPerson" }, { key: "phone" }, { key: "address", span: 2 }],
      detail: (r) => <PartyStatement report="contractor-statement" partyId={r.id} companyId={r.companyId} />,
    },
    subcontracts: {
      resource: "subcontracts", module: "contractors", title: t("t.subcontracts"), entityType: "subContract",
      columns: [
        { key: "number" }, { key: "contractor.name", label: t("f.contractor") }, { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "scope" },
        { key: "contractValue", type: "money", total: true }, { key: "retentionPct", type: "pct" }, { key: "taxPct", type: "pct" }, { key: "insurancePct", type: "pct" },
        { key: "executed", type: "money", total: true }, { key: "executedPct", type: "pct" }, { key: "paid", type: "money", total: true }, { key: "remaining", type: "money", total: true }, { key: "remainingWork", type: "money", total: true },
      ],
      form: [
        { key: "number", placeholder: "AUTO" }, { key: "contractorId", type: "lookup", lookup: "contractors", required: true }, { ...projectLookup, required: true },
        { key: "scope", required: true, span: 3 }, { key: "contractValue", type: "money", required: true }, { key: "retentionPct", type: "pct", default: 5, required: true },
        { key: "taxPct", type: "pct", default: 1, required: true }, { key: "insurancePct", type: "pct", default: 0, required: true }, { key: "advanceRecoveryPct", type: "pct", default: 0 },
        { key: "startDate", type: "date" }, { key: "endDate", type: "date" },
      ],
      filters: [{ key: "contractorId", type: "lookup", lookup: "contractors" }, projectLookup],
    },
    "contractor-extracts": {
      resource: "contractor-extracts", module: "contractorExtracts", title: t("nav.contractorExtracts"), doc: true, dateFilter: true, entityType: "contractorExtract",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "contractor.name", label: t("f.contractor") }, { key: "contract.number", label: t("f.contract") },
        { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "cumulativeGross", type: "money" }, { key: "previousGross", type: "money" },
        { key: "currentGross", type: "money", total: true }, { key: "retentionAmount", type: "money", total: true }, { key: "advanceRecovery", type: "money", total: true },
        { key: "taxAmount", type: "money", total: true }, { key: "insuranceAmount", type: "money", total: true }, { key: "otherDeductions", type: "money", total: true },
        { key: "netAmount", type: "money", total: true }, { key: "paidAmount", type: "money", total: true }, { key: "remaining", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [
        { key: "contractorId", type: "lookup", lookup: "contractors", required: true, createOnly: true, onPick: () => ({ contractId: "" }) },
        { key: "contractId", type: "lookup", lookup: "subcontracts", lookupParams: (v) => ({ contractorId: v.contractorId }), required: true, createOnly: true },
        { key: "date", type: "date", required: true, default: today }, { key: "periodFrom", type: "date", required: true }, { key: "periodTo", type: "date", required: true },
        { key: "cumulativeGross", type: "money", required: true }, { key: "otherDeductions", type: "money", default: 0 }, { key: "description", span: 2 },
      ],
      toForm: (r) => ({ contractorId: r.contractorId, contractId: r.contractId, date: r.date?.slice(0, 10), periodFrom: r.periodFrom?.slice(0, 10), periodTo: r.periodTo?.slice(0, 10), cumulativeGross: String(r.cumulativeGross), otherDeductions: String(r.otherDeductions), description: r.description ?? "" }),
      preview: (v, companyId, id) => <ExtractPreview kind="contractor" values={v} companyId={companyId} editingId={id} />,
      filters: [statusFilter, { key: "contractorId", type: "lookup", lookup: "contractors" }],
      modalSize: "xl",
    },
    "client-extracts": {
      resource: "client-extracts", module: "clientExtracts", title: t("nav.clientExtracts"), doc: true, dateFilter: true, entityType: "clientExtract",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "client.name", label: t("f.client") },
        { key: "cumulativeWork", type: "money" }, { key: "previousWork", type: "money" }, { key: "workValue", type: "money", total: true }, { key: "retentionAmount", type: "money", total: true },
        { key: "taxAmount", type: "money", total: true }, { key: "insuranceAmount", type: "money", total: true }, { key: "otherDeductions", type: "money", total: true },
        { key: "netAmount", type: "money", total: true }, { key: "paidAmount", type: "money", total: true }, { key: "remaining", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [
        { ...projectLookup, required: true, createOnly: true, onPick: (_v, _vals, p) => (p ? { clientId: p.clientId ?? "" } : undefined) },
        { key: "clientId", type: "lookup", lookup: "clients", createOnly: true },
        { key: "date", type: "date", required: true, default: today }, { key: "periodFrom", type: "date", required: true }, { key: "periodTo", type: "date", required: true },
        { key: "cumulativeWork", type: "money", required: true }, { key: "otherDeductions", type: "money", default: 0 }, { key: "description", span: 2 },
      ],
      toForm: (r) => ({ projectId: r.projectId, clientId: r.clientId, date: r.date?.slice(0, 10), periodFrom: r.periodFrom?.slice(0, 10), periodTo: r.periodTo?.slice(0, 10), cumulativeWork: String(r.cumulativeWork), otherDeductions: String(r.otherDeductions), description: r.description ?? "" }),
      preview: (v, companyId, id) => <ExtractPreview kind="client" values={v} companyId={companyId} editingId={id} />,
      filters: [statusFilter, projectLookup],
      modalSize: "xl",
    },
    expenses: {
      resource: "expenses", module: "expenses", title: t("t.expenses"), doc: true, dateFilter: true, entityType: "expense",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "type", type: "enum" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") },
        { key: "amount", type: "money", total: true }, { key: "paymentMethod", type: "enum" }, { key: "supplier.name", label: t("f.supplier") }, { key: "employee.name", label: t("f.employee") },
        { key: "costCenter.name", label: t("f.costCenter") }, { key: "description" }, { key: "status", type: "status" },
      ],
      form: [
        { key: "type", type: "select", options: EXPENSE_TYPES, required: true, default: "MATERIALS" }, { key: "date", type: "date", required: true, default: today },
        { key: "amount", type: "money", required: true }, projectLookup,
        { key: "paymentMethod", type: "select", options: ["CASH", "BANK", "CHEQUE", "CUSTODY", "CREDIT"], required: true, default: "CASH" },
        { key: "cashBoxId", type: "lookup", lookup: "cash-boxes", required: true, showIf: (v) => v.paymentMethod === "CASH" },
        { key: "bankAccountId", type: "lookup", lookup: "bank-accounts", required: true, showIf: (v) => v.paymentMethod === "BANK" || v.paymentMethod === "CHEQUE" },
        { key: "custodyId", type: "lookup", lookup: "custodies", required: true, showIf: (v) => v.paymentMethod === "CUSTODY", onPick: (_v, _x, p) => (p ? { employeeId: p.employeeId } : undefined) },
        { key: "supplierId", type: "lookup", lookup: "suppliers" }, { key: "employeeId", type: "lookup", lookup: "employees" },
        { key: "costCenterId", type: "lookup", lookup: "cost-centers" }, { key: "description", span: 2 },
      ],
      filters: [statusFilter, { key: "type", type: "select", options: EXPENSE_TYPES }, { key: "paymentMethod", type: "select", options: ["CASH", "BANK", "CHEQUE", "CUSTODY", "CREDIT"] }],
    },
    custodies: {
      resource: "custodies", module: "custody", title: t("t.custody"), doc: true, dateFilter: true, entityType: "custody",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "employee.name", label: t("f.employee") }, { key: "purpose" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") },
        { key: "amount", type: "money", total: true }, { key: "spent", type: "money", total: true }, { key: "returnedAmount", type: "money", total: true }, { key: "remaining", type: "money", total: true },
        { key: "settlementStatus", type: "status" }, { key: "status", type: "status" },
      ],
      form: [
        { key: "employeeId", type: "lookup", lookup: "employees", required: true }, { key: "amount", type: "money", required: true }, { key: "date", type: "date", required: true, default: today },
        { key: "cashBoxId", type: "lookup", lookup: "cash-boxes", required: true }, projectLookup, { key: "purpose", required: true, span: 3 },
      ],
      rowActions: [{ key: "settle", label: t("c.settle"), perm: "approve", tone: "success", confirm: true, show: (r) => r.status === "POSTED" && r.settlementStatus === "OPEN" }],
      detail: (r) =>
        r._extra?.expenses?.length ? (
          <div className="mt-5">
            <h4 className="mb-2 font-bold text-slate-700">{t("t.expenses")}</h4>
            <div className="rounded-lg border border-slate-200">
              <DataTable columns={[{ key: "number" }, { key: "date", type: "date" }, { key: "type", type: "enum" }, { key: "description" }, { key: "amount", type: "money", total: true }, { key: "status", type: "status" }]} rows={r._extra.expenses} totals />
            </div>
          </div>
        ) : null,
      filters: [statusFilter, { key: "settlementStatus", type: "select", options: ["OPEN", "SETTLED"] }],
    },
    payments: {
      resource: "payments", module: "payments", title: t("t.payments"), doc: true, dateFilter: true, entityType: "payment",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "type", type: "enum" }, { key: "method", type: "enum" },
        { key: "party", get: (r) => r.supplier?.name ?? r.contractor?.name ?? r.client?.name, label: t("f.party") },
        { key: "reference", get: (r) => r.supplierInvoice?.number ?? r.contractorExtract?.number ?? r.clientExtract?.number, label: t("f.reference") },
        { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "chequeNumber" }, { key: "amount", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [
        { key: "type", type: "select", options: PAYMENT_TYPES, required: true, default: "SUPPLIER_PAYMENT" }, { key: "date", type: "date", required: true, default: today },
        { key: "amount", type: "money", required: true },
        { key: "method", type: "select", options: ["CASH", "BANK", "CHEQUE"], required: true, default: "BANK" },
        { key: "cashBoxId", type: "lookup", lookup: "cash-boxes", required: true, showIf: (v) => v.method === "CASH" },
        { key: "bankAccountId", type: "lookup", lookup: "bank-accounts", required: true, showIf: (v) => v.method === "BANK" || v.method === "CHEQUE" },
        { key: "chequeNumber", showIf: (v) => v.method === "CHEQUE", required: true }, { key: "chequeDueDate", type: "date", showIf: (v) => v.method === "CHEQUE" },
        { key: "supplierId", type: "lookup", lookup: "suppliers", required: true, showIf: (v) => v.type === "SUPPLIER_PAYMENT" },
        { key: "supplierInvoiceId", type: "lookup", lookup: "supplier-invoices", lookupParams: (v) => ({ supplierId: v.supplierId }), showIf: (v) => v.type === "SUPPLIER_PAYMENT" },
        { key: "contractorId", type: "lookup", lookup: "contractors", required: true, showIf: (v) => v.type === "CONTRACTOR_PAYMENT" || v.type === "CONTRACTOR_ADVANCE" },
        { key: "contractorExtractId", type: "lookup", lookup: "contractor-extracts", lookupParams: (v) => ({ contractorId: v.contractorId }), showIf: (v) => v.type === "CONTRACTOR_PAYMENT" },
        { key: "clientId", type: "lookup", lookup: "clients", required: true, showIf: (v) => v.type === "CLIENT_RECEIPT" },
        { key: "clientExtractId", type: "lookup", lookup: "client-extracts", lookupParams: (v) => ({ clientId: v.clientId }), showIf: (v) => v.type === "CLIENT_RECEIPT" },
        projectLookup, { key: "description", span: 2 },
      ],
      filters: [statusFilter, { key: "type", type: "select", options: PAYMENT_TYPES }, { key: "method", type: "select", options: ["CASH", "BANK", "CHEQUE"] }],
    },
    "cash-boxes": {
      resource: "cash-boxes", module: "treasury", title: t("t.cashboxes"),
      columns: [{ key: "code" }, { key: "name" }, { key: "keeper" }, { key: "account", get: (r) => r.account?.code, label: t("f.account") }, { key: "balance", type: "money", total: true }],
      form: [{ key: "code", placeholder: "AUTO", createOnly: true }, { key: "name", required: true }, { key: "keeper" }],
    },
    "bank-accounts": {
      resource: "bank-accounts", module: "banks", title: t("t.bankAccounts"),
      columns: [{ key: "code" }, { key: "bankName" }, { key: "branch" }, { key: "accountNumber" }, { key: "iban" }, { key: "currency" }, { key: "account", get: (r) => r.account?.code, label: t("f.account") }, { key: "balance", type: "money", total: true }],
      form: [{ key: "code", placeholder: "AUTO", createOnly: true }, { key: "bankName", required: true }, { key: "branch" }, { key: "accountNumber", required: true }, { key: "iban" }, { key: "currency", default: "EGP", createOnly: true }],
    },
    "treasury-transactions": {
      resource: "treasury-transactions", module: "treasury", title: t("t.transactions"), doc: true, dateFilter: true, entityType: "treasuryTransaction",
      columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "kind", type: "enum" }, { key: "description" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "amount", type: "money", total: true }, { key: "status", type: "status" }],
      form: [
        { key: "kind", type: "select", options: TREASURY_KINDS, required: true, default: "CASH_RECEIPT" }, { key: "date", type: "date", required: true, default: today }, { key: "amount", type: "money", required: true },
        { key: "cashBoxId", type: "lookup", lookup: "cash-boxes", required: true, showIf: (v) => String(v.kind).startsWith("CASH") || v.kind === "BANK_DEPOSIT" || v.kind === "BANK_WITHDRAWAL" },
        { key: "toCashBoxId", type: "lookup", lookup: "cash-boxes", required: true, showIf: (v) => v.kind === "CASH_TRANSFER" },
        { key: "bankAccountId", type: "lookup", lookup: "bank-accounts", required: true, showIf: (v) => String(v.kind).startsWith("BANK") },
        { key: "toBankAccountId", type: "lookup", lookup: "bank-accounts", required: true, showIf: (v) => v.kind === "BANK_TRANSFER" },
        { key: "counterAccountId", type: "lookup", lookup: "accounts", lookupParams: () => ({ isPostable: "true" }), required: true, showIf: (v) => ["CASH_RECEIPT", "CASH_PAYMENT", "BANK_RECEIPT", "BANK_PAYMENT"].includes(v.kind) },
        projectLookup, { key: "description", span: 2 },
      ],
      filters: [statusFilter, { key: "kind", type: "select", options: TREASURY_KINDS }],
    },
    cheques: {
      resource: "cheques", module: "banks", title: t("t.cheques"), dateFilter: true,
      columns: [{ key: "number" }, { key: "type", type: "enum" }, { key: "bankAccount.bankName", label: t("f.bankName") }, { key: "partyName" }, { key: "issueDate", type: "date" }, { key: "dueDate", type: "date" }, { key: "amount", type: "money", total: true }, { key: "status", type: "status" }, { key: "paymentId", type: "bool", label: t("f.reference"), get: (r) => !!r.paymentId }],
      form: [
        { key: "number", required: true, createOnly: true }, { key: "type", type: "select", options: ["ISSUED", "RECEIVED"], required: true, default: "ISSUED", createOnly: true },
        { key: "bankAccountId", type: "lookup", lookup: "bank-accounts", required: true, createOnly: true }, { key: "amount", type: "money", required: true, createOnly: true },
        { key: "issueDate", type: "date", required: true, default: today, createOnly: true }, { key: "dueDate", type: "date", required: true }, { key: "partyName", required: true, createOnly: true },
        { key: "status", type: "select", options: ["PENDING", "CLEARED", "BOUNCED", "CANCELLED"], editOnly: true, required: true }, { key: "notes", span: 3 },
      ],
      filters: [{ key: "status", type: "select", options: ["PENDING", "CLEARED", "BOUNCED", "CANCELLED"] }, { key: "type", type: "select", options: ["ISSUED", "RECEIVED"] }],
    },
    "purchase-requests": {
      resource: "purchase-requests", module: "procurement", title: t("t.requests"), dateFilter: true, entityType: "purchaseRequest",
      columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "requestedBy" }, { key: "notes" }, { key: "quotations", get: (r) => r._count?.quotations, type: "number", label: t("t.quotations") }, { key: "orders", get: (r) => r._count?.orders, type: "number", label: t("t.orders") }, { key: "status", type: "status" }],
      form: [projectLookup, { key: "date", type: "date", required: true, default: today }, { key: "requestedBy" }, { key: "notes", span: 3 }],
      lines: {
        key: "items", label: t("f.items"),
        columns: [{ key: "description", required: true }, { key: "unit" }, { key: "quantity", type: "number", required: true }],
        display: [{ key: "description" }, { key: "unit" }, { key: "quantity", type: "number" }],
      },
      editable: (r) => ["DRAFT", "SUBMITTED"].includes(r.status),
      rowActions: [
        { key: "submit", label: t("c.submit"), perm: "create", tone: "primary", show: (r) => r.status === "DRAFT" },
        { key: "close", label: t("c.close_pr"), perm: "edit", show: (r) => !["CLOSED", "CANCELLED"].includes(r.status), confirm: true },
        { key: "cancel", label: t("c.cancelDoc"), perm: "edit", show: (r) => !["ORDERED", "CLOSED", "CANCELLED"].includes(r.status), confirm: true },
      ],
      detail: (r) => <ProcurementComparison requestId={r.id} key={r.id} />,
      filters: [{ key: "status", type: "select", options: ["DRAFT", "SUBMITTED", "QUOTING", "ORDERED", "CLOSED", "CANCELLED"] }],
    },
    quotations: {
      resource: "quotations", module: "procurement", title: t("t.quotations"), dateFilter: true, entityType: "quotation",
      columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "request.number", label: t("f.request") }, { key: "supplier.name", label: t("f.supplier") }, { key: "deliveryDays", type: "number" }, { key: "validUntil", type: "date" }, { key: "total", type: "money" }, { key: "selected", type: "bool" }],
      form: [
        { key: "requestId", type: "lookup", lookup: "purchase-requests", required: true, createOnly: true }, { key: "supplierId", type: "lookup", lookup: "suppliers", required: true },
        { key: "date", type: "date", required: true, default: today }, { key: "validUntil", type: "date" }, { key: "deliveryDays", type: "number" }, { key: "notes", span: 3 },
      ],
      lines: {
        key: "items", label: t("f.items"), totals: [],
        columns: [{ key: "description", required: true }, { key: "quantity", type: "number", required: true }, { key: "unitPrice", type: "money", required: true }],
        fromRow: (r) => r.items.map((i: AnyRow) => ({ requestItemId: i.requestItemId, description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })),
        display: [{ key: "description" }, { key: "quantity", type: "number" }, { key: "unitPrice", type: "money" }, { key: "total", type: "money", total: true }],
      },
      rowActions: [
        { key: "select", label: t("c.select"), perm: "edit", show: (r) => !r.selected },
        { key: "create-order", label: t("c.createOrder"), perm: "create", tone: "success", confirm: true },
      ],
      filters: [{ key: "requestId", type: "lookup", lookup: "purchase-requests" }, { key: "supplierId", type: "lookup", lookup: "suppliers" }],
    },
    "purchase-orders": {
      resource: "purchase-orders", module: "procurement", title: t("t.orders"), doc: true, dateFilter: true, entityType: "purchaseOrder",
      columns: [
        { key: "number" }, { key: "date", type: "date" }, { key: "supplier.name", label: t("f.supplier") }, { key: "project", get: (r) => r.project?.code, label: t("f.project") },
        { key: "request.number", label: t("f.request") }, { key: "subtotal", type: "money", total: true }, { key: "taxAmount", type: "money", total: true }, { key: "total", type: "money", total: true },
        { key: "received", type: "bool" }, { key: "status", type: "status" },
      ],
      form: [
        { key: "supplierId", type: "lookup", lookup: "suppliers", required: true }, projectLookup, { key: "requestId", type: "lookup", lookup: "purchase-requests", createOnly: true },
        { key: "date", type: "date", required: true, default: today }, { key: "taxPct", type: "pct", default: 14, label: `${t("f.taxAmount")} %` }, { key: "notes", span: 3 },
      ],
      lines: {
        key: "items", label: t("f.items"),
        columns: [{ key: "description", required: true }, { key: "unit" }, { key: "quantity", type: "number", required: true }, { key: "unitPrice", type: "money", required: true }],
        fromRow: (r) => r.items.map((i: AnyRow) => ({ description: i.description, unit: i.unit, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })),
        display: [{ key: "description" }, { key: "unit" }, { key: "quantity", type: "number" }, { key: "receivedQty", type: "number", label: t("f.received") }, { key: "unitPrice", type: "money" }, { key: "total", type: "money", total: true }],
      },
      filters: [statusFilter, { key: "supplierId", type: "lookup", lookup: "suppliers" }],
    },
    "goods-receipts": {
      resource: "goods-receipts", module: "procurement", title: t("t.receipts"), dateFilter: true, noCreate: true, noEdit: true, entityType: "goodsReceipt",
      columns: [{ key: "number" }, { key: "date", type: "date" }, { key: "order.number", label: t("f.order") }, { key: "supplier", get: (r) => r.order?.supplier?.name, label: t("f.supplier") }, { key: "notes" }],
      lines: { key: "items", columns: [], display: [{ key: "description" }, { key: "quantity", type: "number" }] },
    },
    departments: {
      resource: "departments", module: "hr", title: t("t.departments"),
      columns: [{ key: "code" }, { key: "name" }, { key: "employees", get: (r) => r._count?.employees, type: "number", label: t("f.employees") }],
      form: [{ key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }],
    },
    positions: {
      resource: "positions", module: "hr", title: t("t.positions"),
      columns: [{ key: "code" }, { key: "name" }, { key: "employees", get: (r) => r._count?.employees, type: "number", label: t("f.employees") }],
      form: [{ key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }],
    },
    employees: {
      resource: "employees", module: "hr", title: t("t.employees"), entityType: "employee",
      columns: [
        { key: "code" }, { key: "name" }, { key: "department.name", label: t("f.department") }, { key: "position.name", label: t("f.position") },
        { key: "project", get: (r) => r.project?.code, label: t("f.project") }, { key: "hireDate", type: "date" }, { key: "basicSalary", type: "money", total: true },
        { key: "allowances", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [
        { key: "code", placeholder: "AUTO" }, { key: "name", required: true, span: 2 }, { key: "nationalId" }, { key: "phone" }, { key: "email", type: "email" },
        { key: "departmentId", type: "lookup", lookup: "departments" }, { key: "positionId", type: "lookup", lookup: "positions" }, projectLookup,
        { key: "hireDate", type: "date" }, { key: "basicSalary", type: "money", required: true }, { key: "allowances", type: "money", default: 0 },
        { key: "insuranceSalary", type: "money" }, { key: "bankAccount" }, { key: "status", type: "select", options: ["ACTIVE", "ON_LEAVE", "TERMINATED"], default: "ACTIVE", required: true },
      ],
      detail: (r) =>
        r.allocations?.length ? (
          <div className="mt-5">
            <h4 className="mb-2 font-bold text-slate-700">{t("t.allocations")}</h4>
            <div className="rounded-lg border border-slate-200"><DataTable columns={[{ key: "project", get: (a) => code(a, "project"), label: t("f.project") }, { key: "percent", type: "pct" }]} rows={r.allocations} /></div>
          </div>
        ) : null,
      filters: [{ key: "status", type: "select", options: ["ACTIVE", "ON_LEAVE", "TERMINATED"] }, { key: "departmentId", type: "lookup", lookup: "departments" }, projectLookup],
    },
    "employee-allocations": {
      resource: "employee-allocations", module: "hr", title: t("t.allocations"),
      columns: [{ key: "employee", get: (r) => code(r, "employee"), label: t("f.employee") }, { key: "project", get: (r) => code(r, "project"), label: t("f.project") }, { key: "percent", type: "pct" }],
      form: [{ key: "employeeId", type: "lookup", lookup: "employees", required: true, createOnly: true }, { ...projectLookup, required: true, createOnly: true }, { key: "percent", type: "pct", required: true }],
      filters: [{ key: "employeeId", type: "lookup", lookup: "employees" }, projectLookup],
    },
    "employee-contracts": {
      resource: "employee-contracts", module: "hr", title: t("t.contracts"), entityType: "employeeContract",
      columns: [{ key: "employee", get: (r) => code(r, "employee"), label: t("f.employee") }, { key: "type", type: "enum" }, { key: "startDate", type: "date" }, { key: "endDate", type: "date" }, { key: "salary", type: "money" }, { key: "notes" }],
      form: [
        { key: "employeeId", type: "lookup", lookup: "employees", required: true, createOnly: true }, { key: "type", type: "select", options: ["FIXED_TERM", "OPEN_ENDED", "PROJECT_BASED", "PART_TIME"], default: "FIXED_TERM", required: true },
        { key: "startDate", type: "date", required: true }, { key: "endDate", type: "date" }, { key: "salary", type: "money", required: true }, { key: "notes", span: 3 },
      ],
      filters: [{ key: "employeeId", type: "lookup", lookup: "employees" }],
    },
    attendance: {
      resource: "attendance", module: "hr", title: t("t.attendance"), dateFilter: true,
      columns: [{ key: "date", type: "date" }, { key: "employee", get: (r) => code(r, "employee"), label: t("f.employee") }, { key: "status", type: "status" }, { key: "hours", type: "number", total: true }, { key: "overtimeHours", type: "number", total: true }],
      form: [
        { key: "employeeId", type: "lookup", lookup: "employees", required: true, createOnly: true }, { key: "date", type: "date", required: true, default: today, createOnly: true },
        { key: "status", type: "select", options: ["PRESENT", "ABSENT", "LATE", "LEAVE"], default: "PRESENT", required: true }, { key: "hours", type: "number", default: 8 }, { key: "overtimeHours", type: "number", default: 0 },
      ],
      filters: [{ key: "employeeId", type: "lookup", lookup: "employees" }, { key: "status", type: "select", options: ["PRESENT", "ABSENT", "LATE", "LEAVE"] }],
    },
    "leave-requests": {
      resource: "leave-requests", module: "hr", title: t("t.leaves"), dateFilter: true,
      columns: [{ key: "employee", get: (r) => code(r, "employee"), label: t("f.employee") }, { key: "type", type: "enum" }, { key: "fromDate", type: "date" }, { key: "toDate", type: "date" }, { key: "days", type: "number", total: true }, { key: "reason" }, { key: "status", type: "status" }],
      form: [
        { key: "employeeId", type: "lookup", lookup: "employees", required: true, createOnly: true }, { key: "type", type: "select", options: ["ANNUAL", "SICK", "UNPAID", "EMERGENCY"], default: "ANNUAL", required: true },
        { key: "fromDate", type: "date", required: true }, { key: "toDate", type: "date", required: true }, { key: "reason", span: 2 },
      ],
      editable: (r) => r.status === "PENDING",
      rowActions: [
        { key: "approve", label: t("c.approve"), perm: "approve", tone: "success", show: (r) => r.status === "PENDING" },
        { key: "reject", label: t("c.reject"), perm: "approve", tone: "danger", show: (r) => r.status === "PENDING" },
      ],
      filters: [{ key: "status", type: "select", options: ["PENDING", "APPROVED", "REJECTED"] }, { key: "type", type: "select", options: ["ANNUAL", "SICK", "UNPAID", "EMERGENCY"] }],
    },
    "hr-adjustments": {
      resource: "hr-adjustments", module: "hr", title: t("t.adjustments"),
      columns: [{ key: "employee", get: (r) => code(r, "employee"), label: t("f.employee") }, { key: "type", type: "enum" }, { key: "month" }, { key: "amount", type: "money", total: true }, { key: "reason" }],
      form: [
        { key: "employeeId", type: "lookup", lookup: "employees", required: true, createOnly: true }, { key: "type", type: "select", options: ["OVERTIME", "BONUS", "DEDUCTION"], default: "BONUS", required: true },
        { key: "month", type: "month", required: true, default: thisMonth }, { key: "amount", type: "money", required: true }, { key: "reason", span: 2 },
      ],
      filters: [{ key: "employeeId", type: "lookup", lookup: "employees" }, { key: "type", type: "select", options: ["OVERTIME", "BONUS", "DEDUCTION"] }],
    },
    payrolls: {
      resource: "payrolls", module: "payroll", title: t("t.payrolls"), doc: true, noEdit: true, entityType: "payroll",
      columns: [
        { key: "number" }, { key: "month" }, { key: "project", get: (r) => (r.project ? code(r, "project") : t("c.allCompanies")), label: t("f.project") },
        { key: "lines", get: (r) => r._count?.lines, type: "number", label: t("f.employees") }, { key: "totalGross", type: "money", total: true },
        { key: "totalDeductions", type: "money", total: true }, { key: "totalNet", type: "money", total: true }, { key: "status", type: "status" },
      ],
      form: [{ key: "month", type: "month", required: true, default: thisMonth }, projectLookup],
      rowActions: [{ key: "recalculate", label: t("c.recalculate"), perm: "edit", show: (r) => r.status === "DRAFT" }],
      detail: (r) => (r.lines ? <PayrollLines row={r} t={t} /> : null),
      filters: [statusFilter],
    },
  };
}

function PayrollLines({ row, t }: { row: AnyRow; t: T }) {
  const { rows: projects } = useLookup("projects", { companyId: row.companyId });
  const pc = new Map(projects.map((p) => [p.id, p.code]));
  return (
    <div className="mt-5">
      <h4 className="mb-2 font-bold text-slate-700">{t("f.lines")}</h4>
      <div className="rounded-lg border border-slate-200">
        <DataTable
          dense
          rows={row.lines}
          totals
          columns={[
            { key: "employeeName" },
            ...["basic", "allowances", "overtime", "bonuses", "gross", "deductions", "insurance", "tax", "net", "companyInsurance"].map((k) => ({ key: k, type: "money" as const, total: true })),
            { key: "allocations", label: t("f.allocations"), get: (l) => (Array.isArray(l.allocations) ? l.allocations.map((a: AnyRow) => `${pc.get(a.projectId) ?? "-"} ${a.percent}%`).join("، ") : "") },
          ]}
        />
      </div>
    </div>
  );
}

export function useCfg(name: string): ResourceConfig {
  const { t, lang } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildConfigs(t)[name], [lang, name]);
}
