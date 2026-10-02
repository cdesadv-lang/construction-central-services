"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t, companyId } = useApp();
  const contractors = useCfg("contractors");
  const subcontracts = useCfg("subcontracts");
  return (
    <TabbedPage
      title={t("nav.contractors")}
      tabs={[
        { key: "contractors", label: t("t.contractors"), render: () => <ResourcePage cfg={contractors} embedded /> },
        { key: "subcontracts", label: t("t.subcontracts"), render: () => <ResourcePage cfg={subcontracts} embedded /> },
        { key: "retention", label: t("r.retention"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="retention" params={{ companyId }} /></div> },
        { key: "advances", label: t("r.advances"), module: "reports", render: () => <div className="card p-2"><ReportBlock report="advances" params={{ companyId }} /></div> },
      ]}
    />
  );
}
