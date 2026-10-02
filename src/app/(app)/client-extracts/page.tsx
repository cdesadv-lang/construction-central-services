"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t, companyId } = useApp();
  const cfg = useCfg("client-extracts");
  return (
    <TabbedPage
      title={t("nav.clientExtracts")}
      tabs={[
        { key: "list", label: t("nav.clientExtracts"), render: () => <ResourcePage cfg={cfg} embedded /> },
        { key: "report", label: t("r.client-extracts"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="client-extracts" params={{ companyId }} /></div> },
        { key: "ar", label: t("r.receivables"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="receivables" params={{ companyId }} /></div> },
      ]}
    />
  );
}
