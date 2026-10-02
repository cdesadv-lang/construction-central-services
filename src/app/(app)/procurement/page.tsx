"use client";
import { useState } from "react";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { GoodsReceiptButton } from "@/ui/goods-receipt-form";
import { useCfg } from "@/ui/configs";

function Receipts() {
  const cfg = useCfg("goods-receipts");
  const [k, setK] = useState(0);
  return (
    <div>
      <div className="mb-3 flex justify-end"><GoodsReceiptButton onDone={() => setK((x) => x + 1)} /></div>
      <ResourcePage key={k} cfg={cfg} embedded />
    </div>
  );
}

export default function Page() {
  const { t } = useApp();
  const pr = useCfg("purchase-requests");
  const q = useCfg("quotations");
  const po = useCfg("purchase-orders");
  return (
    <TabbedPage
      title={t("nav.procurement")}
      subtitle={`${t("t.requests")} → ${t("t.quotations")} → ${t("t.comparison")} → ${t("t.orders")} → ${t("t.receipts")} → ${t("t.invoices")} → ${t("t.payments")}`}
      tabs={[
        { key: "requests", label: t("t.requests"), render: () => <ResourcePage cfg={pr} embedded /> },
        { key: "quotations", label: t("t.quotations"), render: () => <ResourcePage cfg={q} embedded /> },
        { key: "orders", label: t("t.orders"), render: () => <ResourcePage cfg={po} embedded /> },
        { key: "receipts", label: t("t.receipts"), render: () => <Receipts /> },
      ]}
    />
  );
}
