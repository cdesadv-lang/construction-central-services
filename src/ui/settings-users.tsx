"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, UserX } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge, ErrorBox, Loading, Modal, toast } from "@/components/ui";
import { DataTable } from "@/components/resource/table";
import { useLookup } from "@/components/resource/lookup";
import { api, qs } from "@/lib/client/api";
import { ROLES } from "@/lib/permissions";

function ProjectPicker({ companyIds, value, onChange }: { companyIds: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { rows } = useLookup("projects", {});
  const list = rows.filter((p) => companyIds.length === 0 || companyIds.includes(p.companyId));
  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {list.map((p) => (
        <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm">
          <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          {p.label}
        </label>
      ))}
    </div>
  );
}

export function UsersPanel() {
  const { t, can, companies, user: me } = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get(`/api/users${qs({ q, pageSize: 200 })}`).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, [q]);
  useEffect(load, [load]);
  const open = (u?: any) => {
    setFormError(null);
    setEdit(u ? { ...u, password: "", companyIds: u.companies.map((c: any) => c.company.id), projectIds: u.projects.map((p: any) => p.project.id) } : { email: "", name: "", nameEn: "", password: "", role: "ACCOUNTANT", allCompanies: false, isActive: true, companyIds: [], projectIds: [] });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { email: edit.email, name: edit.name, nameEn: edit.nameEn || null, role: edit.role, allCompanies: edit.allCompanies, isActive: edit.isActive, companyIds: edit.allCompanies ? [] : edit.companyIds, projectIds: edit.projectIds };
    if (edit.password) body.password = edit.password;
    try {
      if (edit.id) await api.patch(`/api/users/${edit.id}`, body);
      else await api.post("/api/users", body);
      toast(t("c.saved"));
      setEdit(null);
      load();
    } catch (err) {
      setFormError((err as Error).message);
    }
  };
  const deactivate = async (u: any) => {
    if (!window.confirm(t("c.confirm"))) return;
    try { await api.del(`/api/users/${u.id}`); load(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const set = (patch: any) => setEdit((x: any) => ({ ...x, ...patch }));
  return (
    <div className="card">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3">
        <input className="input w-64" placeholder={t("c.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        {can("settings", "create") && <button className="btn btn-primary" onClick={() => open()}><Plus className="h-4 w-4" /> {t("c.new")}</button>}
      </div>
      <ErrorBox error={error} />
      {!items ? <Loading /> : (
        <DataTable
          rows={items}
          columns={[
            { key: "name" }, { key: "email" }, { key: "role", type: "enum" },
            { key: "companies", label: t("f.companyIds"), get: (u) => (u.allCompanies ? t("c.global") : u.companies.map((c: any) => c.company.code).join(", ")) },
            { key: "projects", label: t("f.projectIds"), get: (u) => u.projects.map((p: any) => p.project.code).join(", ") || "—" },
            { key: "isActive", type: "bool" }, { key: "lastLoginAt", type: "datetime" },
          ]}
          actions={(u) => (
            <div className="flex justify-end gap-1">
              {can("settings", "edit") && <button className="btn btn-ghost btn-sm" onClick={() => open(u)}><Pencil className="h-4 w-4" /></button>}
              {can("settings", "delete") && u.id !== me.id && u.isActive && <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => deactivate(u)}><UserX className="h-4 w-4" /></button>}
            </div>
          )}
        />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `${t("c.edit")} — ${edit.email}` : t("c.new")}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <ErrorBox error={formError} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label><span className="label">{t("f.email")} *</span><input className="input" dir="ltr" type="email" required value={edit.email} onChange={(e) => set({ email: e.target.value })} /></label>
              <label><span className="label">{t("f.password")} {edit.id ? "" : "*"}</span><input className="input" dir="ltr" type="password" minLength={8} required={!edit.id} value={edit.password} onChange={(e) => set({ password: e.target.value })} /></label>
              <label><span className="label">{t("f.name")} *</span><input className="input" required value={edit.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label><span className="label">{t("f.nameEn")}</span><input className="input" value={edit.nameEn ?? ""} onChange={(e) => set({ nameEn: e.target.value })} /></label>
              <label><span className="label">{t("f.role")} *</span>
                <select className="input" value={edit.role} onChange={(e) => set({ role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t("e." + r)}</option>)}</select>
              </label>
              <div className="flex items-end gap-4 pb-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.allCompanies} disabled={!me.allCompanies} onChange={(e) => set({ allCompanies: e.target.checked })} /> {t("c.global")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> {t("f.isActive")}</label>
              </div>
            </div>
            {!edit.allCompanies && (
              <div>
                <span className="label">{t("f.companyIds")}</span>
                <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 p-2">
                  {companies.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={edit.companyIds.includes(c.id)} onChange={(e) => set({ companyIds: e.target.checked ? [...edit.companyIds, c.id] : edit.companyIds.filter((x: string) => x !== c.id) })} />
                      {c.code} — {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="label">{t("f.projectIds")} <span className="font-normal text-slate-400">(— = {t("c.all")})</span></span>
              <ProjectPicker companyIds={edit.allCompanies ? [] : edit.companyIds} value={edit.projectIds} onChange={(v) => set({ projectIds: v })} />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>{t("c.cancel")}</button>
              <button className="btn btn-primary">{t("c.save")}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
void Badge;
