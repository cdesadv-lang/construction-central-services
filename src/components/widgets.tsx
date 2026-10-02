"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { useApp } from "./app-provider";
import { Empty, ErrorBox, Loading, Money } from "./ui";
import { api, qs } from "@/lib/client/api";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/client/format";
import type { AnyRow } from "./resource/types";

export interface ReportCol { key: string; type?: "text" | "money" | "date" | "pct" | "number" }
export interface ReportData { report: string; columns: ReportCol[]; rows: AnyRow[]; totals?: AnyRow; meta?: AnyRow; sections?: { key: string; columns: ReportCol[]; rows: AnyRow[]; totals?: AnyRow }[] }

const SECTION_LABEL: Record<string, string> = { revenue: "r.revenue", expenses: "e.EXPENSE", assets: "r.assets", liabilities: "r.liabilities", equity: "r.equity" };

function ReportCell({ c, v }: { c: ReportCol; v: unknown }) {
  const { t } = useApp();
  if (v === undefined || v === null || v === "") return null;
  if (c.type === "money") return <Money value={v} colored={false} />;
  if (c.type === "date") return <span className="num">{fmtDate(v)}</span>;
  if (c.type === "pct") return <span className="num">{fmtNum(v)}%</span>;
  if (c.type === "number") return <span className="num">{fmtNum(v)}</span>;
  if (typeof v === "boolean") return <>{v ? t("c.yes") : t("c.no")}</>;
  const s = String(v);
  return <>{/^[A-Z][A-Z_]+$/.test(s) ? t("e." + s, s) : s}</>;
}

export function ReportTable({ columns, rows, totals }: { columns: ReportCol[]; rows: AnyRow[]; totals?: AnyRow }) {
  const { t } = useApp();
  if (!rows.length && !totals) return <Empty />;
  const right = (c: ReportCol) => c.type === "money" || c.type === "pct" || c.type === "number";
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={clsx(right(c) && "text-end")}>{t("f." + c.key, c.key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={clsx(r._bold && "font-bold bg-slate-50")}>
              {columns.map((c) => (
                <td key={c.key} className={clsx(right(c) && "text-end", c.key === "code" && "num")} style={c.key === "name" && r.level ? { paddingInlineStart: 12 + Number(r.level) * 14 } : undefined}>
                  <ReportCell c={c} v={r[c.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={clsx(right(c) && "text-end")}>
                  {totals[c.key] !== undefined ? <ReportCell c={c} v={totals[c.key]} /> : i === 0 ? t("c.total") : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function ReportView({ data }: { data: ReportData }) {
  const { t } = useApp();
  return (
    <div className="space-y-4">
      {data.sections?.length ? (
        data.sections.map((s) => (
          <div key={s.key}>
            <h3 className="mb-1 px-3 pt-3 font-bold text-brand-700">{t(SECTION_LABEL[s.key] ?? "f." + s.key, s.key)}</h3>
            <ReportTable columns={s.columns} rows={s.rows} totals={s.totals} />
          </div>
        ))
      ) : (
        <ReportTable columns={data.columns} rows={data.rows} totals={data.totals} />
      )}
      {data.sections?.length && data.totals ? (
        <div className="mx-3 mb-3 rounded-lg bg-brand-50 p-3">
          <ReportTable columns={data.columns} rows={[]} totals={data.totals} />
        </div>
      ) : null}
      {data.meta && Object.keys(data.meta).length > 0 && (
        <div className="flex flex-wrap gap-3 px-3 pb-3 text-xs text-slate-500">
          {Object.entries(data.meta).map(([k, v]) => (
            <span key={k} className="rounded bg-slate-100 px-2 py-1">
              {t("f." + k, k)}: <b className="num">{typeof v === "number" ? fmtMoney(v) : typeof v === "boolean" ? (v ? "✓" : "✗") : String(v ?? "")}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Loads a report from /api/reports/{name} with the given params. */
export function useReport(name: string | null, params: AnyRow) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = name ? `/api/reports/${name}${qs(params)}` : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api.get<ReportData>(key).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [key]);
  return { data, error, loading, url: key };
}

export function ReportBlock({ report, params, title }: { report: string; params: AnyRow; title?: string }) {
  const { t, can } = useApp();
  const { data, error, loading, url } = useReport(can("reports") ? report : null, params);
  if (!can("reports")) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-bold text-slate-700">{title ?? t("r." + report)}</h4>
        {url && <a className="btn btn-secondary btn-sm" href={url + (url.includes("?") ? "&" : "?") + "format=csv"}>{t("c.exportCsv")}</a>}
      </div>
      <ErrorBox error={error} />
      {loading ? <Loading /> : data && <div className="rounded-lg border border-slate-200"><ReportView data={data} /></div>}
    </div>
  );
}

export function PartyStatement({ report, partyId, companyId }: { report: string; partyId: string; companyId: string }) {
  const { t } = useApp();
  return <ReportBlock report={report} params={{ partyId, companyId }} title={t("c.statement")} />;
}

export function ExtractPreview({ kind, values, companyId, editingId }: { kind: "contractor" | "client"; values: AnyRow; companyId: string; editingId?: string }) {
  const { t } = useApp();
  const [calc, setCalc] = useState<AnyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cumulative = kind === "contractor" ? values.cumulativeGross : values.cumulativeWork;
  const ref = kind === "contractor" ? values.contractId : values.projectId;
  useEffect(() => {
    if (!companyId || !ref || cumulative === undefined || cumulative === "") { setCalc(null); return; }
    const h = window.setTimeout(() => {
      api
        .post("/api/extracts/preview", { kind, companyId, contractId: kind === "contractor" ? ref : undefined, projectId: kind === "client" ? ref : undefined, cumulative, otherDeductions: values.otherDeductions || 0, excludeId: editingId })
        .then((c) => { setCalc(c); setError(null); })
        .catch((e) => { setCalc(null); setError(e.message); });
    }, 300);
    return () => window.clearTimeout(h);
  }, [kind, companyId, ref, cumulative, values.otherDeductions, editingId]);
  if (error) return <div className="mt-4"><ErrorBox error={error} /></div>;
  if (!calc) return null;
  const keys = kind === "contractor"
    ? ["cumulativeGross", "previousGross", "currentGross", "retentionAmount", "advanceRecovery", "taxAmount", "insuranceAmount", "otherDeductions", "netAmount"]
    : ["cumulativeWork", "previousWork", "workValue", "retentionAmount", "taxAmount", "insuranceAmount", "otherDeductions", "netAmount"];
  return (
    <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
      <div className="mb-2 text-sm font-bold text-brand-700">{t("c.preview")}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {keys.map((k) => (
          <div key={k} className={clsx("rounded-lg bg-white p-2", k === "netAmount" && "ring-2 ring-emerald-400")}>
            <div className="text-[11px] text-slate-500">{t("f." + k)}</div>
            <div className="num font-bold">{fmtMoney(calc[k] ?? (k === "cumulativeGross" || k === "cumulativeWork" ? cumulative : 0))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function JournalBalance({ lines }: { lines: AnyRow[] }) {
  const { t } = useApp();
  const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const ok = Math.abs(d - c) < 0.005 && d > 0;
  return (
    <div className={clsx("mt-3 flex flex-wrap items-center gap-4 rounded-lg px-4 py-2 text-sm font-semibold", ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
      <span>{ok ? t("c.balanced") : t("c.unbalanced")}</span>
      <span>{t("f.totalDebit")}: <span className="num">{fmtMoney(d)}</span></span>
      <span>{t("f.totalCredit")}: <span className="num">{fmtMoney(c)}</span></span>
      <span>{t("f.difference")}: <span className="num">{fmtMoney(d - c)}</span></span>
    </div>
  );
}
