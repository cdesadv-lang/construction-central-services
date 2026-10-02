"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, toast } from "@/components/ui";
import { api } from "@/lib/client/api";

export function PermissionsPanel() {
  const { t, user } = useApp();
  const [d, setD] = useState<any>(null);
  const [role, setRole] = useState("ACCOUNTANT");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get("/api/permissions").then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const grants = new Set<string>(d.grants);
  const editable = user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN";
  const toggle = async (module: string, action: string) => {
    const key = `${role}:${module}:${action}`;
    const granted = !grants.has(key);
    try {
      await api.put("/api/permissions", { role, module, action, granted });
      setD({ ...d, grants: granted ? [...d.grants, key] : d.grants.filter((g: string) => g !== key) });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
        <select className="input w-64" value={role} onChange={(e) => setRole(e.target.value)}>{d.roles.map((r: string) => <option key={r} value={r}>{t("e." + r)}</option>)}</select>
        {!editable && <span className="text-xs text-slate-500">{user.role === "SUPER_ADMIN" ? "SUPER_ADMIN = all" : "read-only (SUPER_ADMIN only)"}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("f.entity")}</th>{d.actions.map((a: string) => <th key={a} className="text-center">{t("e." + a)}</th>)}</tr></thead>
          <tbody>
            {d.modules.map((m: string) => (
              <tr key={m}>
                <td className="font-semibold">{t("m." + m)}</td>
                {d.actions.map((a: string) => (
                  <td key={a} className="text-center">
                    <input type="checkbox" className="h-4 w-4" checked={role === "SUPER_ADMIN" || grants.has(`${role}:${m}:${a}`)} disabled={!editable} onChange={() => toggle(m, a)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WorkflowsPanel() {
  const { t, can, companies, user } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = () => api.get("/api/workflows").then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const save = async () => {
    try {
      await api.put("/api/workflows", { companyId: edit.companyId || null, docType: edit.docType, isActive: edit.isActive, steps: edit.steps });
      toast(t("c.saved"));
      setEdit(null);
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const ROLES = ["CHIEF_ACCOUNTANT", "FINANCE_MANAGER", "GENERAL_MANAGER", "FINANCIAL_CONTROLLER", "EXTRACT_ACCOUNTANT", "COST_ACCOUNTANT", "TREASURY_ACCOUNTANT", "HR_OFFICER", "PROCUREMENT_OFFICER", "ACCOUNTANT", "SUPER_ADMIN"];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {d.docTypes.map((dt: any) => {
          const wfs = d.items.filter((w: any) => w.docType === dt.key);
          return (
            <div key={dt.key} className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-bold text-slate-700">{t("e." + dt.key, dt.label)}</h4>
                {can("settings", "edit") && <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ docType: dt.key, companyId: "", isActive: true, steps: wfs.find((w: any) => !w.companyId)?.steps.map((s: any) => ({ name: s.name, role: s.role })) ?? [] })}>{t("c.edit")}</button>}
              </div>
              {wfs.length ? wfs.map((w: any) => (
                <div key={w.id} className="mb-1 text-sm">
                  <span className="me-2 text-xs text-slate-500">{w.companyId ? w.company?.name : t("c.global")}{w.isActive ? "" : " (off)"}:</span>
                  {w.steps.map((s: any) => t("e." + s.role)).join(" ← ") || "—"}
                </div>
              )) : <div className="text-xs text-slate-400">— (auto-approve)</div>}
            </div>
          );
        })}
      </div>
      {edit && (
        <div className="card p-4">
          <h4 className="mb-3 font-bold">{t("e." + edit.docType)}</h4>
          <div className="mb-3 flex flex-wrap gap-3">
            <select className="input w-64" value={edit.companyId} onChange={(e) => setEdit({ ...edit, companyId: e.target.value })}>
              {user.allCompanies && <option value="">{t("c.global")}</option>}
              {companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> {t("f.isActive")}</label>
          </div>
          {edit.steps.map((s: any, i: number) => (
            <div key={i} className="mb-2 flex gap-2">
              <span className="w-8 pt-2 text-slate-400">{i + 1}</span>
              <input className="input" value={s.name} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <select className="input" value={s.role} onChange={(e) => setEdit({ ...edit, steps: edit.steps.map((x: any, j: number) => (j === i ? { ...x, role: e.target.value } : x)) })}>{ROLES.map((r) => <option key={r} value={r}>{t("e." + r)}</option>)}</select>
              <button className="btn btn-ghost text-rose-600" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_: any, j: number) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { name: `Step ${edit.steps.length + 1}`, role: "CHIEF_ACCOUNTANT" }] })}>{t("c.addStep")}</button>
            <div className="flex-1" />
            <button className="btn btn-secondary" onClick={() => setEdit(null)}>{t("c.cancel")}</button>
            <button className="btn btn-primary" onClick={save}>{t("c.save")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
