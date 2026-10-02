"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { BookOpenText, ListTree, Scale } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { TabbedPage } from "@/components/tabbed";
import { Money, Stat } from "@/components/ui";
import { LookupSelect } from "@/components/resource/lookup";
import { ReportBlock, useReport } from "@/components/widgets";

function Overview() {
  const { t, companyId } = useApp();
  const { data } = useReport("trial-balance", { companyId });
  const tot = data?.totals ?? {};
  const balanced = data && Math.abs(Number(tot.closingDebit ?? 0) - Number(tot.closingCredit ?? 0)) < 0.01;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("f.closingDebit")} value={tot.closingDebit} icon={<Scale className="h-5 w-5" />} />
        <Stat label={t("f.closingCredit")} value={tot.closingCredit} icon={<Scale className="h-5 w-5" />} />
        <Stat label={t("r.trial-balance")} value={data ? (balanced ? t("c.balanced") : t("c.unbalanced")) : "…"} money={false} tone={balanced ? "green" : "red"} icon={<Scale className="h-5 w-5" />} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/journal-entries" className="btn btn-secondary"><BookOpenText className="h-4 w-4" /> {t("nav.journalEntries")}</Link>
        <Link href="/accounts" className="btn btn-secondary"><ListTree className="h-4 w-4" /> {t("nav.accounts")}</Link>
        <Link href="/reports" className="btn btn-secondary">{t("nav.reports")}</Link>
      </div>
      <div className="card p-2"><ReportBlock report="income-statement" params={{ companyId }} /></div>
    </div>
  );
}

function Ledger() {
  const { t, companyId } = useApp();
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="card p-4">
      <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">{t("f.account")}</span><LookupSelect entity="accounts" params={{ companyId, isPostable: "true" }} value={accountId} onChange={setAccountId} /></label>
        <label className="block"><span className="label">{t("c.from")}</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="label">{t("c.to")}</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {accountId ? <ReportBlock report="general-ledger" params={{ companyId, accountId, from, to }} /> : <div className="mt-4 text-sm text-slate-500">{t("f.account")} …</div>}
    </div>
  );
}

export default function Page() {
  const { t, companyId } = useApp();
  return (
    <TabbedPage
      title={t("nav.accounting")}
      tabs={[
        { key: "overview", label: t("t.overview"), module: "reports", render: () => <Overview /> },
        { key: "tb", label: t("r.trial-balance"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="trial-balance" params={{ companyId }} /></div> },
        { key: "ledger", label: t("t.ledger"), module: "reports", render: () => <Ledger /> },
        { key: "bs", label: t("r.balance-sheet"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="balance-sheet" params={{ companyId }} /></div> },
        { key: "cf", label: t("r.cash-flow"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="cash-flow" params={{ companyId }} /></div> },
      ]}
    />
  );
}
void Money;
