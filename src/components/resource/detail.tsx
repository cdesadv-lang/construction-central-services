"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { Download, Paperclip, Upload } from "lucide-react";
import { useApp } from "../app-provider";
import { Badge, KeyVal, Money, toast } from "../ui";
import { api } from "@/lib/client/api";
import { fmtDate, fmtDateTime } from "@/lib/client/format";
import { Cell, DataTable } from "./table";
import type { AnyRow, ResourceConfig } from "./types";

export function JournalLines({ entry }: { entry: AnyRow }) {
  const { t } = useApp();
  if (!entry) return null;
  const td = entry.lines.reduce((s: number, l: AnyRow) => s + Number(l.debit), 0);
  const tc = entry.lines.reduce((s: number, l: AnyRow) => s + Number(l.credit), 0);
  return (
    <div className="mt-5">
      <h4 className="mb-2 flex items-center gap-2 font-bold text-slate-700">
        {t("c.journalEntry")}: <span className="num">{entry.number}</span> <Badge value={entry.status} />
        <span className="text-xs font-normal text-slate-500">{fmtDate(entry.date)}</span>
      </h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table">
          <thead>
            <tr>
              <th>{t("f.account")}</th>
              <th>{t("f.description")}</th>
              <th className="text-end">{t("f.debit")}</th>
              <th className="text-end">{t("f.credit")}</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l: AnyRow) => (
              <tr key={l.id}>
                <td>
                  <span className="num text-slate-500">{l.account?.code}</span> {l.account?.name}
                </td>
                <td className="text-slate-600">{l.description}</td>
                <td className="text-end">{Number(l.debit) ? <Money value={l.debit} /> : ""}</td>
                <td className="text-end">{Number(l.credit) ? <Money value={l.credit} /> : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{t("c.total")}</td>
              <td className="text-end"><Money value={td} /></td>
              <td className="text-end"><Money value={tc} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function ApprovalHistory({ requests }: { requests: AnyRow[] }) {
  const { t, lang, dir } = useApp();
  if (!requests?.length) return null;
  return (
    <div className="mt-5">
      <h4 className="mb-2 font-bold text-slate-700">{t("c.approvalHistory")}</h4>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge value={r.status} />
              <span className="text-slate-500">{fmtDateTime(r.createdAt, lang)}</span>
              <span className="text-slate-500">
                {t("c.step")} {Math.min(r.currentStep, r.totalSteps)}/{r.totalSteps}
              </span>
              <span className="text-slate-600">{(r.steps as AnyRow[]).map((s) => t("e." + s.role)).join(dir === "rtl" ? " ← " : " → ")}</span>
            </div>
            {r.actions.map((a: AnyRow) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-1 text-sm">
                <Badge value={a.action === "APPROVE" ? "APPROVED" : a.action === "REJECT" ? "REJECTED" : a.action} />
                <span className="font-semibold">{a.user?.name}</span>
                <span className="text-xs text-slate-500">({t("e." + a.user?.role)})</span>
                <span className="text-xs text-slate-400">{fmtDateTime(a.createdAt, lang)}</span>
                {a.comment && <span className="text-slate-600">— {a.comment}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Attachments({ docs, companyId, entityType, entityId, onChange }: { docs: AnyRow[]; companyId: string; entityType: string; entityId: string; onChange: () => void }) {
  const { t, can } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("companyId", companyId);
    fd.set("entityType", entityType);
    fd.set("entityId", entityId);
    setBusy(true);
    try {
      await api.post("/api/documents", fd);
      toast(t("c.saved"));
      onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1 font-bold text-slate-700">
          <Paperclip className="h-4 w-4" /> {t("c.attachments")} ({docs?.length ?? 0})
        </h4>
        {can("documents", "create") && (
          <>
            <input ref={ref} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ref.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {t("c.upload")}
            </button>
          </>
        )}
      </div>
      {docs?.map((d) => (
        <a key={d.id} href={`/api/documents/${d.id}`} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-brand-700 hover:bg-brand-50" target="_blank" rel="noreferrer">
          <Download className="h-3.5 w-3.5" /> {d.title} <span className="text-xs text-slate-400">({Math.ceil(d.size / 1024)} KB)</span>
        </a>
      ))}
    </div>
  );
}

export function DetailBody({ cfg, row, reload }: { cfg: ResourceConfig; row: AnyRow; reload: () => void }) {
  const { t, companyName } = useApp();
  const shown = new Set<string>();
  const items: { label: string; value: React.ReactNode }[] = [];
  items.push({ label: t("f.company"), value: companyName(row.companyId) || row.company?.name });
  for (const c of cfg.columns) {
    shown.add(c.key.split(".")[0]);
    items.push({ label: c.label ?? t("f." + c.key.split(".")[0]), value: <Cell col={c} row={row} /> });
  }
  for (const f of cfg.form ?? []) {
    const base = f.key.endsWith("Id") ? f.key.slice(0, -2) : f.key;
    if (shown.has(f.key) || shown.has(base) || f.type === "password") continue;
    shown.add(f.key);
    let v: React.ReactNode = row[f.key];
    if (f.key.endsWith("Id") && row[base] && typeof row[base] === "object") v = row[base].name ?? row[base].number ?? row[base].bankName ?? row[base].code;
    else if (f.key.endsWith("Id")) continue;
    else if (f.type === "money") v = <Money value={row[f.key]} />;
    else if (f.type === "date") v = fmtDate(row[f.key]);
    else if (f.type === "select") v = row[f.key] ? t("e." + row[f.key]) : "";
    else if (f.type === "bool") v = row[f.key] ? t("c.yes") : t("c.no");
    else if (f.type === "pct") v = `${row[f.key] ?? 0}%`;
    items.push({ label: f.label ?? t("f." + f.key), value: v });
  }
  const linesRows = cfg.lines ? (row[cfg.lines.key] as AnyRow[]) : null;
  return (
    <div>
      <KeyVal items={items} />
      {cfg.lines && linesRows && (
        <div className="mt-5">
          <h4 className="mb-2 font-bold text-slate-700">{cfg.lines.label ?? t("f." + cfg.lines.key)}</h4>
          <div className="rounded-lg border border-slate-200">
            <DataTable columns={cfg.lines.display ?? cfg.lines.columns.map((c) => ({ key: c.key, type: c.type === "money" ? "money" : c.type === "lookup" ? "text" : "text" }))} rows={linesRows} totals={!!cfg.lines.display?.some((c) => c.total)} />
          </div>
        </div>
      )}
      {cfg.detail?.(row, reload)}
      {row._extra?.journalEntry && <JournalLines entry={row._extra.journalEntry} />}
      {row._extra?.approvals && <ApprovalHistory requests={row._extra.approvals} />}
      {cfg.entityType && <Attachments docs={row._extra?.documents ?? []} companyId={row.companyId} entityType={cfg.entityType} entityId={row.id} onChange={reload} />}
    </div>
  );
}
