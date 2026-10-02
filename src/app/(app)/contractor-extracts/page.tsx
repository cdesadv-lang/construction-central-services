"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t, companyId } = useApp();
  const cfg = useCfg("contractor-extracts");
  return (
    <TabbedPage
      title={t("nav.contractorExtracts")}
      tabs={[
        { key: "list", label: t("nav.contractorExtracts"), render: () => <ResourcePage cfg={cfg} embedded /> },
        { key: "report", label: t("r.contractor-extracts"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="contractor-extracts" params={{ companyId }} /></div> },
      ]}
    />
  );
}
