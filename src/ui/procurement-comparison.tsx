"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Loading, Money, toast } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { AnyRow } from "@/components/resource/types";

export function ProcurementComparison({ requestId }: { requestId: string }) {
  const { t, can } = useApp();
  const [data, setData] = useState<AnyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/api/procurement/comparison?requestId=${requestId}`).then(setData).catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [requestId]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const createPO = async (qid: string) => {
    if (!window.confirm(t("c.confirm"))) return;
    setBusy(true);
    try {
      const po = await api.post(`/api/quotations/${qid}/create-order`);
      toast(`${t("c.done")}: ${po.number}`);
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  if (!data.quotations.length) return <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{t("c.comparison")}: {t("c.noData")}</div>;
  return (
    <div className="mt-5">
      <h4 className="mb-2 font-bold text-slate-700">{t("c.comparison")}</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="table">
          <thead>
            <tr>
              <th>{t("f.description")}</th>
              <th className="text-end">{t("f.quantity")}</th>
              {data.quotations.map((q: AnyRow) => (
                <th key={q.id} className={clsx("text-end", q.id === data.lowestQuotationId && "bg-emerald-50 text-emerald-700")}>
                  {q.supplier}
                  <div className="text-[10px] font-normal normal-case">{q.number}{q.selected ? " ✓" : ""}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: AnyRow) => (
              <tr key={r.itemId}>
                <td>{r.description}</td>
                <td className="num text-end">{r.quantity} {r.unit}</td>
                {r.prices.map((p: AnyRow) => (
                  <td key={p.quotationId} className={clsx("text-end", p.quotationId === r.bestQuotationId && "bg-emerald-50 font-bold text-emerald-700")}>
                    {p.unitPrice === null ? "—" : <Money value={p.unitPrice} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{t("c.total")}</td>
              {data.quotations.map((q: AnyRow) => (
                <td key={q.id} className={clsx("text-end", q.id === data.lowestQuotationId && "text-emerald-700")}>
                  <Money value={q.total} />
                  {q.id === data.lowestQuotationId && <div className="text-[10px]">{t("c.lowest")}</div>}
                  <div className="text-[10px] font-normal text-slate-500">{q.deliveryDays ? `${q.deliveryDays} ${t("f.days")}` : ""}</div>
                </td>
              ))}
            </tr>
            {can("procurement", "create") && (
              <tr className="no-print">
                <td colSpan={2} />
                {data.quotations.map((q: AnyRow) => (
                  <td key={q.id} className="text-end">
                    <button className="btn btn-success btn-sm" disabled={busy} onClick={() => createPO(q.id)}>{t("c.createOrder")}</button>
                  </td>
                ))}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
