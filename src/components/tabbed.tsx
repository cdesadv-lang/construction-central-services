"use client";
import { useEffect, useState } from "react";
import { useApp } from "./app-provider";
import { NoAccess, PageHeader, Tabs } from "./ui";

export interface TabDef { key: string; label: string; module?: string; render: () => React.ReactNode }

export function TabbedPage({ title, subtitle, tabs, actions }: { title: string; subtitle?: string; tabs: TabDef[]; actions?: React.ReactNode }) {
  const { can } = useApp();
  const visible = tabs.filter((t) => !t.module || can(t.module));
  const [tab, setTab] = useState(visible[0]?.key ?? "");
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("tab");
    if (k && visible.some((t) => t.key === k)) setTab(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (k: string) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", k);
    window.history.replaceState(null, "", url.toString());
  };
  if (!visible.length) return <NoAccess />;
  const current = visible.find((t) => t.key === tab) ?? visible[0];
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {visible.length > 1 && <Tabs tabs={visible.map((t) => ({ key: t.key, label: t.label }))} value={current.key} onChange={change} />}
      <div key={current.key}>{current.render()}</div>
    </div>
  );
}
