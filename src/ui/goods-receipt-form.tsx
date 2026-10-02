"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorBox, Modal, toast } from "@/components/ui";
import { LookupSelect, invalidateLookups } from "@/components/resource/lookup";
import { api } from "@/lib/client/api";
import { today } from "@/lib/client/format";

export function GoodsReceiptButton({ onDone }: { onDone: () => void }) {
  const { t, companyId, companies, can } = useApp();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(companyId || (companies.length === 1 ? companies[0].id : ""));
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (companyId) setCompany(companyId); }, [companyId]);
  useEffect(() => {
    setOrder(null);
    if (!orderId) return;
    api.get(`/api/purchase-orders/${orderId}`).then((o) => {
      setOrder(o);
      setQty(Object.fromEntries(o.items.map((i: any) => [i.id, String(Math.max(0, Number(i.quantity) - Number(i.receivedQty)))])));
    }).catch((e) => setError(e.message));
  }, [orderId]);
  if (!can("procurement", "create")) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([orderItemId, q]) => ({ orderItemId, quantity: q }));
      const r = await api.post("/api/goods-receipts", { companyId: company, orderId, date, notes, items });
      toast(`${t("c.saved")}: ${r.number}`);
      invalidateLookups();
      setOpen(false);
      setOrderId("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}><PackageCheck className="h-4 w-4" /> {t("c.new")} — {t("t.receipts")}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("t.receipts")} size="xl" footer={<button className="btn btn-primary" disabled={busy || !order} onClick={submit}>{t("c.save")}</button>}>
        <ErrorBox error={error} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {!companyId && (
            <label className="block"><span className="label">{t("c.company")}</span>
              <select className="input" value={company} onChange={(e) => { setCompany(e.target.value); setOrderId(""); }}>
                <option value="">—</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </label>
          )}
          <label className="block"><span className="label">{t("f.orderId")}</span><LookupSelect entity="purchase-orders" params={{ companyId: company }} value={orderId} onChange={setOrderId} disabled={!company} /></label>
          <label className="block"><span className="label">{t("f.date")}</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="label">{t("f.notes")}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {order && (
          <table className="table mt-4">
            <thead><tr><th>{t("f.description")}</th><th className="text-end">{t("f.quantity")}</th><th className="text-end">{t("f.received")}</th><th>{t("c.new")}</th></tr></thead>
            <tbody>
              {order.items.map((i: any) => (
                <tr key={i.id}>
                  <td>{i.description}</td><td className="num text-end">{Number(i.quantity)} {i.unit}</td><td className="num text-end">{Number(i.receivedQty)}</td>
                  <td><input type="number" min={0} step="any" className="input num w-32" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}
