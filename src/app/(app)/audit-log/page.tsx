"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, Modal, NoAccess, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/resource/table";
import { api, qs } from "@/lib/client/api";

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "DEACTIVATE", "SUBMIT", "SUBMIT_AUTO_APPROVE", "APPROVE_STEP", "APPROVE", "REJECT", "POST", "REVERSE", "CANCEL", "LOGIN", "UPLOAD", "RECONCILE", "SETTLE", "GRANT", "REVOKE"];

export default function AuditLog() {
  const { t, can, companyId, companyName } = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<any>(null);
  const params = { companyId, page, pageSize: 50, ...f };
  const allowed = can("audit");
  const load = useCallback(() => {
    if (!allowed) return;
    setItems(null);
    api.get(`/api/audit-logs${qs(params)}`).then((r) => { setItems(r.items); setTotal(r.total); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), allowed]);
  useEffect(load, [load]);
  if (!can("audit")) return <NoAccess />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setPage(1); setF((x) => ({ ...x, [k]: e.target.value })); };
  return (
    <div>
      <PageHeader title={t("nav.audit")} actions={<a className="btn btn-secondary" href={`/api/audit-logs${qs({ ...params, page: undefined, pageSize: undefined, format: "csv" })}`}><Download className="h-4 w-4" /> {t("c.exportCsv")}</a>} />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <input className="input w-44" placeholder={t("f.entity")} value={f.entity ?? ""} onChange={set("entity")} />
          <select className="input w-44" value={f.action ?? ""} onChange={set("action")}><option value="">{t("f.action")}</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
          <input className="input w-40" type="date" value={f.from ?? ""} onChange={set("from")} />
          <input className="input w-40" type="date" value={f.to ?? ""} onChange={set("to")} />
        </div>
        <ErrorBox error={error} />
        {!items ? <Loading /> : (
          <DataTable
            rows={items}
            onRowClick={setSel}
            columns={[{ key: "createdAt", type: "datetime" }, { key: "user", get: (r) => r.user?.name ?? "system" }, { key: "action" }, { key: "entity" }, { key: "entityId", className: "num text-xs" }, { key: "company", get: (r) => companyName(r.companyId) }, { key: "ip", className: "num text-xs" }]}
          />
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          <span>{t("c.total")}: {total}</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("c.prev")}</button>
            <span className="num">{page}</span>
            <button className="btn btn-secondary btn-sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>{t("c.next")}</button>
          </div>
        </div>
      </div>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`${sel?.action} — ${sel?.entity}`} size="xl">
        {sel && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" dir="ltr">
            <div><div className="label">before</div><pre className="max-h-[60vh] overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(sel.before, null, 2)}</pre></div>
            <div><div className="label">after</div><pre className="max-h-[60vh] overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(sel.after, null, 2)}</pre></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
