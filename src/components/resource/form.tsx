"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useApp } from "../app-provider";
import { LookupSelect } from "./lookup";
import type { AnyRow, FieldDef, LinesDef } from "./types";
import { fmtMoney } from "@/lib/client/format";

export function FieldInput({ f, values, set, companyId, editing }: { f: FieldDef; values: AnyRow; set: (patch: AnyRow) => void; companyId: string; editing: boolean }) {
  const { t } = useApp();
  const v = values[f.key];
  const disabled = f.readOnly || (editing && f.createOnly);
  const change = (val: any, picked?: AnyRow) => {
    const extra = f.onPick?.(val, { ...values, [f.key]: val }, picked) ?? {};
    set({ [f.key]: val, ...extra });
  };
  switch (f.type) {
    case "textarea":
      return <textarea className="input min-h-[70px]" value={v ?? ""} disabled={disabled} required={f.required} onChange={(e) => change(e.target.value)} />;
    case "select":
      return (
        <select className="input" value={v ?? ""} disabled={disabled} required={f.required} onChange={(e) => change(e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.required && !v && <option value="">—</option>}
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {t("e." + o, o)}
            </option>
          ))}
        </select>
      );
    case "lookup":
      return (
        <LookupSelect
          entity={f.lookup!}
          params={{ companyId, ...(f.lookupParams?.(values) ?? {}) }}
          value={v ?? ""}
          required={f.required}
          disabled={disabled || !companyId}
          onChange={(val, row) => change(val, row)}
        />
      );
    case "bool":
      return (
        <div className="flex h-[38px] items-center">
          <input type="checkbox" className="h-4 w-4" checked={!!v} disabled={disabled} onChange={(e) => change(e.target.checked)} />
        </div>
      );
    case "money":
    case "number":
    case "pct":
      return <input className="input num" type="number" step={f.type === "number" ? "any" : "0.01"} min={0} max={f.type === "pct" ? 100 : undefined} value={v ?? ""} disabled={disabled} required={f.required} onChange={(e) => change(e.target.value)} />;
    case "date":
      return <input className="input" type="date" value={v ? String(v).slice(0, 10) : ""} disabled={disabled} required={f.required} onChange={(e) => change(e.target.value)} />;
    case "month":
      return <input className="input" type="month" value={v ?? ""} disabled={disabled} required={f.required} onChange={(e) => change(e.target.value)} />;
    default:
      return <input className="input" type={f.type === "email" ? "email" : f.type === "password" ? "password" : "text"} dir={f.type === "email" ? "ltr" : undefined} value={v ?? ""} disabled={disabled} required={f.required} placeholder={f.placeholder} onChange={(e) => change(e.target.value)} />;
  }
}

export function FormGrid({ fields, values, set, companyId, editing }: { fields: FieldDef[]; values: AnyRow; set: (patch: AnyRow) => void; companyId: string; editing: boolean }) {
  const { t } = useApp();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields
        .filter((f) => (!f.showIf || f.showIf(values)) && !(f.editOnly && !editing))
        .map((f) => (
          <label key={f.key} className={clsx("block", f.span === 2 && "sm:col-span-2", f.span === 3 && "sm:col-span-2 lg:col-span-3")}>
            <span className="label">
              {f.label ?? t("f." + f.key)} {f.required && <span className="text-rose-500">*</span>}
            </span>
            <FieldInput f={f} values={values} set={set} companyId={companyId} editing={editing} />
          </label>
        ))}
    </div>
  );
}

export function LinesEditor({ def, lines, setLines, companyId, header }: { def: LinesDef; lines: AnyRow[]; setLines: (l: AnyRow[]) => void; companyId: string; header: AnyRow }) {
  const { t } = useApp();
  const update = (i: number, patch: AnyRow) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totals = (def.totals ?? []).map((k) => [k, lines.reduce((s, l) => s + (Number(l[k]) || 0), 0)] as const);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-bold text-slate-700">{def.label ?? t("f." + def.key)}</h4>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines([...lines, def.newLine?.() ?? {}])}>
          <Plus className="h-3.5 w-3.5" /> {t("c.addLine")}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">#</th>
              {def.columns.map((c) => (
                <th key={c.key}>{c.label ?? t("f." + c.key)}</th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="text-slate-400">{i + 1}</td>
                {def.columns.map((c) => (
                  <td key={c.key} className={clsx(c.type === "lookup" ? "min-w-[220px]" : c.type === "money" || c.type === "number" ? "min-w-[120px]" : "min-w-[140px]")}>
                    <FieldInput f={c} values={{ ...header, ...l }} set={(p) => update(i, p)} companyId={companyId} editing={false} />
                  </td>
                ))}
                <td>
                  <button type="button" className="btn btn-ghost btn-sm text-rose-600" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length <= (def.min ?? 1)} aria-label={t("c.remove")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {totals.length > 0 && (
            <tfoot>
              <tr>
                <td />
                {def.columns.map((c) => {
                  const tot = totals.find(([k]) => k === c.key);
                  return <td key={c.key} className="num">{tot ? fmtMoney(tot[1]) : ""}</td>;
                })}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
