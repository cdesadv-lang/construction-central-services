"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from "clsx";
import { X, Loader2, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "./app-provider";
import { fmtMoney } from "@/lib/client/format";

export { clsx };

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  PENDING: "bg-amber-100 text-amber-800",
  SUBMITTED: "bg-amber-100 text-amber-800",
  QUOTING: "bg-sky-100 text-sky-800",
  APPROVED: "bg-sky-100 text-sky-800",
  POSTED: "bg-emerald-100 text-emerald-800",
  ORDERED: "bg-emerald-100 text-emerald-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PRESENT: "bg-emerald-100 text-emerald-800",
  CLEARED: "bg-emerald-100 text-emerald-800",
  SETTLED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-indigo-100 text-indigo-800",
  CLOSED: "bg-slate-200 text-slate-700",
  OPEN: "bg-sky-100 text-sky-800",
  PLANNING: "bg-violet-100 text-violet-800",
  CANCELLED: "bg-rose-100 text-rose-700",
  REJECTED: "bg-rose-100 text-rose-700",
  BOUNCED: "bg-rose-100 text-rose-700",
  ABSENT: "bg-rose-100 text-rose-700",
  SUSPENDED: "bg-orange-100 text-orange-800",
  TERMINATED: "bg-rose-100 text-rose-700",
  INACTIVE: "bg-slate-200 text-slate-600",
  ON_LEAVE: "bg-amber-100 text-amber-800",
  LATE: "bg-amber-100 text-amber-800",
  LEAVE: "bg-sky-100 text-sky-800",
};

export function Badge({ value, className }: { value: string | null | undefined; className?: string }) {
  const { t } = useApp();
  if (!value) return null;
  return <span className={clsx("inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", STATUS_COLORS[value] ?? "bg-slate-100 text-slate-700", className)}>{t("e." + value, value)}</span>;
}

export function Money({ value, className, colored }: { value: unknown; className?: string; colored?: boolean }) {
  const n = Number(value ?? 0);
  return <span className={clsx("num whitespace-nowrap", colored && n < 0 && "text-rose-600", colored && n > 0 && "text-emerald-700", className)}>{fmtMoney(n)}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className ?? "h-5 w-5 text-brand-600")} />;
}

export function Loading() {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-slate-500">
      <Spinner /> {t("c.loading")}
    </div>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useApp();
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-slate-400">
      <Inbox className="h-8 w-8" />
      {text ?? t("c.noData")}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>;
}

export function Modal({ open, onClose, title, children, size = "lg", footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; size?: "md" | "lg" | "xl" | "full"; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl", full: "max-w-7xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx("card w-full", w)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition", value === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, icon, tone = "brand", money = true, sub }: { label: string; value: unknown; icon?: React.ReactNode; tone?: "brand" | "green" | "red" | "amber" | "slate" | "violet"; money?: boolean; sub?: React.ReactNode }) {
  const tones: Record<string, string> = {
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      {icon && <div className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tones[tone])}>{icon}</div>}
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-slate-500">{label}</div>
        <div className="num mt-0.5 truncate text-lg font-bold text-slate-800" dir="ltr">{money ? fmtMoney(value, 0) : String(value ?? 0)}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export function Toast() {
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setMsg(d);
      window.setTimeout(() => setMsg(null), d.kind === "err" ? 6000 : 2500);
    };
    window.addEventListener("ccs-toast", h);
    return () => window.removeEventListener("ccs-toast", h);
  }, []);
  if (!msg) return null;
  return (
    <div className={clsx("no-print fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg rtl:translate-x-1/2", msg.kind === "ok" ? "bg-emerald-600" : "bg-rose-600")}>
      {msg.text}
    </div>
  );
}

export const toast = (text: string, kind: "ok" | "err" = "ok") => window.dispatchEvent(new CustomEvent("ccs-toast", { detail: { text, kind } }));

export function NoAccess() {
  const { t } = useApp();
  return <div className="card p-10 text-center text-slate-500">{t("c.noAccess")}</div>;
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function KeyVal({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i, idx) => (
        <div key={idx} className="border-b border-slate-100 py-1.5">
          <dt className="text-xs text-slate-500">{i.label}</dt>
          <dd className="font-semibold text-slate-800">{i.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export type AnyRow = Record<string, any>;
