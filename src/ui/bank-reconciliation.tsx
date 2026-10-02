"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, Money, Stat, toast } from "@/components/ui";
import { LookupSelect } from "@/components/resource/lookup";
import { DataTable } from "@/components/resource/table";
import { api, qs } from "@/lib/client/api";
import { fmtDate, today } from "@/lib/client/format";

export function BankReconciliation() {
  const { t, companyId, can } = useApp();
  const [bank, setBank] = useState("");
  const [date, setDate] = useState(today());
  const [stmt, setStmt] = useState("");
  const [notes, setNotes] = useState("");
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    if (!bank) return;
    setData(null);
    api.get(`/api/bank-reconciliation${qs({ bankAccountId: bank, statementDate: date })}`).then((d) => { setData(d); setSel(new Set()); setError(null); }).catch((e) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bank, date]);
  const selected = data ? data.uncleared.filter((l: any) => sel.has(l.id)) : [];
  const selNet = selected.reduce((s: number, l: any) => s + l.debit - l.credit, 0);
  const cleared = (data?.clearedBalance ?? 0) + selNet;
  const diff = Number(stmt || 0) - cleared;
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/api/bank-reconciliation", { bankAccountId: bank, statementDate: date, statementBalance: Number(stmt || 0), lineIds: [...sel], notes });
      toast(t("c.saved"));
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
        <label className="block"><span className="label">{t("f.bankAccountId")}</span><LookupSelect entity="bank-accounts" params={{ companyId }} value={bank} onChange={setBank} /></label>
        <label className="block"><span className="label">{t("f.statementDate")}</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className="label">{t("f.statementBalance")}</span><input type="number" step="0.01" className="input num" value={stmt} onChange={(e) => setStmt(e.target.value)} /></label>
        <label className="block"><span className="label">{t("f.notes")}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      {bank && !data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Stat label={t("f.bookBalance")} value={data.bookBalance} />
            <Stat label={t("f.clearedBalance")} value={cleared} tone="green" />
            <Stat label={t("f.statementBalance")} value={Number(stmt || 0)} tone="slate" />
            <Stat label={t("f.difference")} value={diff} tone={Math.abs(diff) < 0.01 ? "green" : "red"} />
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <h3 className="font-bold text-slate-700">{t("c.uncleared")} ({data.uncleared.length})</h3>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => setSel(new Set(data.uncleared.map((l: any) => l.id)))}>{t("c.markReconciled")} ({t("c.all")})</button>
                {can("banks", "create") && <button className="btn btn-primary btn-sm" disabled={busy || !stmt} onClick={save}>{t("c.reconcile")}</button>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th /><th>{t("f.date")}</th><th>{t("f.entryNumber")}</th><th>{t("f.description")}</th><th className="text-end">{t("f.debit")}</th><th className="text-end">{t("f.credit")}</th></tr></thead>
                <tbody>
                  {data.uncleared.map((l: any) => (
                    <tr key={l.id} className="cursor-pointer" onClick={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                      <td><input type="checkbox" readOnly checked={sel.has(l.id)} /></td>
                      <td className="num">{fmtDate(l.date)}</td><td className="num">{l.entryNumber}</td><td>{l.description}</td>
                      <td className="text-end">{l.debit ? <Money value={l.debit} /> : ""}</td><td className="text-end">{l.credit ? <Money value={l.credit} /> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card p-3">
            <h3 className="mb-2 font-bold text-slate-700">{t("c.history")}</h3>
            <DataTable columns={[{ key: "statementDate", type: "date" }, { key: "statementBalance", type: "money" }, { key: "bookBalance", type: "money" }, { key: "clearedBalance", type: "money" }, { key: "difference", type: "money" }, { key: "notes" }]} rows={data.history} />
          </div>
        </>
      )}
    </div>
  );
}
