"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { PayrollRulesPanel } from "@/ui/payroll-rules";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t } = useApp();
  const payrolls = useCfg("payrolls");
  return (
    <TabbedPage
      title={t("nav.payroll")}
      tabs={[
        { key: "payrolls", label: t("nav.payroll"), render: () => <ResourcePage cfg={payrolls} embedded /> },
        { key: "rules", label: t("x.payrollRules"), module: "payroll", render: () => <PayrollRulesPanel /> },
      ]}
    />
  );
}
