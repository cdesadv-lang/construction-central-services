"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Languages, LogIn } from "lucide-react";
import { translate, type Lang } from "@/i18n/dict";
import { api } from "@/lib/client/api";

const DEMO = [
  ["admin@ccs.local", "Admin@12345", "SUPER_ADMIN"],
  ["gm@ccs.local", "Demo@12345", "GENERAL_MANAGER"],
  ["cfo@ccs.local", "Demo@12345", "FINANCE_MANAGER"],
  ["chief@ccs.local", "Demo@12345", "CHIEF_ACCOUNTANT"],
  ["acc.nile@ccs.local", "Demo@12345", "ACCOUNTANT"],
  ["acc.modern@ccs.local", "Demo@12345", "ACCOUNTANT"],
  ["extracts@ccs.local", "Demo@12345", "EXTRACT_ACCOUNTANT"],
  ["treasury@ccs.local", "Demo@12345", "TREASURY_ACCOUNTANT"],
  ["hr@ccs.local", "Demo@12345", "HR_OFFICER"],
  ["viewer@ccs.local", "Demo@12345", "VIEWER"],
];

export function LoginForm({ lang, showDemo }: { lang: Lang; showDemo: boolean }) {
  const t = (k: string) => translate(lang, k);
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      const next = sp.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const toggle = () => {
    document.cookie = `lang=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500">
      <div className="m-auto grid w-full max-w-5xl gap-6 p-4 lg:grid-cols-2">
        <div className="hidden flex-col justify-center text-white lg:flex">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-xl font-black">CCS</div>
          <h1 className="text-3xl font-bold leading-snug">{t("app.name")}</h1>
          <p className="mt-3 text-brand-100">{t("app.tagline")}</p>
        </div>
        <div className="card p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">{t("c.login")}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggle}>
              <Languages className="h-4 w-4" /> {t("c.language")}
            </button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="label">{t("c.email")}</span>
              <input className="input" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t("c.password")}</span>
              <input className="input" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <button className="btn btn-primary w-full py-2.5" disabled={busy}>
              <LogIn className="h-4 w-4" /> {busy ? t("c.loading") : t("c.login")}
            </button>
          </form>
          {showDemo && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-bold text-slate-500">{t("c.demoAccounts")}</div>
              <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {DEMO.map(([e, p, r]) => (
                  <button key={e} type="button" className="rounded-md border border-slate-200 px-2 py-1.5 text-start text-xs hover:bg-brand-50" onClick={() => { setEmail(e); setPassword(p); }}>
                    <div className="font-semibold text-slate-700">{translate(lang, "e." + r)}</div>
                    <div className="text-slate-500" dir="ltr">{e}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
