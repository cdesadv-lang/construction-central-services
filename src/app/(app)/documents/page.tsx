"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, NoAccess, PageHeader, toast } from "@/components/ui";
import { DataTable } from "@/components/resource/table";
import { api, qs } from "@/lib/client/api";

export default function Documents() {
  const { t, can, companyId, companies } = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState(companyId || (companies.length === 1 ? companies[0].id : ""));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (companyId) setCompany(companyId); }, [companyId]);
  const load = useCallback(() => {
    api.get(`/api/documents${qs({ companyId, q, pageSize: 200 })}`).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, [companyId, q]);
  useEffect(load, [load]);
  if (!can("documents")) return <NoAccess />;
  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f || !company) return;
    const fd = new FormData();
    fd.set("file", f);
    fd.set("companyId", company);
    if (title) fd.set("title", title);
    setBusy(true);
    try {
      await api.post("/api/documents", fd);
      toast(t("c.saved"));
      setTitle("");
      if (file.current) file.current.value = "";
      load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string) => {
    if (!window.confirm(t("c.confirmDelete"))) return;
    try { await api.del(`/api/documents/${id}`); load(); } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div>
      <PageHeader title={t("nav.documents")} />
      {can("documents", "create") && (
        <form onSubmit={upload} className="card mb-4 grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-4">
          {!companyId && (
            <label className="block"><span className="label">{t("c.company")}</span>
              <select className="input" required value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">—</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </label>
          )}
          <label className="block"><span className="label">{t("f.title")}</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="block"><span className="label">{t("f.fileName")}</span><input ref={file} type="file" required className="input" /></label>
          <button className="btn btn-primary" disabled={busy}><Upload className="h-4 w-4" /> {t("c.upload")}</button>
        </form>
      )}
      <div className="card">
        <div className="border-b border-slate-200 p-3"><input className="input w-64" placeholder={t("c.search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ErrorBox error={error} />
        {!items ? <Loading /> : (
          <DataTable
            rows={items}
            columns={[{ key: "title" }, { key: "fileName" }, { key: "company.name", label: t("f.company") }, { key: "entityType", type: "enum" }, { key: "size", type: "number", get: (r) => Math.ceil(r.size / 1024) + " KB" }, { key: "createdAt", type: "datetime" }]}
            actions={(r) => (
              <div className="flex justify-end gap-1">
                <a className="btn btn-ghost btn-sm" href={`/api/documents/${r.id}`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a>
                {can("documents", "delete") && <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => del(r.id)}><Trash2 className="h-4 w-4" /></button>}
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
