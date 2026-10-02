"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Lock, LockOpen, AlertTriangle } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge, Empty, ErrorBox, Loading, Modal, toast } from "@/components/ui";
import { api, qs } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Checklist({ periodId, onChanged }: { periodId: string; onChanged: () => void }) {
  const { t, lang, can } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get(`/api/accounting-periods/${periodId}`).then(setData).catch((e) => setError(e.message));
  }, [periodId]);
  useEffect(load, [load]);
  const run = async (action: string, body: any = {}) => {
    setBusy(true);
    try {
      await api.post(`/api/accounting-periods/${periodId}/${action}`, body);
      toast(t("c.saved"));
      load();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const items: any[] = data._extra.checklist;
  const closed = data.status === "CLOSED";
  const detail = (i: any) => {
    if (i.key === "unposted_documents" && i.detail) return Object.entries(i.detail).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}: ${n}`).join(" · ");
    if (i.key === "trial_balance" && i.detail) return `${i.detail.debit} / ${i.detail.credit}`;
    if (i.key === "bank_reconciled" && Array.isArray(i.detail) && i.detail.length) return i.detail.join(" · ");
    if (i.key === "cheques_due" && i.detail?.count) return String(i.detail.count);
    if (i.key === "previous_closed" && i.detail) return i.detail;
    if (i.kind === "manual" && i.by) return `${i.by} — ${fmtDate(i.at)}`;
    return "";
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge value={data.status} />
        {closed && data.closedAt && <span className="text-slate-500">{t("x.closedBy")}: {fmtDate(data.closedAt)}</span>}
        {data.reopenReason && <span className="text-amber-700">{t("x.reopened")}: {data.reopenReason}</span>}
        {!closed && <span className={data._extra.canClose ? "text-emerald-700" : "text-rose-700"}>{data._extra.canClose ? t("x.canClose") : t("x.cannotClose")}</span>}
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 p-3">
            {i.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : i.blocking ? <Circle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">{lang === "ar" ? i.ar : i.en}</div>
              <div className="text-xs text-slate-500">
                {t(i.kind === "auto" ? "x.auto" : "x.manual")} · {t(i.blocking ? "x.blocking" : "x.warning")}
                {detail(i) && <span className="ms-2 text-slate-600">{detail(i)}</span>}
              </div>
            </div>
            {i.kind === "manual" && !closed && can("periods", "edit") && (
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("checklist", { key: i.key, done: !i.ok })}>
                {i.ok ? t("x.undo") : t("x.markDone")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {can("periods", "approve") && (
        <div className="flex justify-end gap-2">
          {!closed ? (
            <button className="btn btn-primary" disabled={busy || !data._extra.canClose} onClick={() => run("close")}>
              <Lock className="h-4 w-4" /> {t("x.closePeriod")}
            </button>
          ) : (
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(t("x.reasonPrompt"));
                if (reason) run("reopen", { reason });
              }}
            >
              <LockOpen className="h-4 w-4" /> {t("x.reopenPeriod")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PeriodsManager() {
  const { t, lang, companyId, can, companyName } = useApp();
  const [years, setYears] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear() + 1));
  const [startMonth, setStartMonth] = useState("1");
  const load = useCallback(() => {
    if (!companyId) return;
    api.get(`/api/fiscal-years${qs({ companyId, pageSize: 50 })}`).then((d) => setYears(d.items)).catch((e) => setError(e.message));
  }, [companyId]);
  useEffect(load, [load]);
  if (!companyId) return <Empty text={t("x.selectCompany")} />;
  const fyAction = async (id: string, action: "close" | "reopen") => {
    let body: any = {};
    if (action === "reopen") {
      const reason = window.prompt(t("x.reasonPrompt"));
      if (!reason) return;
      body = { reason };
    } else if (!window.confirm(t("x.closeYear") + "?")) return;
    try {
      await api.post(`/api/fiscal-years/${id}/${action}`, body);
      toast(t("c.saved"));
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const createYear = async () => {
    try {
      await api.post("/api/fiscal-years", { companyId, year: Number(newYear), startMonth: Number(startMonth) });
      toast(t("c.saved"));
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const M = lang === "ar" ? MONTHS_AR : MONTHS_EN;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="me-auto text-sm text-slate-600">
          <div className="font-semibold text-slate-800">{companyName(companyId)}</div>
          {t("x.periodsHint")}
        </div>
        {can("periods", "create") && (
          <>
            <label className="block"><span className="label">{t("x.year")}</span><input className="input num w-28" type="number" value={newYear} onChange={(e) => setNewYear(e.target.value)} /></label>
            <label className="block">
              <span className="label">{t("x.startMonth")}</span>
              <select className="input" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
                {M.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" onClick={createYear}>{t("x.newFiscalYear")}</button>
          </>
        )}
      </div>
      <ErrorBox error={error} />
      {!years && !error && <Loading />}
      {years?.length === 0 && <Empty />}
      {years?.map((fy) => (
        <div key={fy.id} className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{t("x.fiscalYears")}: {fy.name}</h3>
            <Badge value={fy.status} />
            <span className="text-xs text-slate-500">{fmtDate(fy.startDate)} → {fmtDate(fy.endDate)}</span>
            {fy.closingEntry && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {t("x.closingEntry")}: <span className="num">{fy.closingEntry.number}</span>
              </span>
            )}
            {!fy.closingEntry && (fy.closingHistory?.length ?? 0) > 0 && <span className="text-xs text-amber-700">{t("x.closingReversed")} ({fy.closingHistory.length})</span>}
            {can("periods", "approve") && (
              <span className="ms-auto">
                {fy.status === "OPEN" ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => fyAction(fy.id, "close")}><Lock className="h-3.5 w-3.5" /> {t("x.closeYear")}</button>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => fyAction(fy.id, "reopen")}><LockOpen className="h-3.5 w-3.5" /> {t("x.reopenYear")}</button>
                )}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {fy.periods.map((p: any) => (
              <button
                key={p.id}
                onClick={() => setOpen(p)}
                className={`rounded-lg border p-3 text-start transition hover:shadow ${p.status === "CLOSED" ? "border-slate-300 bg-slate-50" : "border-emerald-200 bg-emerald-50/40"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{M[p.month - 1]} {p.year}</span>
                  {p.status === "CLOSED" ? <Lock className="h-4 w-4 text-slate-500" /> : <LockOpen className="h-4 w-4 text-emerald-600" />}
                </div>
                <div className="mt-1"><Badge value={p.status} /></div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${t("x.checklist")} — ${M[open.month - 1]} ${open.year}` : ""} size="lg">
        {open && <Checklist periodId={open.id} onChanged={load} />}
      </Modal>
    </div>
  );
}
