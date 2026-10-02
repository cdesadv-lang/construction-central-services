"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { Badge, Money, toast } from "@/components/ui";
import { LookupSelect } from "@/components/resource/lookup";
import { api } from "@/lib/client/api";
import { fmtDate, today } from "@/lib/client/format";

const LABEL: Record<string, string> = { collect: "x.collect", deposit: "x.deposit", clear: "x.clear", bounce: "x.bounce", cancel: "x.cancelCheque", represent: "x.represent" };
const TONE: Record<string, string> = { clear: "btn-primary", bounce: "btn-danger", cancel: "btn-secondary", collect: "btn-secondary", deposit: "btn-secondary", represent: "btn-secondary" };

export function ChequeLifecycle({ row, reload }: { row: any; reload: () => void }) {
  const { t, can } = useApp();
  const [action, setAction] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [bank, setBank] = useState<string>(row.bankAccountId ?? "");
  const [charges, setCharges] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed: string[] = row.allowedActions ?? [];
  const needsBank = action === "collect" || action === "deposit";
  const allowsCharges = action === "clear" || action === "bounce" || action === "deposit";
  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/api/cheques/${row.id}/${action}`, { date, bankAccountId: needsBank ? bank : undefined, charges: charges ? Number(charges) : undefined, notes: notes || undefined });
      toast(t("c.saved"));
      setAction(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const entries = row._extra?.entryNumbers ?? {};
  return (
    <div className="mt-4 space-y-3">
      <h4 className="font-bold text-slate-700">{t("x.chequeLifecycle")}</h4>
      {can("banks", "approve") && allowed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allowed.map((a) => (
            <button key={a} className={`btn btn-sm ${action === a ? "btn-primary" : TONE[a]}`} onClick={() => setAction(action === a ? null : a)}>
              {t(LABEL[a])}
            </button>
          ))}
        </div>
      )}
      {action && (
        <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-4">
          <label className="block"><span className="label">{t("f.date")}</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {needsBank && (
            <label className="block"><span className="label">{t("f.bankAccountId")}</span><LookupSelect entity="bank-accounts" params={{ companyId: row.companyId }} value={bank} onChange={setBank} required /></label>
          )}
          {allowsCharges && (
            <label className="block"><span className="label">{t("x.bankCharges")}</span><input type="number" step="0.01" min={0} className="input num" value={charges} onChange={(e) => setCharges(e.target.value)} /></label>
          )}
          <label className="block"><span className="label">{t("f.notes")}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="flex items-end sm:col-span-4">
            <button className="btn btn-primary" disabled={busy || (needsBank && !bank)} onClick={run}>{t(LABEL[action])}</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table">
          <thead>
            <tr><th>{t("f.date")}</th><th>{t("x.fromStatus")}</th><th>{t("x.toStatus")}</th><th>{t("x.bankCharges")}</th><th>{t("f.journalEntry", "JE")}</th><th>{t("f.notes")}</th></tr>
          </thead>
          <tbody>
            {(row.movements ?? []).map((m: any) => (
              <tr key={m.id}>
                <td>{fmtDate(m.date)}</td>
                <td>{m.fromStatus ? <Badge value={m.fromStatus} /> : "—"}</td>
                <td><Badge value={m.toStatus} /></td>
                <td className="num">{Number(m.charges) ? <Money value={m.charges} /> : ""}</td>
                <td className="num">{m.journalEntryId ? entries[m.journalEntryId] ?? "✓" : "—"}</td>
                <td>{m.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
