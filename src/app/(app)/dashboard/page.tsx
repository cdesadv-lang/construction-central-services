"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Banknote, Building2, CheckSquare, FileSpreadsheet, FileSignature, FolderKanban, HardHat, Landmark, PiggyBank, Receipt, TrendingUp, Truck, Wallet } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, NoAccess, PageHeader, Stat } from "@/components/ui";
import { DataTable } from "@/components/resource/table";
import { api, qs } from "@/lib/client/api";
import { compact, fmtMoney } from "@/lib/client/format";

const COLORS = ["#1f6fd1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#64748b"];

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-4 ${className ?? ""}`}>
      <h3 className="mb-3 text-sm font-bold text-slate-700">{title}</h3>
      <div className="h-72" dir="ltr">{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const { t, can, companyId } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    api.get(`/api/dashboard${qs({ companyId })}`).then(setD).catch((e) => setError(e.message));
  }, [companyId]);
  if (!can("dashboard")) return <NoAccess />;
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const k = d.kpis;
  const tip = (v: any) => fmtMoney(v, 0);
  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.dashboard")} subtitle={t("app.name")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("k.companies")} value={k.companies} money={false} icon={<Building2 className="h-5 w-5" />} />
        <Stat label={t("k.projects")} value={`${k.projects} (${k.activeProjects} ${t("e.ACTIVE")})`} money={false} icon={<FolderKanban className="h-5 w-5" />} tone="violet" />
        <Stat label={t("k.totalContractValue")} value={k.totalContractValue} icon={<FileSignature className="h-5 w-5" />} />
        <Stat label={t("k.totalClientExtracts")} value={k.totalClientExtracts} icon={<FileSpreadsheet className="h-5 w-5" />} tone="green" />
        <Stat label={t("k.totalRevenue")} value={k.totalRevenue} icon={<TrendingUp className="h-5 w-5" />} tone="green" />
        <Stat label={t("k.totalExpenses")} value={k.totalExpenses} icon={<Receipt className="h-5 w-5" />} tone="red" />
        <Stat label={t("k.profit")} value={k.profit} icon={<PiggyBank className="h-5 w-5" />} tone={k.profit >= 0 ? "green" : "red"} />
        <Stat label={t("k.totalReceivables")} value={k.totalReceivables} icon={<Banknote className="h-5 w-5" />} tone="amber" />
        <Stat label={t("k.totalPayments")} value={k.totalPayments} icon={<Wallet className="h-5 w-5" />} tone="slate" />
        <Stat label={t("k.totalCollections")} value={k.totalCollections} icon={<Banknote className="h-5 w-5" />} tone="green" />
        <Stat label={t("k.contractorsOwed")} value={k.contractorsOwed} icon={<HardHat className="h-5 w-5" />} tone="amber" sub={`${t("k.contractorRetention")}: ${fmtMoney(k.contractorRetention, 0)}`} />
        <Stat label={t("k.suppliersOwed")} value={k.suppliersOwed} icon={<Truck className="h-5 w-5" />} tone="amber" />
        <Stat label={t("k.cashOnHand")} value={k.cashOnHand} icon={<Wallet className="h-5 w-5" />} tone="brand" />
        <Stat label={t("k.cashAtBank")} value={k.cashAtBank} icon={<Landmark className="h-5 w-5" />} tone="brand" />
        <Stat label={t("k.delayedProjects")} value={k.delayedProjects} money={false} icon={<AlertTriangle className="h-5 w-5" />} tone={k.delayedProjects ? "red" : "green"} />
        <Link href="/approvals"><Stat label={t("k.myPendingApprovals")} value={k.myPendingApprovals} money={false} icon={<CheckSquare className="h-5 w-5" />} tone={k.myPendingApprovals ? "amber" : "slate"} /></Link>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard title={t("c.monthlyTrend")} className="xl:col-span-2">
          <ResponsiveContainer>
            <AreaChart data={d.charts.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis tickFormatter={compact} fontSize={11} />
              <Tooltip formatter={tip} />
              <Legend />
              <Area type="monotone" dataKey="revenue" name={t("f.revenue")} stroke="#10b981" fill="#10b98133" />
              <Area type="monotone" dataKey="expenses" name={t("e.EXPENSE")} stroke="#ef4444" fill="#ef444422" />
              <Area type="monotone" dataKey="profit" name={t("f.profit")} stroke="#1f6fd1" fill="#1f6fd122" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t("c.projectStatus")}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={d.charts.projectStatus.filter((s: any) => s.count > 0).map((s: any) => ({ ...s, label: t("e." + s.status) }))} dataKey="count" nameKey="label" innerRadius={55} outerRadius={95} paddingAngle={2} label>
                {d.charts.projectStatus.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t("c.budgetVsActual")} className="xl:col-span-2">
          <ResponsiveContainer>
            <BarChart data={d.charts.projectBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="code" fontSize={11} />
              <YAxis tickFormatter={compact} fontSize={11} />
              <Tooltip formatter={tip} />
              <Legend />
              <Bar dataKey="budget" name={t("f.budget")} fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name={t("f.actualCost")} fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenue" name={t("f.revenue")} fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t("c.costByCategory")}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={d.charts.costByCategory.map((c: any) => ({ ...c, label: t("e." + c.category) }))} dataKey="amount" nameKey="label" outerRadius={95}>
                {d.charts.costByCategory.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={tip} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t("c.companyComparison")} className="xl:col-span-2">
          <ResponsiveContainer>
            <BarChart data={d.charts.byCompany}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="company" fontSize={11} />
              <YAxis tickFormatter={compact} fontSize={11} />
              <Tooltip formatter={tip} />
              <Legend />
              <Bar dataKey="contractValue" name={t("f.contractValue")} fill="#1f6fd1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenue" name={t("f.revenue")} fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cost" name={t("f.cost")} fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name={t("f.profit")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <div className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700"><AlertTriangle className="h-4 w-4 text-rose-500" /> {t("c.delayedProjects")}</h3>
          <DataTable columns={[{ key: "code" }, { key: "name" }, { key: "endDate", type: "date" }, { key: "completionPct", type: "pct" }]} rows={d.delayed} />
        </div>
      </div>
    </div>
  );
}
