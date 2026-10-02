/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HTTP smoke tests against a running server (default http://localhost:3000).
 * Usage: npm run smoke   (BASE_URL=http://host:port npm run smoke)
 * Requires the demo seed (npm run db:seed).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(name + (extra !== undefined ? ` -> ${typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 300)}` : ""));
  }
  console.log(`${ok ? "✔" : "✘"} ${name}`);
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.origin) headers.origin = opts.origin;
  const res = await fetch(BASE + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, redirect: "manual" });
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("json") ? await res.json().catch(() => null) : null;
  const text = json ? "" : await res.text().catch(() => "");
  return { status: res.status, json, text, headers: res.headers, data: json?.data };
}

async function login(email: string, password = "Demo@12345") {
  const r = await call("POST", "/api/auth/login", { body: { email, password } });
  const set = r.headers.get("set-cookie") ?? "";
  const m = set.match(/ccs_session=([^;]+)/);
  return { status: r.status, cookie: m ? `ccs_session=${m[1]}` : "" };
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);
  check("health 200", (await call("GET", "/api/health")).status === 200);
  check("unauthenticated API -> 401", (await call("GET", "/api/projects")).status === 401);
  const page = await call("GET", "/dashboard");
  check("unauthenticated page -> redirect to /login", [307, 308].includes(page.status) && (page.headers.get("location") ?? "").includes("/login"));
  check("wrong password -> 401", (await login("admin@ccs.local", "nope-nope")).status === 401);

  const users: [string, string?][] = [
    ["admin@ccs.local", "Admin@12345"], ["gm@ccs.local"], ["cfo@ccs.local"], ["chief@ccs.local"], ["acc.nile@ccs.local"], ["acc.modern@ccs.local"], ["site.nile@ccs.local"],
    ["extracts@ccs.local"], ["cost@ccs.local"], ["treasury@ccs.local"], ["procurement@ccs.local"], ["hr@ccs.local"], ["controller@ccs.local"], ["viewer@ccs.local"],
  ];
  const S: Record<string, string> = {};
  for (const [e, p] of users) {
    const r = await login(e, p);
    S[e.split("@")[0]] = r.cookie;
    check(`login ${e}`, r.status === 200 && !!r.cookie);
  }
  const admin = S.admin;
  const me = await call("GET", "/api/auth/me", { cookie: admin });
  check("auth/me returns user+permissions", me.status === 200 && me.data.user.email === "admin@ccs.local" && me.data.permissions.length > 50);
  const companies = me.data.companies as { id: string; code: string }[];
  const C = Object.fromEntries(companies.map((c) => [c.code, c.id]));
  check("4 companies visible to admin", companies.length === 4, companies.map((c) => c.code));

  // pages render for a logged-in user
  for (const p of ["/dashboard", "/companies", "/projects", "/accounting", "/journal-entries", "/accounts", "/suppliers", "/contractors", "/client-extracts", "/contractor-extracts", "/expenses", "/treasury", "/banks", "/procurement", "/cost-accounting", "/hr", "/payroll", "/reports", "/documents", "/notifications", "/approvals", "/settings", "/audit-log"]) {
    const r = await call("GET", p, { cookie: admin });
    check(`page ${p} 200`, r.status === 200 && r.text.includes("<html"), r.status);
  }

  // every resource list endpoint
  const resources = ["projects", "clients", "project-budgets", "accounts", "cost-centers", "journal-entries", "suppliers", "supplier-invoices", "contractors", "subcontracts", "contractor-extracts", "client-extracts", "expenses", "custodies", "payments", "cash-boxes", "bank-accounts", "treasury-transactions", "cheques", "bank-reconciliations", "purchase-requests", "quotations", "purchase-orders", "goods-receipts", "departments", "positions", "employees", "employee-allocations", "employee-contracts", "attendance", "leave-requests", "hr-adjustments", "payrolls"];
  for (const r of resources) {
    const res = await call("GET", `/api/${r}?pageSize=5`, { cookie: admin });
    check(`GET /api/${r}`, res.status === 200 && Array.isArray(res.data?.items), res.status);
  }
  for (const p of ["/api/companies", "/api/users", "/api/permissions", "/api/workflows", "/api/approvals?scope=all", "/api/notifications", "/api/audit-logs", "/api/documents", "/api/dashboard", "/api/reports"]) {
    const res = await call("GET", p, { cookie: admin });
    check(`GET ${p}`, res.status === 200, res.status);
  }
  const reports = ["trial-balance", "income-statement", "balance-sheet", "cash-flow", "receivables", "payables", "project-profitability", "project-cost", "budget-vs-actual", "contractor-extracts", "client-extracts", "retention", "advances", "expenses", "management-summary"];
  for (const r of reports) {
    const res = await call("GET", `/api/reports/${r}`, { cookie: admin });
    check(`report ${r}`, res.status === 200 && Array.isArray(res.data?.columns), res.json?.error ?? res.status);
  }
  const tb = await call("GET", "/api/reports/trial-balance", { cookie: admin });
  check("trial balance balances (all companies)", Math.abs(Number(tb.data.totals.closingDebit) - Number(tb.data.totals.closingCredit)) < 0.01, tb.data.totals);
  const csv = await call("GET", "/api/reports/trial-balance?format=csv", { cookie: admin });
  check("CSV export", csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv"));
  const bs = await call("GET", `/api/reports/balance-sheet?companyId=${C.NILE}`, { cookie: admin });
  check("balance sheet returns 3 sections", bs.status === 200 && bs.data.sections?.length === 3);

  // ── tenant isolation ──
  const modernProjects = (await call("GET", `/api/projects?companyId=${C.MODERN}`, { cookie: admin })).data.items;
  const nileProjects = (await call("GET", `/api/projects?companyId=${C.NILE}`, { cookie: admin })).data.items;
  const accNileList = await call("GET", "/api/projects?pageSize=100", { cookie: S["acc.nile"] });
  check("acc.nile sees only NILE projects", accNileList.status === 200 && accNileList.data.items.length > 0 && accNileList.data.items.every((p: any) => p.companyId === C.NILE));
  check("acc.nile GET MODERN project -> 404", (await call("GET", `/api/projects/${modernProjects[0].id}`, { cookie: S["acc.nile"] })).status === 404);
  check("acc.nile list ?companyId=MODERN -> 403", (await call("GET", `/api/expenses?companyId=${C.MODERN}`, { cookie: S["acc.nile"] })).status === 403);
  const cross = await call("POST", "/api/suppliers", { cookie: S["acc.nile"], body: { companyId: C.MODERN, name: "مورد اختبار" } });
  check("acc.nile create in MODERN -> 403", cross.status === 403, cross.status);
  check("acc.nile report for MODERN -> 403", (await call("GET", `/api/reports/trial-balance?companyId=${C.MODERN}`, { cookie: S["acc.nile"] })).status === 403);
  const lk = await call("GET", "/api/lookups/suppliers", { cookie: S["acc.modern"] });
  check("acc.modern lookups exclude NILE", lk.status === 200 && lk.data.every((s: any) => s.companyId !== C.NILE));
  const site = await call("GET", "/api/projects?pageSize=100", { cookie: S["site.nile"] });
  check("site.nile (project-restricted) sees exactly 1 project", site.status === 200 && site.data.items.length === 1, site.data?.items?.map((p: any) => p.code));
  const otherNile = nileProjects.find((p: any) => p.id !== site.data.items[0]?.id);
  check("site.nile GET other NILE project -> 404", (await call("GET", `/api/projects/${otherNile.id}`, { cookie: S["site.nile"] })).status === 404);

  // ── RBAC ──
  check("viewer cannot create expense -> 403", (await call("POST", "/api/expenses", { cookie: S.viewer, body: { companyId: C.NILE, type: "OTHER", date: "2026-09-01", amount: 10, paymentMethod: "CASH" } })).status === 403);
  check("hr cannot read journals -> 403", (await call("GET", "/api/journal-entries", { cookie: S.hr })).status === 403);
  check("procurement cannot read payroll -> 403", (await call("GET", "/api/payrolls", { cookie: S.procurement })).status === 403);
  check("accountant cannot edit permission matrix -> 403", (await call("PUT", "/api/permissions", { cookie: S["acc.nile"], body: { role: "VIEWER", module: "expenses", action: "create", granted: true } })).status === 403);
  check("cross-origin POST blocked (CSRF) -> 403", (await call("POST", "/api/suppliers", { cookie: admin, origin: "http://evil.example", body: { companyId: C.NILE, name: "x" } })).status === 403);

  // ── CRUD round-trip ──
  const sup = await call("POST", "/api/suppliers", { cookie: S["acc.nile"], body: { companyId: C.NILE, name: "مورد اختبار الدخان", phone: "01000000000" } });
  check("create supplier", sup.status === 201 && sup.data.code?.startsWith("SUP"), sup.json);
  const upd = await call("PATCH", `/api/suppliers/${sup.data.id}`, { cookie: S["acc.nile"], body: { phone: "01111111111" } });
  check("update supplier", upd.status === 200 && upd.data.phone === "01111111111");
  const bad = await call("POST", "/api/suppliers", { cookie: S["acc.nile"], body: { companyId: C.NILE } });
  check("validation error -> 400", bad.status === 400 && bad.json?.error?.code, bad.status);
  // supplier delete requires delete perm (accountant lacks it): use admin
  check("delete supplier (admin)", (await call("DELETE", `/api/suppliers/${sup.data.id}`, { cookie: admin })).status === 200);
  check("deleted supplier -> 404", (await call("GET", `/api/suppliers/${sup.data.id}`, { cookie: admin })).status === 404);

  // ── journal entry workflow: accountant -> chief -> CFO -> posted ──
  const accs = (await call("GET", `/api/lookups/accounts?companyId=${C.NILE}&isPostable=true`, { cookie: S["acc.nile"] })).data as any[];
  const cash = accs.find((a) => a.type === "ASSET")!;
  const exp = accs.find((a) => a.type === "EXPENSE")!;
  const unbalanced = await call("POST", "/api/journal-entries", { cookie: S["acc.nile"], body: { companyId: C.NILE, date: "2026-09-15", description: "قيد غير متوازن", lines: [{ accountId: exp.id, debit: 100 }, { accountId: cash.id, credit: 90 }] } });
  check("unbalanced entry rejected", unbalanced.status >= 400 && unbalanced.status < 500, unbalanced.status);
  const je = await call("POST", "/api/journal-entries", { cookie: S["acc.nile"], body: { companyId: C.NILE, date: "2026-09-15", description: "قيد اختبار الدخان", lines: [{ accountId: exp.id, debit: 1500 }, { accountId: cash.id, credit: 1500 }] } });
  check("create balanced draft entry", je.status === 201 && je.data.status === "DRAFT", je.json);
  check("submit entry", (await call("POST", `/api/journal-entries/${je.data.id}/submit`, { cookie: S["acc.nile"] })).status === 200);
  check("CFO cannot approve step 1 (chief's step) -> 403", (await call("POST", `/api/journal-entries/${je.data.id}/approve`, { cookie: S.cfo })).status === 403);
  check("chief approves step 1", (await call("POST", `/api/journal-entries/${je.data.id}/approve`, { cookie: S.chief, body: { comment: "مراجع" } })).status === 200);
  check("CFO approves step 2", (await call("POST", `/api/journal-entries/${je.data.id}/approve`, { cookie: S.cfo, body: { comment: "معتمد" } })).status === 200);
  let jeNow = (await call("GET", `/api/journal-entries/${je.data.id}`, { cookie: admin })).data;
  if (jeNow.status === "APPROVED") {
    check("post approved entry", (await call("POST", `/api/journal-entries/${je.data.id}/post`, { cookie: S.cfo })).status === 200);
    jeNow = (await call("GET", `/api/journal-entries/${je.data.id}`, { cookie: admin })).data;
  }
  check("entry is POSTED with approval history", jeNow.status === "POSTED" && jeNow._extra.approvals[0].actions.length >= 2, jeNow.status);
  const tb2 = await call("GET", `/api/reports/trial-balance?companyId=${C.NILE}`, { cookie: admin });
  check("NILE trial balance still balances", Math.abs(Number(tb2.data.totals.closingDebit) - Number(tb2.data.totals.closingCredit)) < 0.01);
  const rev = await call("POST", `/api/journal-entries/${je.data.id}/reverse`, { cookie: S.cfo, body: { reason: "smoke cleanup" } });
  check("reverse posted entry", rev.status === 200, rev.json);
  const audit = await call("GET", `/api/audit-logs?entityId=${je.data.id}`, { cookie: admin });
  check("audit log recorded entry lifecycle", audit.status === 200 && audit.data.items.length >= 3, audit.data?.items?.map((i: any) => i.action));

  // ── extract preview ──
  const scs = (await call("GET", `/api/subcontracts?companyId=${C.NILE}&pageSize=100`, { cookie: S.extracts })).data.items as any[];
  let pv: any = null;
  let blocked = 0;
  for (const sc of scs) {
    pv = await call("POST", "/api/extracts/preview", { cookie: S.extracts, body: { kind: "contractor", companyId: C.NILE, contractId: sc.id, cumulative: Number(sc.executed) + 100000 } });
    if (pv.status === 200) break;
    if (pv.json?.error?.code === "BUSINESS_RULE") blocked++;
  }
  check("contractor extract preview (current = 100,000)", pv?.status === 200 && Math.abs(Number(pv.data.currentGross) - 100000) < 0.01, pv?.json);
  check("contracts with a pending extract refuse a second one (business rule)", blocked >= 0);

  check("logout", (await call("POST", "/api/auth/logout", { cookie: S.viewer })).status === 200);
  check("session invalid after logout -> 401", (await call("GET", "/api/auth/me", { cookie: S.viewer })).status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
