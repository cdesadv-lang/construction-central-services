"use client";
import { useEffect, useState } from "react";
import { api, qs } from "@/lib/client/api";
import type { AnyRow } from "./types";

const cache = new Map<string, Promise<AnyRow[]>>();

export function invalidateLookups() {
  cache.clear();
}

export function useLookup(entity: string | undefined, params: Record<string, string | undefined | null>) {
  const url = entity ? `/api/lookups/${entity}${qs(params)}` : "";
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    if (!cache.has(url)) cache.set(url, api.get<AnyRow[]>(url).catch((e) => { cache.delete(url); throw e; }));
    cache.get(url)!.then((r) => alive && setRows(r)).catch(() => alive && setRows([])).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url]);
  return { rows, loading };
}

export function LookupSelect({ entity, params, value, onChange, required, disabled, allowEmpty = true, emptyLabel = "—" }: {
  entity: string;
  params: Record<string, string | undefined | null>;
  value: string;
  onChange: (v: string, row?: AnyRow) => void;
  required?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { rows, loading } = useLookup(entity, params);
  return (
    <select className="input" value={value ?? ""} required={required} disabled={disabled || loading} onChange={(e) => onChange(e.target.value, rows.find((r) => r.id === e.target.value))}>
      {allowEmpty && <option value="">{loading ? "..." : emptyLabel}</option>}
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
