"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, Money } from "@/components/ui";
import { api } from "@/lib/client/api";

interface Node { id: string; code: string; name: string; nameEn?: string; type: string; isPostable: boolean; parentId: string | null; balance: number; children: Node[]; systemKey?: string }

export function AccountTree() {
  const { t, companyId, companies, lang, dir } = useApp();
  const [company, setCompany] = useState(companyId || companies[0]?.id || "");
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { if (companyId) setCompany(companyId); }, [companyId]);
  useEffect(() => {
    if (!company) return;
    setRows(null);
    api.get(`/api/accounts?companyId=${company}&pageSize=1000`).then((r) => setRows(r.items)).catch((e) => setError(e.message));
  }, [company]);
  const roots = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, Node>(rows.map((r) => [r.id, { ...r, balance: Number(r.balance), children: [] }]));
    const out: Node[] = [];
    for (const n of map.values()) (n.parentId && map.get(n.parentId) ? map.get(n.parentId)!.children : out).push(n);
    const roll = (n: Node): number => {
      n.children.sort((a, b) => a.code.localeCompare(b.code));
      if (n.children.length) n.balance = n.children.reduce((s, c) => s + roll(c), 0);
      return n.balance;
    };
    out.sort((a, b) => a.code.localeCompare(b.code)).forEach(roll);
    return out;
  }, [rows]);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;
  const render = (n: Node, level: number): React.ReactNode => {
    const credit = ["LIABILITY", "EQUITY", "REVENUE"].includes(n.type);
    return (
      <div key={n.id}>
        <div className="flex items-center gap-2 border-b border-slate-100 py-1.5 hover:bg-brand-50/40" style={{ paddingInlineStart: 8 + level * 20 }}>
          {n.children.length ? (
            <button onClick={() => toggle(n.id)} className="text-slate-500">{open.has(n.id) ? <ChevronDown className="h-4 w-4" /> : <Chevron className="h-4 w-4" />}</button>
          ) : <span className="w-4" />}
          <span className="num w-20 text-xs text-slate-500">{n.code}</span>
          <span className={n.isPostable ? "text-slate-700" : "font-bold text-slate-800"}>{lang === "en" && n.nameEn ? n.nameEn : n.name}</span>
          {n.systemKey && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{n.systemKey}</span>}
          <span className="flex-1" />
          <span className="text-xs text-slate-400">{t("e." + n.type)}</span>
          <span className="w-40 text-end"><Money value={credit ? -n.balance : n.balance} className={n.isPostable ? "" : "font-bold"} /></span>
        </div>
        {open.has(n.id) && n.children.map((c) => render(c, level + 1))}
      </div>
    );
  };
  return (
    <div className="card p-3">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {!companyId && (
          <select className="input w-auto" value={company} onChange={(e) => setCompany(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(new Set(rows?.map((r) => r.id)))}>+ {t("c.all")}</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(new Set())}>−</button>
      </div>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : <div className="text-sm">{roots.map((r) => render(r, 0))}</div>}
    </div>
  );
}
