"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { AccountTree } from "@/ui/account-tree";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t } = useApp();
  const accounts = useCfg("accounts");
  const cc = useCfg("cost-centers");
  return (
    <TabbedPage
      title={t("nav.accounts")}
      tabs={[
        { key: "tree", label: t("t.tree"), render: () => <AccountTree /> },
        { key: "list", label: t("t.accounts"), render: () => <ResourcePage cfg={accounts} embedded /> },
        { key: "cc", label: t("t.costCenters"), render: () => <ResourcePage cfg={cc} embedded /> },
      ]}
    />
  );
}
