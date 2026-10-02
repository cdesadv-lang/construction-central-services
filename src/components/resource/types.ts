/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";

export type AnyRow = Record<string, any>;
export type FieldType = "text" | "textarea" | "number" | "money" | "pct" | "date" | "month" | "select" | "lookup" | "bool" | "email" | "password";

export interface FieldDef {
  key: string;
  label?: string;
  type?: FieldType;
  required?: boolean;
  options?: readonly string[];
  lookup?: string;
  lookupParams?: (v: AnyRow) => Record<string, string | undefined | null>;
  showIf?: (v: AnyRow) => boolean;
  createOnly?: boolean;
  editOnly?: boolean;
  span?: 1 | 2 | 3;
  default?: unknown;
  /** auto-fill other fields when this one changes (receives the selected lookup row for lookups) */
  onPick?: (value: any, values: AnyRow, picked?: AnyRow) => AnyRow | void;
  placeholder?: string;
  readOnly?: boolean;
}

export type ColType = "text" | "money" | "date" | "status" | "enum" | "pct" | "bool" | "number" | "datetime";
export interface ColumnDef {
  key: string;
  label?: string;
  type?: ColType;
  get?: (r: AnyRow) => unknown;
  total?: boolean;
  className?: string;
}

export interface LinesDef {
  key: string;
  label?: string;
  columns: FieldDef[];
  min?: number;
  /** keys summed in the footer */
  totals?: string[];
  /** map a stored row's lines into editable values */
  fromRow?: (row: AnyRow) => AnyRow[];
  /** display columns in detail view */
  display?: ColumnDef[];
  validate?: (lines: AnyRow[]) => string | null;
  newLine?: () => AnyRow;
}

export interface RowAction {
  key: string;
  label: string;
  perm: "view" | "create" | "edit" | "approve" | "delete";
  show?: (row: AnyRow) => boolean;
  confirm?: boolean;
  tone?: "primary" | "secondary" | "success" | "danger" | "warning";
  /** custom handler instead of POST /api/{resource}/{id}/{key} */
  run?: (row: AnyRow) => Promise<void> | void;
}

export interface ResourceConfig {
  resource: string;
  module: string;
  title: string;
  columns: ColumnDef[];
  form?: FieldDef[];
  lines?: LinesDef;
  filters?: FieldDef[];
  doc?: boolean;
  dateFilter?: boolean;
  noCreate?: boolean;
  noEdit?: boolean;
  noDelete?: boolean;
  editable?: (row: AnyRow) => boolean;
  rowActions?: RowAction[];
  detail?: (row: AnyRow, reload: () => void) => ReactNode;
  preview?: (values: AnyRow, companyId: string, editingId?: string) => ReactNode;
  toForm?: (row: AnyRow) => AnyRow;
  toPayload?: (values: AnyRow, editing: boolean) => AnyRow;
  modalSize?: "md" | "lg" | "xl" | "full";
  pageSize?: number;
  /** extra fixed query params for listing/creating (e.g. contractorId from a parent page) */
  base?: Record<string, string>;
  entityType?: string;
  rowKey?: (r: AnyRow) => string;
  /** not tenant-scoped (e.g. companies): no companyId on create */
  global?: boolean;
}
