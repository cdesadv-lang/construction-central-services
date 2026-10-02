import type { Lang } from "@/i18n/dict";

export function fmtMoney(v: unknown, digits = 2) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtNum(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
}
export function fmtDate(v: unknown) {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}
export function fmtDateTime(v: unknown, lang: Lang = "ar") {
  if (!v) return "";
  const d = new Date(String(v));
  return d.toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });
}
export function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(Math.round(v));
}
export const today = () => new Date().toISOString().slice(0, 10);
