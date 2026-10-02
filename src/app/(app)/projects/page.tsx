"use client";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { useCfg } from "@/ui/configs";

export default function Page() {
  const { t } = useApp();
  const projects = useCfg("projects");
  const clients = useCfg("clients");
  return (
    <TabbedPage
      title={t("nav.projects")}
      tabs={[
        { key: "projects", label: t("t.projects"), render: () => <ResourcePage cfg={projects} embedded /> },
        { key: "clients", label: t("t.clients"), render: () => <ResourcePage cfg={clients} embedded /> },
      ]}
    />
  );
}
