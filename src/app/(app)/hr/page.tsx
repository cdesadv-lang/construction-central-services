"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { useCfg } from "@/ui/configs";

const TABS = [
  ["employees", "employees"], ["departments", "departments"], ["positions", "positions"], ["contracts", "employee-contracts"],
  ["attendance", "attendance"], ["leaves", "leave-requests"], ["adjustments", "hr-adjustments"], ["allocations", "employee-allocations"],
] as const;

function Tab({ name }: { name: string }) {
  return <ResourcePage cfg={useCfg(name)} embedded />;
}

export default function Page() {
  const { t } = useApp();
  return <TabbedPage title={t("nav.hr")} tabs={TABS.map(([k, r]) => ({ key: k, label: t("t." + k), module: "hr", render: () => <Tab name={r} /> }))} />;
}
