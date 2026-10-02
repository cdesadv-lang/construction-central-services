"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translate, type Lang } from "@/i18n/dict";

export interface SessionUser { id: string; name: string; nameEn: string | null; email: string; role: string; allCompanies: boolean }
export interface CompanyLite { id: string; code: string; name: string; nameEn: string | null }

interface AppState {
  user: SessionUser;
  perms: Set<string>;
  companies: CompanyLite[];
  projectIds: string[] | null;
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: string, fallback?: string) => string;
  /** "" = all permitted companies */
  companyId: string;
  setCompanyId: (id: string) => void;
  can: (module: string, action?: string) => boolean;
  setLang: (l: Lang) => void;
  companyName: (id?: string | null) => string;
  unread: number;
  setUnread: (n: number) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider(props: { user: SessionUser; perms: string[]; companies: CompanyLite[]; projectIds: string[] | null; lang: Lang; unread: number; children: React.ReactNode }) {
  const [companyId, setCompanyIdState] = useState<string>(props.companies.length === 1 ? props.companies[0].id : "");
  const [unread, setUnread] = useState(props.unread);
  const perms = useMemo(() => new Set(props.perms), [props.perms]);
  const lang = props.lang;

  useEffect(() => {
    const saved = window.localStorage.getItem("ccs_company");
    if (saved !== null && (saved === "" || props.companies.some((c) => c.id === saved))) setCompanyIdState(props.companies.length === 1 ? props.companies[0].id : saved);
  }, [props.companies]);

  const setCompanyId = useCallback((id: string) => {
    setCompanyIdState(id);
    window.localStorage.setItem("ccs_company", id);
  }, []);

  const setLang = useCallback((l: Lang) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      user: props.user,
      perms,
      companies: props.companies,
      projectIds: props.projectIds,
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      t: (k, f) => translate(lang, k, f),
      companyId,
      setCompanyId,
      can: (m, a = "view") => perms.has(`${m}:${a}`),
      setLang,
      companyName: (id) => {
        const c = props.companies.find((x) => x.id === id);
        return c ? (lang === "en" && c.nameEn ? c.nameEn : c.name) : "";
      },
      unread,
      setUnread,
    }),
    [props.user, perms, props.companies, props.projectIds, lang, companyId, setCompanyId, setLang, unread],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
