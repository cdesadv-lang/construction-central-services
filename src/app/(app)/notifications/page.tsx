"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Bell, CheckCheck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";

export default function Notifications() {
  const { t, lang, setUnread } = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get("/api/notifications?pageSize=100").then((r) => { setItems(r.items); setUnread(r.unread); }).catch((e) => setError(e.message));
  }, [setUnread]);
  useEffect(load, [load]);
  const mark = async (body: any) => { await api.patch("/api/notifications", body); load(); };
  return (
    <div>
      <PageHeader title={t("nav.notifications")} actions={<button className="btn btn-secondary" onClick={() => mark({ all: true })}><CheckCheck className="h-4 w-4" /> {t("c.markAllRead")}</button>} />
      <ErrorBox error={error} />
      {!items ? <Loading /> : !items.length ? <div className="card"><Empty /></div> : (
        <div className="card divide-y divide-slate-100">
          {items.map((n) => (
            <div key={n.id} className={clsx("flex items-start gap-3 p-4", !n.read && "bg-brand-50/50")}>
              <Bell className={clsx("mt-0.5 h-5 w-5", n.read ? "text-slate-300" : "text-brand-600")} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{n.title}</div>
                {n.body && <div className="text-sm text-slate-600">{n.body}</div>}
                <div className="mt-1 text-xs text-slate-400">{fmtDateTime(n.createdAt, lang)} · {n.type}</div>
              </div>
              {n.link && <Link href={n.link} className="btn btn-ghost btn-sm" onClick={() => !n.read && mark({ ids: [n.id] })}>{t("c.open")}</Link>}
              {!n.read && <button className="btn btn-secondary btn-sm" onClick={() => mark({ ids: [n.id] })}>✓</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
