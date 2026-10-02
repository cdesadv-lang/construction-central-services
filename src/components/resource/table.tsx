"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from "clsx";
import { Check } from "lucide-react";
import { useApp } from "../app-provider";
import { Badge, Empty, Money } from "../ui";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/client/format";
import type { AnyRow, ColumnDef } from "./types";

export function resolve(row: AnyRow, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row as any);
}

export function Cell({ col, row }: { col: ColumnDef; row: AnyRow }) {
  const { t, lang } = useApp();
  const v = col.get ? col.get(row) : resolve(row, col.key);
  switch (col.type) {
    case "money":
      return <Money value={v} />;
    case "date":
      return <span className="num whitespace-nowrap">{fmtDate(v)}</span>;
    case "datetime":
      return <span className="num whitespace-nowrap">{fmtDateTime(v, lang)}</span>;
    case "status":
      return <Badge value={v} />;
    case "enum":
      return <>{v ? t("e." + v, String(v)) : ""}</>;
    case "pct":
      return <span className="num">{v === null || v === undefined || v === "" ? "" : `${fmtNum(v)}%`}</span>;
    case "number":
      return <span className="num">{fmtNum(v)}</span>;
    case "bool":
      return v ? <Check className="h-4 w-4 text-emerald-600" /> : <span className="text-slate-300">—</span>;
    default:
      if (v && typeof v === "object") return <>{v.name ?? v.number ?? v.code ?? ""}</>;
      return <>{v ?? ""}</>;
  }
}

export function DataTable({ columns, rows, onRowClick, totals, actions, rowKey, dense }: {
  columns: ColumnDef[];
  rows: AnyRow[];
  onRowClick?: (r: AnyRow) => void;
  totals?: AnyRow | boolean;
  actions?: (r: AnyRow) => React.ReactNode;
  rowKey?: (r: AnyRow) => string;
  dense?: boolean;
}) {
  const { t } = useApp();
  if (!rows.length) return <Empty />;
  const computed: AnyRow | null =
    totals === true
      ? Object.fromEntries(columns.filter((c) => c.total).map((c) => [c.key, rows.reduce((s, r) => s + (Number(c.get ? c.get(r) : resolve(r, c.key)) || 0), 0)]))
      : totals || null;
  return (
    <div className="overflow-x-auto">
      <table className={clsx("table", dense && "text-xs")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={clsx((c.type === "money" || c.type === "number" || c.type === "pct") && "text-end")}>
                {c.label ?? t("f." + c.key.split(".")[0])}
              </th>
            ))}
            {actions && <th className="no-print" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : (r.id ?? i)} className={clsx(onRowClick && "cursor-pointer")} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={clsx((c.type === "money" || c.type === "number" || c.type === "pct") && "text-end", c.className)}>
                  <Cell col={c} row={r} />
                </td>
              ))}
              {actions && (
                <td className="no-print whitespace-nowrap text-end" onClick={(e) => e.stopPropagation()}>
                  {actions(r)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {computed && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={clsx((c.type === "money" || c.type === "number") && "text-end")}>
                  {i === 0 && computed[c.key] === undefined ? t("c.total") : computed[c.key] !== undefined && computed[c.key] !== null ? (c.type === "money" ? <Money value={computed[c.key]} /> : c.type === "number" ? fmtNum(computed[c.key]) : String(computed[c.key])) : ""}
                </td>
              ))}
              {actions && <td className="no-print" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
