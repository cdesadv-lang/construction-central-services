"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import clsx from "clsx";
import { Download, Play, Printer } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, NoAccess, PageHeader } from "@/components/ui";
import { LookupSelect } from "@/components/resource/lookup";
import { ReportView, type ReportData } from "@/components/widgets";
import { api, qs } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";

const GROUPS: { key: string; reports: string[] }[] = [
  { key: "groupFinancial", reports: ["trial-balance", "general-ledger", "income-statement", "balance-sheet", "cash-flow"] },
  { key: "groupParties", reports: ["receivables", "payables", "contractor-statement", "supplier-statement", "client-statement"] },
  { key: "groupProjects", reports: ["project-profitability", "project-cost", "budget-vs-actual", "expenses"] },
  { key: "groupExtracts", reports: ["contractor-extracts", "client-extracts", "retention", "advances"] },
  { key: "groupMgmt", reports: ["management-summary"] },
];
const AS_OF = ["balance-sheet", "receivables", "payables"];
const NO_DATES = ["retention", "advances"];
const PARTY: Record<string, string> = { "contractor-statement": "contractors", "supplier-statement": "suppliers", "client-statement": "clients" };

export default function Reports() {
  const { t, can, companyId, companyName, lang } = useApp();
  const [report, setReport] = useState("trial-balance");
  const [f, setF] = useState<Record<string, string>>({});
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can("reports")) return <NoAccess />;

  const params: Record<string, string | undefined> = {
    companyId,
    projectId: f.projectId,
    ...(AS_OF.includes(report) ? { asOf: f.asOf } : NO_DATES.includes(report) ? {} : { from: f.from, to: f.to }),
    ...(report === "general-ledger" ? { accountId: f.accountId } : {}),
    ...(PARTY[report] ? { partyId: f.partyId } : {}),
  };
  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get(`/api/reports/${report}${qs(params)}`));
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  const pick = (r: string) => {
    setReport(r);
    setData(null);
    setError(null);
    setF((x) => ({ from: x.from ?? "", to: x.to ?? "", asOf: x.asOf ?? "", projectId: x.projectId ?? "" }));
  };
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div>
      <PageHeader title={t("nav.reports")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <div className="card no-print h-fit p-2">
          {GROUPS.map((g) => (
            <div key={g.key} className="mb-2">
              <div className="px-2 py-1 text-[11px] font-bold uppercase text-slate-400">{t("r." + g.key)}</div>
              {g.reports.map((r) => (
                <button key={r} onClick={() => pick(r)} className={clsx("block w-full rounded-md px-3 py-1.5 text-start text-sm", report === r ? "bg-brand-600 font-semibold text-white" : "hover:bg-slate-100")}>
                  {t("r." + r)}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-4">
          <div className="card no-print p-4">
            <h3 className="mb-3 font-bold text-slate-700">{t("r." + report)} — {t("c.reportFilters")}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="label">{t("f.project")}</span>
                <LookupSelect entity="projects" params={{ companyId }} value={f.projectId ?? ""} onChange={set("projectId")} emptyLabel={t("c.all")} />
              </label>
              {AS_OF.includes(report) ? (
                <label className="block"><span className="label">{t("c.asOf")}</span><input type="date" className="input" value={f.asOf ?? ""} onChange={(e) => set("asOf")(e.target.value)} /></label>
              ) : NO_DATES.includes(report) ? null : (
                <>
                  <label className="block"><span className="label">{t("c.from")}</span><input type="date" className="input" value={f.from ?? ""} onChange={(e) => set("from")(e.target.value)} /></label>
                  <label className="block"><span className="label">{t("c.to")}</span><input type="date" className="input" value={f.to ?? ""} onChange={(e) => set("to")(e.target.value)} /></label>
                </>
              )}
              {report === "general-ledger" && (
                <label className="block">
                  <span className="label">{t("f.account")} *</span>
                  <LookupSelect entity="accounts" params={{ companyId, isPostable: "true" }} value={f.accountId ?? ""} onChange={set("accountId")} />
                </label>
              )}
              {PARTY[report] && (
                <label className="block">
                  <span className="label">{t("f.party")} *</span>
                  <LookupSelect entity={PARTY[report]} params={{ companyId }} value={f.partyId ?? ""} onChange={set("partyId")} />
                </label>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={run} disabled={loading}><Play className="h-4 w-4" /> {t("c.run")}</button>
              <a className={clsx("btn btn-secondary", !data && "pointer-events-none opacity-50")} href={`/api/reports/${report}${qs({ ...params, format: "csv" })}`}><Download className="h-4 w-4" /> {t("c.exportCsv")}</a>
              <button className="btn btn-secondary" onClick={() => window.print()} disabled={!data}><Printer className="h-4 w-4" /> {t("c.print")}</button>
            </div>
          </div>
          <ErrorBox error={error} />
          {loading && <Loading />}
          {data && !loading && (
            <div className="card">
              <div className="border-b border-slate-200 p-4">
                <h2 className="text-lg font-bold text-slate-800">{t("r." + report)}</h2>
                <div className="text-xs text-slate-500">
                  {companyId ? companyName(companyId) : t("c.allCompanies")}
                  {params.from || params.to ? ` | ${params.from ?? "…"} → ${params.to ?? "…"}` : ""}
                  {params.asOf ? ` | ${t("c.asOf")} ${params.asOf}` : ""} | {fmtDateTime(new Date().toISOString(), lang)}
                </div>
              </div>
              <ReportView data={data} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
