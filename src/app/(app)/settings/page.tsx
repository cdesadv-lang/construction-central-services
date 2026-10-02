"use client";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { UsersPanel } from "@/ui/settings-users";
import { PermissionsPanel, WorkflowsPanel } from "@/ui/settings-permissions";

export default function Page() {
  const { t } = useApp();
  return (
    <TabbedPage
      title={t("nav.settings")}
      tabs={[
        { key: "users", label: t("t.users"), module: "settings", render: () => <UsersPanel /> },
        { key: "permissions", label: t("t.permissions"), module: "settings", render: () => <PermissionsPanel /> },
        { key: "workflows", label: t("t.workflows"), module: "settings", render: () => <WorkflowsPanel /> },
      ]}
    />
  );
}
