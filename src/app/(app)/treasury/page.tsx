"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t } = useApp();
  const tx = useCfg("treasury-transactions");
  const boxes = useCfg("cash-boxes");
  const payments = useCfg("payments");
  return (
    <TabbedPage
      title={t("nav.treasury")}
      tabs={[
        { key: "transactions", label: t("t.transactions"), module: "treasury", render: () => <ResourcePage cfg={tx} embedded /> },
        { key: "payments", label: t("t.payments"), module: "payments", render: () => <ResourcePage cfg={payments} embedded /> },
        { key: "cashboxes", label: t("t.cashboxes"), module: "treasury", render: () => <ResourcePage cfg={boxes} embedded /> },
      ]}
    />
  );
}
