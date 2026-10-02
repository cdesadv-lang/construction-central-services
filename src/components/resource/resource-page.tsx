"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Download, Eye, Pencil, Plus, RotateCcw, Search, Send, Trash2, Upload, XCircle } from "lucide-react";
import { useApp } from "../app-provider";
import { ErrorBox, Loading, Modal, NoAccess, PageHeader, toast } from "../ui";
import { api, qs } from "@/lib/client/api";
import { FieldInput, FormGrid, LinesEditor } from "./form";
import { DataTable } from "./table";
import { DetailBody } from "./detail";
import { invalidateLookups } from "./lookup";
import type { AnyRow, FieldDef, ResourceConfig, RowAction } from "./types";

function initialValues(fields: FieldDef[]) {
  const v: AnyRow = {};
  for (const f of fields) if (f.default !== undefined) v[f.key] = typeof f.default === "function" ? (f.default as () => unknown)() : f.default;
  return v;
}

function rowToValues(cfg: ResourceConfig, row: AnyRow) {
  if (cfg.toForm) return cfg.toForm(row);
  const v: AnyRow = {};
  for (const f of cfg.form ?? []) {
    let x = row[f.key];
    if (f.type === "date" && x) x = String(x).slice(0, 10);
    if (x && typeof x === "object" && "toFixed" in x) x = String(x);
    v[f.key] = x ?? (f.type === "bool" ? false : "");
  }
  return v;
}

export function ResourcePage({ cfg, embedded, header }: { cfg: ResourceConfig; embedded?: boolean; header?: React.ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const { t, can, companyId, companies } = app;
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [filters, setFilters] = useState<AnyRow>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [values, setValues] = useState<AnyRow>({});
  const [lines, setLines] = useState<AnyRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<AnyRow | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const pageSize = cfg.pageSize ?? 25;

  const params = useMemo(() => ({ companyId, page, pageSize, q, from, to, ...filters, ...(cfg.base ?? {}) }), [companyId, page, pageSize, q, from, to, filters, cfg.base]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items: AnyRow[]; total: number }>(`/api/${cfg.resource}${qs(params)}`);
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cfg.resource, params]);

  useEffect(() => {
    if (can(cfg.module)) load();
  }, [load, can, cfg.module]);
  useEffect(() => setPage(1), [companyId, q, filters, from, to]);

  const openDetail = useCallback(
    async (row: AnyRow) => {
      setComment("");
      try {
        setDetail(await api.get(`/api/${cfg.resource}/${row.id}`));
      } catch (e) {
        toast((e as Error).message, "err");
      }
    },
    [cfg.resource],
  );
  const reloadDetail = () => detail && openDetail(detail);

  if (!can(cfg.module)) return <NoAccess />;

  const needsCompanyField = !cfg.global && !companyId && companies.length > 1;
  const formCompany = editing ? editing.companyId : values.companyId || companyId || (companies.length === 1 ? companies[0].id : "");
  const companyField: FieldDef = { key: "companyId", label: t("c.company"), type: "select", required: true };

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    const v = { ...initialValues(cfg.form ?? []), ...(cfg.base ?? {}) };
    setValues(v);
    setLines(cfg.lines ? [cfg.lines.newLine?.() ?? {}, ...(cfg.lines.min && cfg.lines.min > 1 ? [cfg.lines.newLine?.() ?? {}] : [])] : []);
    setFormOpen(true);
  };
  const openEdit = (row: AnyRow) => {
    setEditing(row);
    setFormError(null);
    setValues(rowToValues(cfg, row));
    setLines(cfg.lines ? (cfg.lines.fromRow ? cfg.lines.fromRow(row) : (row[cfg.lines.key] ?? []).map((l: AnyRow) => ({ ...l }))) : []);
    setDetail(null);
    setFormOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (cfg.lines) {
      const err = cfg.lines.validate?.(lines);
      if (err) return setFormError(err);
    }
    const visible = (cfg.form ?? []).filter((f) => (!f.showIf || f.showIf(values)) && !(editing && f.createOnly) && !f.readOnly);
    let payload: AnyRow = {};
    for (const f of visible) payload[f.key] = values[f.key] ?? (f.type === "bool" ? false : "");
    for (const f of cfg.form ?? []) if (f.showIf && !f.showIf(values) && !(editing && f.createOnly)) payload[f.key] = f.type === "bool" ? false : "";
    if (cfg.lines) payload[cfg.lines.key] = lines.map((l) => Object.fromEntries(cfg.lines!.columns.map((c) => [c.key, l[c.key] ?? ""])));
    if (cfg.toPayload) payload = cfg.toPayload(payload, !!editing);
    setSaving(true);
    try {
      if (editing) await api.patch(`/api/${cfg.resource}/${editing.id}`, payload);
      else {
        if (cfg.global) await api.post(`/api/${cfg.resource}`, payload);
        else {
          if (!formCompany) throw new Error(t("c.selectCompanyFirst"));
          await api.post(`/api/${cfg.resource}`, { ...payload, companyId: formCompany });
        }
      }
      toast(t("c.saved"));
      invalidateLookups();
      setFormOpen(false);
      load();
      if (cfg.global) router.refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (row: AnyRow, action: string, body?: AnyRow, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      if (action === "delete") await api.del(`/api/${cfg.resource}/${row.id}`);
      else await api.post(`/api/${cfg.resource}/${row.id}/${action}`, body ?? {});
      toast(t("c.done"));
      invalidateLookups();
      load();
      if (action === "delete") setDetail(null);
      else openDetail(row);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const canEditRow = (r: AnyRow) => !cfg.noEdit && can(cfg.module, "edit") && (cfg.editable ? cfg.editable(r) : cfg.doc ? r.status === "DRAFT" : true);
  const canDeleteRow = (r: AnyRow) => !cfg.noDelete && can(cfg.module, "delete") && (cfg.doc ? r.status === "DRAFT" : cfg.editable ? cfg.editable(r) : true);

  const docButtons = (r: AnyRow) => {
    const b: React.ReactNode[] = [];
    if (!cfg.doc) return b;
    const s = r.status;
    if (s === "DRAFT" && can(cfg.module, "create"))
      b.push(<button key="submit" className="btn btn-primary" disabled={busy} onClick={() => runAction(r, "submit")}><Send className="h-4 w-4" />{t("c.submit")}</button>);
    if (s === "PENDING_APPROVAL" && can(cfg.module, "approve")) {
      b.push(<button key="approve" className="btn btn-success" disabled={busy} onClick={() => runAction(r, "approve", { comment })}><CheckCircle2 className="h-4 w-4" />{t("c.approve")}</button>);
      b.push(<button key="reject" className="btn btn-danger" disabled={busy} onClick={() => runAction(r, "reject", { comment })}><XCircle className="h-4 w-4" />{t("c.reject")}</button>);
    }
    if (s === "APPROVED" && can(cfg.module, "approve"))
      b.push(<button key="post" className="btn btn-success" disabled={busy} onClick={() => runAction(r, "post")}><Upload className="h-4 w-4" />{t("c.post")}</button>);
    if (s === "POSTED" && can(cfg.module, "approve"))
      b.push(<button key="reverse" className="btn btn-warning" disabled={busy} onClick={() => runAction(r, "reverse", { reason: comment || undefined }, t("c.confirm"))}><RotateCcw className="h-4 w-4" />{t("c.reverse")}</button>);
    if (["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(s) && can(cfg.module, "edit"))
      b.push(<button key="cancel" className="btn btn-secondary" disabled={busy} onClick={() => runAction(r, "cancel", {}, t("c.confirm"))}><Ban className="h-4 w-4" />{t("c.cancelDoc")}</button>);
    return b;
  };
  const customButtons = (r: AnyRow) =>
    (cfg.rowActions ?? [])
      .filter((a: RowAction) => can(cfg.module, a.perm) && (!a.show || a.show(r)))
      .map((a) => (
        <button key={a.key} className={`btn btn-${a.tone ?? "secondary"}`} disabled={busy} onClick={async () => {
          if (a.run) { await a.run(r); load(); return; }
          runAction(r, a.key, { comment }, a.confirm ? t("c.confirm") : undefined);
        }}>
          {a.label}
        </button>
      ));

  const filterFields = cfg.filters ?? [];
  const csvHref = `/api/${cfg.resource}${qs({ ...params, page: undefined, pageSize: undefined, format: "csv" })}`;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {!embedded && <PageHeader title={cfg.title} actions={header} />}
      <div className="card">
        <div className="no-print flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
          <form className="relative" onSubmit={(e) => { e.preventDefault(); setQ(qInput); }}>
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input w-56 ps-8" placeholder={t("c.search")} value={qInput} onChange={(e) => setQInput(e.target.value)} onBlur={() => setQ(qInput)} />
          </form>
          {filterFields.map((f) => (
            <div key={f.key} className="w-44">
              <FieldInput f={{ ...f, required: false }} values={filters} set={(p) => setFilters((x) => ({ ...x, ...p }))} companyId={companyId} editing={false} />
            </div>
          ))}
          {cfg.dateFilter && (
            <>
              <input className="input w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t("c.from")} />
              <input className="input w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t("c.to")} />
            </>
          )}
          <div className="flex-1" />
          <a className="btn btn-secondary" href={csvHref}>
            <Download className="h-4 w-4" /> {t("c.exportCsv")}
          </a>
          {!cfg.noCreate && can(cfg.module, "create") && cfg.form && (
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("c.new")}
            </button>
          )}
        </div>
        <ErrorBox error={error} />
        {loading ? (
          <Loading />
        ) : (
          <DataTable
            columns={cfg.columns}
            rows={rows}
            onRowClick={openDetail}
            totals={cfg.columns.some((c) => c.total)}
            rowKey={cfg.rowKey}
            actions={(r) => (
              <div className="flex justify-end gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => openDetail(r)} title={t("c.view")}><Eye className="h-4 w-4" /></button>
                {cfg.form && canEditRow(r) && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)} title={t("c.edit")}><Pencil className="h-4 w-4" /></button>}
                {canDeleteRow(r) && <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => runAction(r, "delete", undefined, t("c.confirmDelete"))} title={t("c.delete")}><Trash2 className="h-4 w-4" /></button>}
              </div>
            )}
          />
        )}
        <div className="no-print flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          <span>
            {t("c.total")}: <b className="num">{total}</b>
          </span>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("c.prev")}</button>
            <span className="num">{page} / {pages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("c.next")}</button>
          </div>
        </div>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={`${editing ? t("c.edit") : t("c.new")} — ${cfg.title}`} size={cfg.modalSize ?? (cfg.lines ? "xl" : "lg")}>
        <form onSubmit={save}>
          <ErrorBox error={formError} />
          {needsCompanyField && !editing && (
            <div className="mb-3 max-w-sm">
              <span className="label">{t("c.company")} <span className="text-rose-500">*</span></span>
              <select className="input" required value={values.companyId ?? ""} onChange={(e) => setValues({ companyId: e.target.value, ...initialValues(cfg.form ?? []), ...(cfg.base ?? {}) })}>
                <option value="">—</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
          )}
          {needsCompanyField && !editing && !values.companyId ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t("c.selectCompanyFirst")}</div>
          ) : (
            <>
              <FormGrid fields={(cfg.form ?? []).filter((f) => f.key !== companyField.key)} values={values} set={(p) => setValues((v) => ({ ...v, ...p }))} companyId={formCompany} editing={!!editing} />
              {cfg.lines && <LinesEditor def={cfg.lines} lines={lines} setLines={setLines} companyId={formCompany} header={values} />}
              {cfg.preview?.({ ...values, [cfg.lines?.key ?? "_lines"]: lines }, formCompany, editing?.id)}
            </>
          )}
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>{t("c.cancel")}</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? t("c.loading") : t("c.save")}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="xl"
        title={<span>{cfg.title} — <span className="num">{detail?.number ?? detail?.code ?? detail?.name ?? ""}</span></span>}
        footer={
          detail && (
            <div className="flex w-full flex-wrap items-center gap-2">
              {(cfg.doc || cfg.rowActions?.length) && (
                <input className="input max-w-xs" placeholder={t("c.comment")} value={comment} onChange={(e) => setComment(e.target.value)} />
              )}
              <div className="flex-1" />
              {docButtons(detail)}
              {customButtons(detail)}
              {cfg.form && canEditRow(detail) && <button className="btn btn-secondary" onClick={() => openEdit(detail)}><Pencil className="h-4 w-4" />{t("c.edit")}</button>}
              {canDeleteRow(detail) && <button className="btn btn-danger" disabled={busy} onClick={() => runAction(detail, "delete", undefined, t("c.confirmDelete"))}><Trash2 className="h-4 w-4" />{t("c.delete")}</button>}
              <button className="btn btn-secondary no-print" onClick={() => window.print()}>{t("c.print")}</button>
            </div>
          )
        }
      >
        {detail && <DetailBody cfg={cfg} row={detail} reload={reloadDetail} />}
      </Modal>
    </div>
  );
}
