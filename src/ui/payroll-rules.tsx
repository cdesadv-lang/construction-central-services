"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Empty, ErrorBox, Loading, Money, toast } from "@/components/ui";
import { api, qs } from "@/lib/client/api";
import { calcPayrollLine } from "@/lib/extracts";
import { EGYPT_2026_RULES, PayrollRulesError, validatePayrollRules, type PayrollRules, type TaxBracket } from "@/lib/payroll-rules";

function Brackets({ value, onChange, readOnly }: { value: TaxBracket[]; onChange: (b: TaxBracket[]) => void; readOnly: boolean }) {
  const { t } = useApp();
  const set = (i: number, patch: Partial<TaxBracket>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      <table className="table">
        <thead><tr><th>#</th><th>{t("x.upTo")}</th><th>{t("x.rate")}</th><th /></tr></thead>
        <tbody>
          {value.map((b, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                {i === value.length - 1 ? <span className="text-slate-500">{t("x.unlimited")}</span> : (
                  <input type="number" className="input num" disabled={readOnly} value={b.upTo ?? ""} onChange={(e) => set(i, { upTo: e.target.value === "" ? null : Number(e.target.value) })} />
                )}
              </td>
              <td><input type="number" step="0.1" className="input num" disabled={readOnly} value={b.rate} onChange={(e) => set(i, { rate: Number(e.target.value) })} /></td>
              <td>{!readOnly && value.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i).map((x, j, arr) => (j === arr.length - 1 ? { ...x, upTo: null } : x)))}><Trash2 className="h-4 w-4" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const prev = value.slice(0, -1);
          const last = value[value.length - 1];
          const lastLimit = prev.length ? prev[prev.length - 1].upTo ?? 0 : 0;
          onChange([...prev, { upTo: lastLimit + 100_000, rate: last?.rate ?? 0 }, { upTo: null, rate: last?.rate ?? 0 }]);
        }}><Plus className="h-4 w-4" /> {t("x.addBracket")}</button>
      )}
    </div>
  );
}

export function PayrollRulesPanel() {
  const { t, companyId, can } = useApp();
  const [rules, setRules] = useState<PayrollRules | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState({ gross: 20_000, ins: 20_000 });
  /** effective date of the version being edited */
  const [editing, setEditing] = useState<string>("");
  const [newDate, setNewDate] = useState("");
  const readOnly = !can("payroll", "approve");
  const load = (d: any, keep?: string) => {
    setMeta(d);
    const v = (d.versions ?? []).find((x: any) => x.effectiveFrom === (keep ?? d.effectiveFrom));
    setEditing(v?.effectiveFrom ?? d.effectiveFrom ?? "");
    setRules(v?.rules ?? d.rules);
  };
  useEffect(() => {
    if (!companyId) return;
    setRules(null);
    api.get(`/api/payroll-settings${qs({ companyId })}`).then((d) => load(d)).catch((e) => setError(e.message));
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const validation = useMemo(() => {
    if (!rules) return null;
    try { validatePayrollRules(rules); return null; } catch (e) { return e instanceof PayrollRulesError ? e.message : String(e); }
  }, [rules]);
  const calc = useMemo(() => {
    if (!rules || validation) return null;
    return calcPayrollLine({ basic: sample.gross, allowances: 0, overtime: 0, bonuses: 0, deductions: 0, insuranceSalary: sample.ins }, rules);
  }, [rules, sample, validation]);
  if (!companyId) return <Empty text={t("x.selectCompanyGeneric")} />;
  if (error) return <ErrorBox error={error} />;
  if (!rules) return <Loading />;
  const num = (k: keyof PayrollRules, label: string, step = "0.01") => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" step={step} className="input num" disabled={readOnly} value={rules[k] as number} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} />
    </label>
  );
  const save = async () => {
    setBusy(true);
    try {
      const note = (meta?.versions ?? []).find((x: any) => x.effectiveFrom === editing)?.sourceNote ?? meta?.sourceNote ?? null;
      const d = await api.put(`/api/payroll-settings${qs({ companyId })}`, { ...rules, effectiveFrom: editing || undefined, sourceNote: note });
      load(d, editing);
      toast(t("c.saved"));
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };
  const removeVersion = async (id: string, eff: string) => {
    if (!window.confirm(`${t("x.deleteVersion")} ${eff}?`)) return;
    try { load(await api.del(`/api/payroll-settings${qs({ companyId, id })}`)); toast(t("c.saved")); } catch (e) { toast((e as Error).message, "err"); }
  };
  const bool = (k: "uhiEnabled", label: string) => (
    <label className="flex items-center gap-2 sm:col-span-4">
      <input type="checkbox" disabled={readOnly} checked={!!rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.rulesVersions")}</h3>
        <div className="flex flex-wrap gap-2">
          {(meta?.versions ?? []).map((v: any) => (
            <span key={v.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm ${v.effectiveFrom === editing ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
              <button className="font-semibold" onClick={() => { setEditing(v.effectiveFrom); setRules(v.rules); }}>{t("x.effectiveFrom")} {v.effectiveFrom}</button>
              {v.id === meta?.effectiveId && <span className="text-xs text-emerald-700">({t("x.inForce")})</span>}
              {!readOnly && (meta?.versions ?? []).length > 1 && <button className="btn btn-ghost btn-sm" title={t("x.deleteVersion")} onClick={() => removeVersion(v.id, v.effectiveFrom)}><Trash2 className="h-3.5 w-3.5" /></button>}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">{t("x.effectiveFrom")}</span><input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
            <button className="btn btn-secondary btn-sm" disabled={!newDate} onClick={() => { setEditing(newDate); setNewDate(""); }}><Plus className="h-4 w-4" /> {t("x.newVersion")}</button>
            <span className="text-xs text-slate-500">{t("x.effectiveFrom")}: <b>{editing}</b></span>
          </div>
        )}
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.insurance")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {num("employeeInsPct", t("x.employeeInsPct"), "0.001")}
          {num("companyInsPct", t("x.companyInsPct"), "0.001")}
          {num("insMinWage", t("x.insMin"))}
          {num("insMaxWage", t("x.insMax"))}
        </div>
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.brackets")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {num("personalExemption", t("x.exemption"))}
          {num("overtimeMultiplier", t("x.overtimeMultiplier"), "0.05")}
          {num("hoursPerMonth", t("x.hoursPerMonth"), "1")}
          {num("daysPerMonth", t("x.daysPerMonth"), "1")}
          <label className="flex items-center gap-2 sm:col-span-4">
            <input type="checkbox" disabled={readOnly} checked={rules.deductionsReduceTaxable} onChange={(e) => setRules({ ...rules, deductionsReduceTaxable: e.target.checked })} />
            <span>{t("x.deductPenaltiesFromTaxable")}</span>
          </label>
        </div>
        <Brackets value={rules.brackets} readOnly={readOnly} onChange={(b) => setRules({ ...rules, brackets: b })} />
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.otherContributions")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {num("martyrsFundPct", t("x.martyrsFundPct"), "0.001")}
        </div>
        <div className="text-sm font-semibold text-slate-700">{t("x.uhi")}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {bool("uhiEnabled", t("x.uhiEnabled"))}
          {num("uhiEmployeePct", t("x.uhiEmployeePct"), "0.001")}
          {num("uhiEmployerPct", t("x.uhiEmployerPct"), "0.001")}
          {num("uhiEmployerMin", t("x.uhiEmployerMin"))}
        </div>
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.highIncome")}</h3>
        {rules.highIncomeSchedules.map((s, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block"><span className="label">{t("x.minIncome")}</span><input type="number" className="input num" disabled={readOnly} value={s.minIncome} onChange={(e) => setRules({ ...rules, highIncomeSchedules: rules.highIncomeSchedules.map((x, j) => (j === i ? { ...x, minIncome: Number(e.target.value) } : x)) })} /></label>
              <label className="block"><span className="label">{t("x.incomeUpTo")}</span><input type="number" className="input num" disabled={readOnly} placeholder={t("x.unlimited")} value={s.maxIncome ?? ""} onChange={(e) => setRules({ ...rules, highIncomeSchedules: rules.highIncomeSchedules.map((x, j) => (j === i ? { ...x, maxIncome: e.target.value === "" ? null : Number(e.target.value) } : x)) })} /></label>
              <div className="flex items-end">{!readOnly && <button className="btn btn-ghost btn-sm" onClick={() => setRules({ ...rules, highIncomeSchedules: rules.highIncomeSchedules.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>}</div>
            </div>
            <Brackets value={s.brackets} readOnly={readOnly} onChange={(b) => setRules({ ...rules, highIncomeSchedules: rules.highIncomeSchedules.map((x, j) => (j === i ? { ...x, brackets: b } : x)) })} />
          </div>
        ))}
        {!readOnly && <button className="btn btn-secondary btn-sm" onClick={() => setRules({ ...rules, highIncomeSchedules: [...rules.highIncomeSchedules, { minIncome: 0, maxIncome: null, brackets: [{ upTo: null, rate: 0 }] }] })}><Plus className="h-4 w-4" /> {t("x.addSchedule")}</button>}
      </div>
      <div className="card space-y-3 p-4">
        <h3 className="font-bold text-slate-800">{t("x.calculator")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="block"><span className="label">{t("x.sampleGross")}</span><input type="number" className="input num" value={sample.gross} onChange={(e) => setSample({ ...sample, gross: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">{t("x.sampleInsSalary")}</span><input type="number" className="input num" value={sample.ins} onChange={(e) => setSample({ ...sample, ins: Number(e.target.value) })} /></label>
        </div>
        {calc && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-8">
            <div><div className="text-slate-500">{t("x.insurableWage")}</div><Money value={calc.insurableWage} /></div>
            <div><div className="text-slate-500">{t("x.employeeInsPct")}</div><Money value={calc.insurance} /></div>
            <div><div className="text-slate-500">{t("x.companyInsPct")}</div><Money value={calc.companyInsurance} /></div>
            <div><div className="text-slate-500">{t("x.annualTaxable")}</div><Money value={calc.annualTaxable} /></div>
            <div><div className="text-slate-500">{t("x.monthlyTax")}</div><Money value={calc.tax} /></div>
            <div><div className="text-slate-500">{t("f.martyrsFund")}</div><Money value={calc.martyrsFund} /></div>
            <div><div className="text-slate-500">{t("f.healthInsurance")}</div><Money value={calc.healthInsurance} /></div>
            <div><div className="text-slate-500">{t("f.net")}</div><Money value={calc.net} /></div>
          </div>
        )}
      </div>
      {validation && <ErrorBox error={validation} />}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && <button className="btn btn-primary" disabled={busy || !!validation} onClick={save}><Save className="h-4 w-4" /> {t("c.save")}</button>}
        {!readOnly && <button className="btn btn-secondary" onClick={() => setRules(EGYPT_2026_RULES)}><RotateCcw className="h-4 w-4" /> {t("x.resetDefaults")}</button>}
        <span className="text-xs text-slate-500">{t("x.source")}: {t("x.payrollSource")}</span>
      </div>
    </div>
  );
}
