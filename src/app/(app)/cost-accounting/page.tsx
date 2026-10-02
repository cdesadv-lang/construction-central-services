"use client";
import { useState } from "react";
import { ResourcePage } from "@/components/resource/resource-page";
import { TabbedPage } from "@/components/tabbed";
import { useApp } from "@/components/app-provider";
import { LookupSelect } from "@/components/resource/lookup";
import { ReportBlock } from "@/components/widgets";
import { useCfg } from "@/ui/configs";

function ProjectReport({ report }: { report: string }) {
  const { t, companyId } = useApp();
  const [projectId, setProjectId] = useState("");
  return (
    <div className="card p-3">
      <label className="no-print block max-w-sm"><span className="label">{t("f.project")}</span>
        <LookupSelect entity="projects" params={{ companyId }} value={projectId} onChange={setProjectId} emptyLabel={t("c.all")} />
      </label>
      <ReportBlock report={report} params={{ companyId, projectId }} />
    </div>
  );
}

export default function Page() {
  const { t } = useApp();
  const budgets = useCfg("project-budgets");
  return (
    <TabbedPage
      title={t("nav.costing")}
      tabs={[
        { key: "bva", label: t("r.budget-vs-actual"), module: "reports", render: () => <ProjectReport report="budget-vs-actual" /> },
        { key: "cost", label: t("r.project-cost"), module: "reports", render: () => <ProjectReport report="project-cost" /> },
        { key: "profit", label: t("r.project-profitability"), module: "reports", render: () => <ProjectReport report="project-profitability" /> },
        { key: "budgets", label: t("t.budgets"), module: "costing", render: () => <ResourcePage cfg={budgets} embedded /> },
      ]}
    />
  );
}
