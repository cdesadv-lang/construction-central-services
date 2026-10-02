"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge, Empty, ErrorBox, Loading, PageHeader, Tabs, toast } from "@/components/ui";
import { api, qs } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";

export default function Approvals() {
  const { t, lang, companyId, companyName, user } = useApp();
  const [scope, setScope] = useState("mine");
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setItems(null);
    api.get(`/api/approvals${qs({ scope, companyId })}`).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, [scope, companyId]);
  useEffect(load, [load]);
  const act = async (id: string, decision: "APPROVE" | "REJECT") => {
    setBusy(true);
    try {
      await api.post(`/api/approvals/${id}`, { decision, comment: comments[id] || undefined });
      toast(t("c.done"));
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title={t("nav.approvals")} />
      <Tabs tabs={[{ key: "mine", label: t("c.pendingMine") }, { key: "all", label: t("c.allRequests") }]} value={scope} onChange={setScope} />
      <ErrorBox error={error} />
      {!items ? <Loading /> : !items.length ? <div className="card"><Empty /></div> : (
        <div className="space-y-3">
          {items.map((r) => {
            const steps = r.steps as { role: string; name: string }[];
            const mineNow = r.status === "PENDING" && (user.role === "SUPER_ADMIN" || steps[r.currentStep - 1]?.role === user.role) && r.submittedBy !== user.id;
            return (
              <div key={r.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-800">{t("e." + r.docType, r.docLabel)}</span>
                  <span className="num font-semibold text-brand-700">{r.docNumber}</span>
                  <Badge value={r.status} />
                  <span className="text-xs text-slate-500">{companyName(r.companyId) || r.company?.name}</span>
                  <span className="flex-1" />
                  <span className="text-xs text-slate-500">{t("c.submittedBy")}: {r.submittedByName} — {fmtDateTime(r.createdAt, lang)}</span>
                  {r.docLink && <Link className="btn btn-ghost btn-sm" href={r.docLink}><ExternalLink className="h-3.5 w-3.5" /> {t("c.open")}</Link>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
                  {steps.map((s, i) => (
                    <span key={i} className={`rounded-full px-2 py-1 ${i + 1 < r.currentStep || r.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : i + 1 === r.currentStep && r.status === "PENDING" ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400" : "bg-slate-100 text-slate-500"}`}>
                      {i + 1}. {t("e." + s.role)}
                    </span>
                  ))}
                </div>
                {r.actions?.length > 0 && (
                  <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {r.actions.map((a: any) => <div key={a.id}>• {a.user?.name} ({t("e." + a.user?.role)}): <b>{a.action}</b> {a.comment ? `— ${a.comment}` : ""} <span className="text-slate-400">{fmtDateTime(a.createdAt, lang)}</span></div>)}
                  </div>
                )}
                {mineNow && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <input className="input max-w-md" placeholder={t("c.comment")} value={comments[r.id] ?? ""} onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))} />
                    <button className="btn btn-success" disabled={busy} onClick={() => act(r.id, "APPROVE")}><CheckCircle2 className="h-4 w-4" /> {t("c.approve")}</button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => act(r.id, "REJECT")}><XCircle className="h-4 w-4" /> {t("c.reject")}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
