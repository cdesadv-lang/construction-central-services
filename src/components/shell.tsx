"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Building2, FolderKanban, Calculator, BookOpenText, ListTree, Truck, HardHat, FileSpreadsheet, FileSignature,
  Receipt, Wallet, Landmark, ShoppingCart, PieChart, Users, Banknote, BarChart3, FileText, Bell, Settings, ShieldCheck, CheckSquare,
  LogOut, Languages, Menu, Building,
} from "lucide-react";
import clsx from "clsx";
import { useApp } from "./app-provider";
import { api } from "@/lib/client/api";
import { Toast } from "./ui";

type Item = { href: string; key: string; icon: React.ComponentType<{ className?: string }>; modules: string[] };
const GROUPS: { key: string; items: Item[] }[] = [
  {
    key: "groupMain",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, modules: ["dashboard"] },
      { href: "/companies", key: "companies", icon: Building2, modules: ["companies"] },
      { href: "/projects", key: "projects", icon: FolderKanban, modules: ["projects"] },
      { href: "/approvals", key: "approvals", icon: CheckSquare, modules: ["*"] },
    ],
  },
  {
    key: "groupFinance",
    items: [
      { href: "/accounting", key: "accounting", icon: Calculator, modules: ["accounting"] },
      { href: "/journal-entries", key: "journalEntries", icon: BookOpenText, modules: ["journals"] },
      { href: "/accounts", key: "accounts", icon: ListTree, modules: ["accounting"] },
      { href: "/suppliers", key: "suppliers", icon: Truck, modules: ["suppliers"] },
      { href: "/contractors", key: "contractors", icon: HardHat, modules: ["contractors"] },
      { href: "/client-extracts", key: "clientExtracts", icon: FileSpreadsheet, modules: ["clientExtracts"] },
      { href: "/contractor-extracts", key: "contractorExtracts", icon: FileSignature, modules: ["contractorExtracts"] },
      { href: "/expenses", key: "expenses", icon: Receipt, modules: ["expenses", "custody"] },
      { href: "/treasury", key: "treasury", icon: Wallet, modules: ["treasury", "payments"] },
      { href: "/banks", key: "banks", icon: Landmark, modules: ["banks"] },
    ],
  },
  {
    key: "groupOps",
    items: [
      { href: "/procurement", key: "procurement", icon: ShoppingCart, modules: ["procurement"] },
      { href: "/cost-accounting", key: "costing", icon: PieChart, modules: ["costing"] },
      { href: "/hr", key: "hr", icon: Users, modules: ["hr"] },
      { href: "/payroll", key: "payroll", icon: Banknote, modules: ["payroll"] },
      { href: "/reports", key: "reports", icon: BarChart3, modules: ["reports"] },
      { href: "/documents", key: "documents", icon: FileText, modules: ["documents"] },
    ],
  },
  {
    key: "groupAdmin",
    items: [
      { href: "/notifications", key: "notifications", icon: Bell, modules: ["*"] },
      { href: "/settings", key: "settings", icon: Settings, modules: ["settings"] },
      { href: "/audit-log", key: "audit", icon: ShieldCheck, modules: ["audit"] },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, can, user, companies, companyId, setCompanyId, lang, setLang, unread, setUnread } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      api.get<{ unread: number }>("/api/notifications?pageSize=1").then((r) => setUnread(r.unread)).catch(() => {});
    }, 60000);
    return () => window.clearInterval(id);
  }, [setUnread]);

  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    router.replace("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={clsx("fixed inset-y-0 start-0 z-40 w-64 shrink-0 flex-col bg-brand-900 text-slate-200 lg:static lg:flex", open ? "flex" : "hidden")}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 font-black text-white">CCS</div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold text-white">{t("app.short")}</div>
            <div className="truncate text-[11px] text-slate-400">Construction Central Services</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => i.modules.includes("*") || i.modules.some((m) => can(m)));
            if (!items.length) return null;
            return (
              <div key={g.key} className="mb-3">
                <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("nav." + g.key)}</div>
                {items.map((i) => {
                  const active = pathname === i.href || pathname.startsWith(i.href + "/");
                  const Icon = i.icon;
                  return (
                    <Link key={i.href} href={i.href} className={clsx("mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition", active ? "bg-brand-600 font-semibold text-white" : "hover:bg-white/10")}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{t("nav." + i.key)}</span>
                      {i.key === "notifications" && unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs">
          <div className="truncate font-semibold text-white">{lang === "en" && user.nameEn ? user.nameEn : user.name}</div>
          <div className="truncate text-slate-400">{t("e." + user.role)}</div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <button className="btn btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Building className="h-4 w-4 text-slate-400" />
            <select className="input w-auto min-w-[220px] py-1.5" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label={t("c.company")}>
              {companies.length > 1 && <option value="">{t("c.allCompanies")}</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {lang === "en" && c.nameEn ? c.nameEn : c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Languages className="h-4 w-4" /> {t("c.language")}
          </button>
          <Link href="/notifications" className="btn btn-ghost relative" aria-label="notifications">
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute -top-0.5 end-0.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
          </Link>
          <div className="hidden text-end text-xs leading-tight sm:block">
            <div className="font-semibold text-slate-700">{lang === "en" && user.nameEn ? user.nameEn : user.name}</div>
            <div className="text-slate-400">{user.email}</div>
          </div>
          <button className="btn btn-secondary" onClick={logout}>
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">{t("c.logout")}</span>
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
      <Toast />
    </div>
  );
}
