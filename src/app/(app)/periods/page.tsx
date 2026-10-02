"use client";
import { useApp } from "@/components/app-provider";
import { NoAccess, PageHeader } from "@/components/ui";
import { PeriodsManager } from "@/ui/periods";

export default function Page() {
  const { t, can } = useApp();
  if (!can("periods", "view")) return <NoAccess />;
  return (
    <div>
      <PageHeader title={t("nav.periods")} subtitle={t("x.checklist")} />
      <PeriodsManager />
    </div>
  );
}
