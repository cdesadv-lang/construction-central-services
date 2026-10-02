"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t, companyId } = useApp();
  const expenses = useCfg("expenses");
  const custody = useCfg("custodies");
  return (
    <TabbedPage
      title={t("nav.expenses")}
      tabs={[
        { key: "expenses", label: t("t.expenses"), module: "expenses", render: () => <ResourcePage cfg={expenses} embedded /> },
        { key: "custody", label: t("t.custody"), module: "custody", render: () => <ResourcePage cfg={custody} embedded /> },
        { key: "report", label: t("r.expenses"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="expenses" params={{ companyId }} /></div> },
      ]}
    />
  );
}
