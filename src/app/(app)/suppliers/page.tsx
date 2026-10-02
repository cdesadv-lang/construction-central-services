"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t, companyId } = useApp();
  const suppliers = useCfg("suppliers");
  const invoices = useCfg("supplier-invoices");
  return (
    <TabbedPage
      title={t("nav.suppliers")}
      tabs={[
        { key: "suppliers", label: t("t.suppliers"), render: () => <ResourcePage cfg={suppliers} embedded /> },
        { key: "invoices", label: t("t.invoices"), render: () => <ResourcePage cfg={invoices} embedded /> },
        { key: "aging", label: t("t.aging"), module: "reports", render: () => <div className="card"><ReportBlock report="payables" params={{ companyId }} /></div> },
      ]}
    />
  );
}
