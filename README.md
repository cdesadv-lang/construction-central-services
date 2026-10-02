# Construction Central Services — مركز الخدمات المالية والإدارية لشركات المقاولات

نظام ERP متعدد الشركات لمركز خدمات مشتركة يدير المحاسبة والمالية والموارد البشرية والمشتريات والمستخلصات والتكاليف والتقارير لعدد غير محدود من شركات المقاولات من منصة واحدة، مع عزل تام لبيانات كل شركة.

A multi-company (multi-tenant) construction ERP for a shared-services centre that runs accounting, finance, HR, procurement, progress billing (extracts / مستخلصات), costing and reporting for many client construction companies. Every tenant record carries `companyId`; data never leaks across companies.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · PostgreSQL 17 · Prisma 6 · zod · bcrypt · recharts · vitest. Arabic RTL UI by default with an English toggle.

---

## 1. التشغيل السريع / Quick start

```bash
# 1) dependencies
npm install

# 2) database (local PostgreSQL)
sudo -u postgres psql -c "CREATE ROLE ccs LOGIN PASSWORD 'ccs_dev_pass' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE ccs OWNER ccs;"
sudo -u postgres psql -c "CREATE DATABASE ccs_test OWNER ccs;"   # used by automated tests

# 3) environment
cp .env.example .env        # edit DATABASE_URL / TEST_DATABASE_URL if needed

# 4) migrate + seed demo data (seed TRUNCATES all tables)
npm run db:migrate          # prisma migrate deploy
npm run db:seed             # realistic Egyptian demo data via the real posting engine

# 5) run
npm run dev                 # http://localhost:3000  (dev)
# or
npm run build && npm start  # production mode on :3000
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build / server (port 3000) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest (unit + integration against `TEST_DATABASE_URL`; global setup migrates & seeds it) |
| `npm run smoke` | HTTP smoke tests against a running server (`BASE_URL`, default `http://localhost:3000`). **Writes to that DB** (creates & reverses one journal entry, creates/deletes a supplier). |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:deploy` | Same, for managed hosts: uses the direct URL (`MIGRATE_DATABASE_URL` / `DIRECT_URL` / `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`, else `DATABASE_URL`); `SKIP_MIGRATIONS=true` skips |
| `npm run db:bootstrap` | Non-destructive production bootstrap: default permissions & workflows on an empty DB, first SUPER_ADMIN from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `npm run build:prod` / `npm run start:prod` | Managed-host build (`prisma generate && next build`) / start (migrate deploy → bootstrap → `next start -p $PORT`) |
| `npm run vercel-build` | Vercel build: `prisma generate` → migrate deploy → bootstrap → `next build` |
| `npm run db:migrate:dev` | Create a new migration during development |
| `npm run db:seed` | Truncate all tables and load demo data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `scripts/backup.sh [dir]` | pg_dump backup (+ uploads tarball), retention |
| `scripts/restore.sh <file.dump> [db_url]` | pg_restore a backup |

### Environment variables (`.env.example`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Prisma). On Neon / Supabase use the **pooled** URL |
| `DIRECT_URL` (or `MIGRATE_DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`) | Direct (non-pooled) URL used only for migrations |
| `SKIP_MIGRATIONS` | `true` = don't run migrations in `vercel-build` / `start:prod` |
| `TEST_DATABASE_URL` | Separate database for `npm test` (it is wiped & re-seeded) |
| `SESSION_TTL_HOURS` | Session lifetime (default 12) |
| `COOKIE_SECURE` | `true` behind HTTPS (Secure cookie) |
| `UPLOAD_DIR` | Local attachments directory (default `./storage/uploads`) |
| `MAX_UPLOAD_MB` | Upload size limit (default 20) |
| `SHOW_DEMO_ACCOUNTS` | Show demo-account shortcuts on the login page (`false` in production) |
| `LOGIN_MAX_FAILURES` / `LOGIN_MAX_FAILURES_PER_EMAIL` / `LOGIN_MAX_FAILURES_PER_IP` | Failed logins before a lock (defaults 10 per email+IP, 30 per email, 50 per IP) |
| `LOGIN_WINDOW_MINUTES` / `LOGIN_LOCK_MINUTES` | Counting window and lock duration (default 15 / 15) |
| `STORAGE_DRIVER` | `local` (`UPLOAD_DIR`) or `s3`; unset = `s3` when `S3_BUCKET` is set, otherwise `local` |
| `EPHEMERAL_FS` / `ALLOW_EPHEMERAL_UPLOADS` | Ephemeral filesystem (auto-detected on Vercel; set `EPHEMERAL_FS=true` on Render/Railway without a volume): local uploads are refused (422, and `/api/health?deep=1` reports storage as failing) unless `ALLOW_EPHEMERAL_UPLOADS=true` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX`, `S3_SSE` | S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Wasabi…). `S3_ENDPOINT` empty = AWS |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | First SUPER_ADMIN created by `scripts/bootstrap.ts` if that email doesn't exist (never modifies existing users) |
| `BOOTSTRAP_ON_START` | Run the bootstrap in `start:prod` (default `true`) / in the Docker entrypoint (default only when `ADMIN_EMAIL` is set) |

---

## 2. حسابات الدخول التجريبية / Demo login accounts

All passwords are `Demo@12345` except the super admin (`Admin@12345`). **Change or deactivate them before any real use.**

| Email | Role / الدور | Company access |
|---|---|---|
| admin@ccs.local | SUPER_ADMIN — مدير النظام | all companies |
| gm@ccs.local | GENERAL_MANAGER — المدير العام | all |
| cfo@ccs.local | FINANCE_MANAGER — المدير المالي | all |
| controller@ccs.local | FINANCIAL_CONTROLLER — المراقب المالي | all |
| chief@ccs.local | CHIEF_ACCOUNTANT — رئيس الحسابات | CCS + NILE + MODERN + UNITED |
| acc.nile@ccs.local | ACCOUNTANT — محاسب مقاولات | NILE only |
| acc.modern@ccs.local | ACCOUNTANT — محاسب مقاولات | MODERN + UNITED |
| site.nile@ccs.local | ACCOUNTANT (project-restricted) | NILE, project NIL-P01 only |
| extracts@ccs.local | EXTRACT_ACCOUNTANT — محاسب مستخلصات | NILE + MODERN + UNITED |
| cost@ccs.local | COST_ACCOUNTANT — محاسب تكاليف | NILE + MODERN + UNITED |
| treasury@ccs.local | TREASURY_ACCOUNTANT — محاسب خزينة | NILE + MODERN + UNITED |
| procurement@ccs.local | PROCUREMENT_OFFICER — مسؤول مشتريات | NILE + MODERN + UNITED |
| hr@ccs.local | HR_OFFICER — مسؤول موارد بشرية | NILE + MODERN + UNITED |
| viewer@ccs.local | VIEWER — مستخدم اطلاع | NILE only |

**Seed contents:** central company `CCS` (مركز الخدمات المركزية) + 3 construction companies — شركة مقاولات النيل (NILE), شركة البناء الحديث (MODERN), شركة الإنشاءات المتحدة (UNITED). Each has 3 projects, clients, suppliers, contractors, subcontracts, contractor advances, contractor & client extracts with payments, supplier invoices, expenses, custody, treasury & bank moves, cheques, employees, departments/positions, 2 payroll runs + salary payments (computed with the statutory 2026 payroll rules), a full procurement cycle (quotation lines linked to request items), cheques through their lifecycle (collected/cleared with charges, deposited then bounced, issued, in hand), a USD bank account with a USD capital receipt and a USD import invoice paid a month later (realized FX gain), monthly demo exchange rates (USD/EUR/SAR — illustrative values, not official CBE rates), fiscal years 2025–2026 with every month up to **June 2026 closed** through the real close checklist, and pending approval items. All accounting is generated by the real posting engine (207 journal entries, 204 posted; the ledger balances).

---

## 3. الأدوار والصلاحيات / Roles & permissions (RBAC)

Enforcement is **server-side** in every API route (`requirePerm`, `assertCompany`, `assertProject` in `src/server/context.ts`); the UI hides what the user cannot do (sidebar, buttons) using the same permission set.

Three layers:
1. **Company-level** — `UserCompany` (or `allCompanies` for central management). A record of another company returns **404** (existence is not leaked); explicitly asking for another company's data (`?companyId=`) returns **403**.
2. **Project-level** — `UserProject`. If a user has any project rows, they only see those projects and documents linked to them (e.g. `site.nile`).
3. **Module-level** — role → module → action matrix (`RolePermission` table, editable by SUPER_ADMIN in *Settings → Permissions*). Actions: **V**iew, **C**reate, **E**dit, **A**pprove (approve / post / reverse), **D**elete.

| Role | Responsibility |
|---|---|
| SUPER_ADMIN | Everything, incl. permission matrix |
| GENERAL_MANAGER | Oversight, final approval of payroll, company/project setup |
| FINANCE_MANAGER (CFO) | GL, journals, treasury, banks, parties, expenses, revenue, financial reports; final approver |
| CHIEF_ACCOUNTANT | Reviews entries (1st approval step), reconciliations, trial balance, AR/AP |
| ACCOUNTANT | Construction accountant for assigned companies: expenses, revenue, entries, extracts, parties, custody |
| EXTRACT_ACCOUNTANT | Client / contractor extracts, deductions, payments against extracts |
| COST_ACCOUNTANT | Budgets, budget vs actual, cost analysis |
| PROCUREMENT_OFFICER | PRs, quotations, comparison, POs, receiving |
| HR_OFFICER | Employees, contracts, attendance, leave, adjustments, payroll preparation |
| TREASURY_ACCOUNTANT | Cash, receipts/payments, cheques, transfers, banks, reconciliation |
| FINANCIAL_CONTROLLER | Read-everything: reports, KPIs, variances, audit |
| VIEWER | Read-only dashboard, projects and reports |

### Default permission matrix (generated from `src/lib/permissions.ts`)

SA=Super Admin, GM=General Manager, FM=Finance Manager, CA=Chief Accountant, ACC=Accountant, EXT=Extracts, COST=Cost, PROC=Procurement, HR, TRS=Treasury, FC=Financial Controller, VW=Viewer.

| Module | SA | GM | FM | CA | ACC | EXT | COST | PROC | HR | TRS | FC | VW |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| dashboard | VCEAD | V | V | V | V | V | V | V | V | V | V | V |
| companies | VCEAD | VCE | V | V | — | — | — | — | — | — | V | — |
| projects | VCEAD | VCE | VCE | V | V | V | VE | V | V | V | V | V |
| accounting | VCEAD | V | VCEA | VCEA | V | — | V | — | — | V | V | — |
| periods | VCEAD | V | VCEA | VCE | V | — | — | — | — | — | V | — |
| journals | VCEAD | VA | VCEAD | VCEA | VCE | — | V | — | — | — | V | — |
| suppliers | VCEAD | V | VCEAD | VCEA | VCE | V | — | VCE | — | V | V | — |
| contractors | VCEAD | V | VCEAD | VCEA | VCE | VCE | V | — | — | V | V | — |
| clientExtracts | VCEAD | VA | VCEAD | VCEA | VCE | VCE | V | — | — | V | V | — |
| contractorExtracts | VCEAD | VA | VCEAD | VCEA | VCE | VCE | V | — | — | V | V | — |
| expenses | VCEAD | VA | VCEAD | VCEA | VCE | — | V | — | — | — | V | — |
| custody | VCEAD | VA | VCEAD | VCEA | VCE | — | — | — | V | VCE | V | — |
| payments | VCEAD | VA | VCEAD | VCEA | VCE | VCE | — | — | — | VCEA | V | — |
| treasury | VCEAD | VA | VCEAD | VA | V | — | — | — | — | VCEA | V | — |
| banks | VCEAD | V | VCEAD | VCEA | V | — | — | — | — | VCEA | V | — |
| procurement | VCEAD | VA | VA | V | — | — | V | VCED | — | — | V | — |
| costing | VCEAD | V | V | V | V | — | VCEA | — | — | — | V | — |
| hr | VCEAD | V | V | — | — | — | — | — | VCEAD | — | V | — |
| payroll | VCEAD | VA | VA | VA | — | — | V | — | VCE | — | V | — |
| reports | VCEAD | V | V | V | V | V | V | V | V | V | V | V |
| documents | VCEAD | VC | VCD | VC | VC | VC | VC | VC | VC | VC | V | — |
| notifications | VCEAD | V | V | V | V | V | V | V | V | V | V | V |
| settings | VCEAD | V | — | — | — | — | — | — | — | — | — | — |
| audit | VCEAD | V | V | V | — | — | — | — | — | — | V | — |

Regenerate with `npx tsx scripts/permission-matrix.ts`.

### Approval workflows / مسارات الاعتماد

Document lifecycle: `DRAFT → (submit) PENDING_APPROVAL → step 1 … step n → APPROVED → (post) POSTED`, plus `CANCELLED` (before posting) and **reverse** (after posting: an equal-and-opposite posted entry is created). Each step must be acted on by a user with the step's role; submitters cannot approve their own documents (except SUPER_ADMIN). Every action is stored (`ApprovalRequest` / `ApprovalAction`) and shown as approval history; approvers get notifications. Workflows are configurable globally or per company in *Settings → Workflows*. Seeded defaults:

| Document | Steps |
|---|---|
| Journal entry, Expense, Payment, Client extract, Contractor extract | CHIEF_ACCOUNTANT → FINANCE_MANAGER |
| Supplier invoice | CHIEF_ACCOUNTANT |
| Payroll | FINANCE_MANAGER → GENERAL_MANAGER |
| Treasury transaction, Custody, Purchase order | FINANCE_MANAGER |

A document type with no active workflow is auto-approved on submit (audit action `SUBMIT_AUTO_APPROVE`).

---

## 4. المحاسبة / Accounting core

* True double-entry; per-company hierarchical chart of accounts (Egyptian template, `COA_TEMPLATE`) with system keys (AR, AP_SUPPLIERS, AP_CONTRACTORS, RETENTION_*, WHT_*, VAT_INPUT, CUSTODY, COST_* …), sub-accounts per project, cost centers (one auto-created per project).
* Journal entries must balance (debits = credits, one side per line, ≥ 2 lines, postable accounts of the same company); **only POSTED entries affect the ledger and reports**.
* Operational documents generate their journal entry automatically when posted (`src/server/services/posting.ts`), linked by `sourceType/sourceId` and shown in each document's detail view:

| Document | Journal entry on posting |
|---|---|
| Expense | Dr project cost / expense (by type) — Cr cash box / bank / custody / supplier (credit); **by cheque**: Cr Notes payable (2110) and an `ISSUED` cheque is registered (see Cheques) |
| Supplier invoice | Dr cost or expense + Dr VAT input — Cr supplier payable |
| Supplier / contractor payment | Dr payable — Cr cash/bank (limited to the remaining balance of the linked invoice/extract) |
| Contractor advance | Dr contractor advances — Cr cash/bank |
| Client receipt | Dr cash/bank — Cr AR |
| Contractor extract | Dr subcontractor cost (current work) — Cr contractor payable (net), retention payable, WHT payable, insurance payable, advance recovery, penalties income |
| Client extract | Dr AR (net), retention receivable, WHT receivable, client insurance/deductions — Cr contract revenue (work value) |
| Payroll | Dr labor cost per allocated project / admin salaries + company insurance — Cr salaries payable, insurance & tax payables, deductions |
| Treasury | Cash/bank receipts, payments, transfers, deposits, withdrawals |
| Custody | Dr employee custody — Cr cash box; settlement returns the remainder and closes it |
| FX revaluation | Dr/Cr each open foreign-currency balance — Cr/Dr Unrealized FX gains/losses (5207); auto-reversed the next day by default |
| Fiscal-year close | Year-end closing entry: every revenue & expense account → Retained earnings (reversed on reopen) |

### Accounting periods & month-end close / الفترات المحاسبية والإقفال

* `FiscalYear` (per company, any start month) with 12 monthly `AccountingPeriod`s (`OPEN` / `CLOSED`). Page **/periods**; resources `fiscal-years` and `accounting-periods` (actions `checklist`, `close`, `reopen`).
* **Lock:** creating, editing, deleting, submitting, approving or posting any ledger document or journal entry dated in a closed period is rejected (422) — enforced both in the ledger layer (`createJournalEntry`, draft-entry edits, posting) and in the document engine (payroll uses the month end). Reversals of documents from a closed period are dated today. **Fiscal-year validation:** once a company has at least one fiscal year, any document or entry dated outside every fiscal year is rejected (422 — create the fiscal year first); companies with no fiscal years are unrestricted. Fiscal years cannot overlap.
* **Close checklist** (per period): automatic blocking checks — previous period closed, no unposted documents (draft / pending / approved) dated in the period, period trial balance balanced; automatic warnings — payroll posted for the month, bank accounts reconciled to the period end, received cheques due in the period still in hand; required manual items — accruals, depreciation, inventory/WIP, review & sign-off.
* **Year-end close:** closing a fiscal year (all 12 periods closed, earlier years closed first) posts a closing entry dated on the last day of the year (`sourceType=YEAR_END_CLOSE`) that zeroes every revenue and expense account against *Retained earnings* (net profit credits it, a loss debits it); the year stores `closingEntryId`. Reopening the year (reason required, latest closed year only) posts a reversing entry on the same date — the original stays for the audit trail. The income statement and dashboard ignore closing entries, so a closed year's P&L still shows its results; the balance sheet shows them in retained earnings. The seed closes FY 2025 for every company.
* **Permissions** (module `periods`): view (accountants, GM, FC), checklist ticks (`edit`: chief accountant / CFO), close & reopen (`approve`: CFO / super admin). Reopening requires a reason, only the latest closed period can be reopened, and a closed fiscal year must be reopened first. Every close / reopen / checklist change is audit-logged.

### Cheques / الشيكات (full lifecycle)

| Type | Transition | Journal entry |
|---|---|---|
| Received | (created / client receipt by cheque) → `RECEIVED` | Dr Notes receivable (1109) — Cr party / counter account |
| | `RECEIVED → UNDER_COLLECTION` (collect) | Dr Cheques under collection (1110) — Cr 1109 |
| | `RECEIVED → DEPOSITED` (deposit) | Dr Bank — Cr 1109 |
| | `UNDER_COLLECTION → CLEARED` | Dr Bank — Cr 1110 |
| | `DEPOSITED → CLEARED` | — (confirmation only) |
| | `UNDER_COLLECTION / DEPOSITED → BOUNCED` | Dr party — Cr 1110 / Bank (receivable restored, invoice/extract paid amount reduced) |
| | `RECEIVED → CANCELLED` (returned) | Dr party — Cr 1109 |
| | `BOUNCED → RECEIVED` (re-present) | Dr 1109 — Cr party |
| Issued | (created / payment by cheque) → `ISSUED` | Dr party / counter account — Cr Notes payable (2110) |
| | `ISSUED → CLEARED` | Dr 2110 — Cr Bank |
| | `ISSUED → BOUNCED / CANCELLED` | Dr 2110 — Cr party (liability restored) |
| | `BOUNCED → ISSUED` (re-issue) | Dr party — Cr 2110 |

Optional bank charges on deposit/clear/bounce post Dr Bank charges (5205) — Cr Bank. Every move is a `ChequeMovement` (date, from/to, bank, charges, journal entry, user, notes) shown in the cheque's detail drawer with action buttons; actions need `banks:approve`. A payment whose cheque has already moved cannot be reversed — use the cheque lifecycle.

**Expenses paid by cheque** (`paymentMethod=CHEQUE`; payee supplier, drawn-on bank account in the expense currency and cheque number required, due date optional): posting debits the expense and credits Notes payable (2110), and registers an `ISSUED` cheque linked to the expense (`Cheque.expenseId`, payee = the supplier, the expense entry is its initial movement). The bank only moves when the cheque clears; bouncing or cancelling it restores the supplier payable. Reversing the expense is blocked once its cheque has moved; reversing it before that cancels the cheque.

### Payroll rules / قواعد الرواتب (per company, effective-dated, editable)

*Payroll → Payroll rules* (`GET /api/payroll-settings?companyId=&date=` returns every version plus the one in force on `date`; `PUT ?companyId=` creates/updates the version keyed by `effectiveFrom`; `DELETE ?companyId=&id=` removes a version, never the last one; edits need `payroll:approve`, audit-logged, validated). **Versions:** each rule set has an `effectiveFrom` date; a payroll uses the version in force on the first day of its month (the earliest version if the month precedes all of them) and records it in `Payroll.rulesId`; posted payrolls keep their computed amounts when rules change later. Each version holds employee / employer social-insurance %, monthly minimum / maximum insurable wage, annual personal exemption, the salary-tax bracket table, the high-income schedules, overtime multiplier, hours/days per month, whether absence/penalty deductions reduce taxable income, the Martyrs' Fund % and the universal-health-insurance switch, shares and employer minimum. A live calculator shows the effect before saving. Each payroll line: insurance on the insurable wage clamped to [min, max] (0 = not insured); monthly tax = annual tax on (12 × monthly taxable − personal exemption) ÷ 12, with monthly taxable = gross − employee social insurance − employee health insurance (− deductions if enabled). **Martyrs' Fund** = % of gross, withheld from the employee. **Universal health insurance** (off by default — enable it for companies in governorates where the UHI system is in force): employee % and employer % of the insurable wage, employer share at least the monthly minimum. Posting credits *Insurance payable* (social + health, both shares — both are collected by NOSI), *Martyrs' Fund payable* (2111) and *Salary tax payable*; employer shares are expensed with the salary cost.

Seeded versions (every company: 2025-01-01 and 2026-01-01) and sources:

| Rule | Value | Source |
|---|---|---|
| Social insurance shares | employee 11 %, employer 18.75 % of the insurable wage | Social Insurance & Pensions Law 148/2019 |
| Insurable wage limits from 1 Jan 2026 | min 2,700 EGP / max 16,700 EGP per month | NOSI announcement 30/11/2025 — https://www.nosi.gov.eg/ar/News/Pages/2025-11-30.aspx |
| Insurable wage limits in 2025 (version 2025-01-01) | min 2,300 EGP / max 14,500 EGP per month | NOSI 2025 limits (annual increase under Law 148/2019) |
| Personal exemption | 20,000 EGP / year | Income Tax Law 91/2005 as amended by Law 7/2024 — https://eta.gov.eg/sites/default/files/2024-03/law_no.7-2024.pdf |
| Salary-tax brackets (annual taxable income) | 0–40k 0 % · 40–55k 10 % · 55–70k 15 % · 70–200k 20 % · 200–400k 22.5 % · 400k–1.2M 25 % · > 1.2M 27.5 % | Law 7/2024 |
| High-income schedules (lower brackets withdrawn) | > 600k–700k: 10 % up to 55k then standard (25 % above 400k) · > 700k–800k: 15 % up to 70k … · > 800k–900k: 20 % up to 200k … · > 900k–1.2M: 22.5 % up to 400k, 25 % above · > 1.2M: 25 % up to 1.2M, 27.5 % above | Law 7/2024 |

| Martyrs' Fund | 5 / 10,000 (0.05 %) of the monthly salary, withheld by the employer (all employees under the Labour Law except irregular / daily workers) | Law 16/2018 art. 8 as amended by Law 4/2021 (3 Mar 2021) — https://manshurat.org/node/71357 · summary: https://eg.andersen.com/martyrs-victims-fund-tax/ |
| Universal health insurance | employee 1 % of the insurable wage; employer 4 %, at least 50 EGP / month | Law 2/2018 art. 40 and Table 1 — https://manshurat.org/node/63712 |

Verify against current law before relying on it (the rules are editable and versioned for exactly this reason). Not modelled: UHI contributions for non-working spouse / dependants (3 % / 1 % per dependant, paid by the employee), the UHI 0.25 % solidarity contribution on company revenue, special tax exemptions (disability, etc.).

### Multi-currency / تعدد العملات

* Base currency of the books is **EGP** (`Company.baseCurrency`). Cash boxes and bank accounts have a currency (fixed at creation). Expenses, payments, supplier invoices, treasury transactions, cheques, **subcontracts / projects (contract currency), contractor & client extracts, custodies, payrolls and manual journal entries** carry `currency` + `exchangeRate` (EGP per unit).
* **Rates:** per-company table (*Accounting → Exchange rates*, resource `exchange-rates`, module `accounting`). A document in a foreign currency takes the latest rate on or before its date unless a rate is entered; no rate → 422.
* **Posting:** amounts are converted to EGP; each journal line keeps `currency`, `fxAmount` (original amount) and `exchangeRate` (shown in the entry view). Rounding is absorbed so entries always balance. The cash box / bank account must be in the document currency (transfers are same-currency). Paying a foreign-currency supplier invoice or contractor extract, or receiving a client extract, at a different rate settles the balance at the document rate and posts the difference to *Foreign exchange differences* (5206) — realized gain/loss.
* **Extracts** follow the currency of their subcontract (contractor) or project (client); payments/receipts against them must be in the same currency. **Custody** takes the currency of the cash box it is paid from; expenses settled from a custody must be in its currency and use the custody's rate. **Payroll** is run per salary currency (`Employee.salaryCurrency`): a USD payroll contains only USD-paid employees; social insurance, UHI, Martyrs' Fund and salary tax are computed on the EGP equivalent (statutory limits and brackets are in EGP) and converted back. **Manual journal entries** may be entered in a foreign currency: lines are entered in that currency and posted in EGP at the entry rate.
* Bank accounts and cash boxes show the balance in their own currency (`fxBalance`) and the EGP equivalent. Cheques keep their original rate through their lifecycle; their bank charges are in the cheque currency.

### FX revaluation / إعادة تقييم العملات (unrealized gains & losses)

*Accounting → FX revaluation* (resource `fx-revaluations`; run needs `accounting:approve`, preview `accounting:view`). On a closing date every open foreign-currency balance of the monetary accounts — cash & bank, AR, retention receivable, contractor advances, custody, notes receivable / cheques under collection, supplier & contractor payables, retention payable, salaries payable, client advances, notes payable — is grouped by account × party × currency and revalued at the closing rate (latest rate-table rate on or before the date, overridable per currency). The difference between the revalued and the book EGP amount is posted per bucket against *Unrealized FX gains/losses* (5207), `sourceType=FX_REVALUATION`, number `FXR-…`. Currency balances (`fxAmount`) are not changed. By default the entry is **auto-reversed the next day** (the usual reversing method, so later realized differences stay correct); with auto-reverse off it can be reversed manually (`reverse` action). Runs must be chronological and a previous revaluation must be reversed before a new one. `GET /api/fx-revaluations/preview?companyId=&date=[&rate.USD=48.1]` shows what would be posted. The seed runs auto-reversed revaluations at 31 Aug and 30 Sep 2026 for each company. Non-monetary items, revenue and expenses stay at historical rates (IAS 21 / EAS 13).

### Procurement link

Quotation lines reference purchase-request items by id (`QuotationItem.requestItemId`, required FK); duplicates or items from another request are rejected, quantity/description default from the request item, request items are locked once quoted, the comparison matches by id only, and PO lines keep `requestItemId` / `quotationItemId`.

* Extract maths: cumulative → previous (sum of posted extracts on the contract/project) → current; retention %, tax %, insurance %, advance-recovery % from the contract/project; only one unposted extract per contract; the chain is re-verified at posting.

---

## 5. صفحات النظام / UI routes

| Route | Content |
|---|---|
| `/login` | Sign-in (Arabic/English) |
| `/dashboard` | GM KPIs (companies, projects, contract value, extracts, payments, receivables, revenue, expenses, profit, delayed projects, contractors/suppliers owed, cash) + charts |
| `/companies` | Construction companies (creating one sets up its COA, HQ cost center and main cash box) |
| `/projects` | Projects (budget/actual/revenue/profit/delay) · Clients (+ statement) |
| `/accounting` | Overview · Trial balance · Ledger · Balance sheet · Cash flow · Exchange rates |
| `/periods` | Fiscal years, monthly periods, close checklist, close / reopen |
| `/journal-entries` | Journal entries with lines editor, balance check, workflow |
| `/accounts` | Account tree with rolled-up balances · Accounts CRUD · Cost centers |
| `/suppliers` | Suppliers (+ statement) · Supplier invoices · AP aging |
| `/contractors` | Contractors (+ statement with running balance) · Subcontracts · Retention · Advances |
| `/client-extracts` | Client extracts with live calculation · report · AR aging |
| `/contractor-extracts` | Contractor extracts with live calculation · report |
| `/expenses` | Expenses · Custody (عهد) with settlement · expenses report |
| `/treasury` | Treasury transactions · Payments & receipts · Cash boxes |
| `/banks` | Bank accounts (balance in currency + EGP) · Bank transactions · Cheques (lifecycle actions & movement history) · Bank reconciliation |
| `/procurement` | Purchase requests (+ quotation comparison) · Quotations · POs · Goods receipts |
| `/cost-accounting` | Budget vs actual · Project cost · Profitability · Budgets |
| `/hr` | Employees · Departments · Positions · Contracts · Attendance · Leave · Overtime/bonuses/deductions · Cost allocations |
| `/payroll` | Payroll runs (per company or project) with lines & allocations · Payroll rules (insurance, tax brackets, calculator) |
| `/reports` | Reports center (filters, CSV, print) |
| `/documents` | Attachments library (upload/download) |
| `/notifications` | Notifications |
| `/approvals` | Approval inbox (mine / all) |
| `/settings` | Users (company/project access) · Permission matrix · Workflows |
| `/audit-log` | Audit log with before/after JSON, CSV |

All list pages: search, filters, date range, paging, CSV export, detail drawer (fields, lines, linked journal entry, approval history, attachments), create/edit forms, lifecycle buttons according to permission and status.

---

## 6. واجهات API / API endpoints

All responses are JSON `{ "data": … }` or `{ "error": { "code", "message", "details" } }` (400 validation, 401, 403, 404, 409, 422 business rule). Auth via the `ccs_session` HttpOnly cookie (or `Authorization: Bearer <token>`). Mutating requests with a foreign `Origin` are rejected (CSRF). List endpoints accept `companyId, projectId, q, page, pageSize, from, to, format=csv` and resource-specific filters.

| Method & path | Description |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Session |
| `GET /api/health` (`?deep=1` also checks storage) | Health check |
| `GET/PUT/DELETE /api/payroll-settings?companyId=` (`&date=` / `&id=`) | Payroll rules versions per company |
| `GET /api/fx-revaluations/preview?companyId=&date=` | FX revaluation preview |
| `GET/POST /api/companies` · `GET/PATCH/DELETE /api/companies/:id` | Companies |
| `GET/POST /api/users` · `GET/PATCH/DELETE /api/users/:id` | Users (DELETE = deactivate) |
| `GET/PUT /api/permissions` | Role × module × action matrix |
| `GET/PUT /api/workflows` | Approval workflows |
| `GET /api/:resource` · `POST /api/:resource` | List / create |
| `GET/PATCH/DELETE /api/:resource/:id` | Read (with `_extra`: journal entry, approvals, documents) / update / delete |
| `POST /api/:resource/:id/:action` | `submit`, `approve`, `reject`, `post`, `cancel`, `reverse` (documents) and custom actions |
| `GET /api/approvals?scope=mine|all` · `POST /api/approvals/:id` | Approval inbox / decision |
| `GET/PATCH /api/notifications` | List / mark read |
| `GET /api/audit-logs` | Audit log (`format=csv`) |
| `GET/POST /api/documents` · `GET/DELETE /api/documents/:id` | Attachments (multipart upload, download) |
| `GET /api/reports` · `GET /api/reports/:report` | Reports (`format=csv`) |
| `GET /api/dashboard` | Dashboard KPIs & chart data |
| `GET /api/lookups/:entity` | Dropdown data |
| `GET/POST /api/bank-reconciliation` | Reconciliation preview / save |
| `GET /api/procurement/comparison?requestId=` | Quotation comparison |
| `POST /api/extracts/preview` | Extract calculation preview |

**`:resource`** = `projects, clients, project-budgets, accounts, cost-centers, journal-entries, suppliers, supplier-invoices, contractors, subcontracts, contractor-extracts, client-extracts, expenses, custodies, payments, cash-boxes, bank-accounts, treasury-transactions, cheques, bank-reconciliations, purchase-requests, quotations, purchase-orders, goods-receipts, departments, positions, employees, employee-allocations, employee-contracts, attendance, leave-requests, hr-adjustments, payrolls, fiscal-years, accounting-periods, exchange-rates, fx-revaluations`.
Custom actions: `cheques/:id/collect|deposit|clear|bounce|cancel|represent` (body: `date, bankAccountId, charges, notes`), `accounting-periods/:id/checklist|close|reopen`, `fiscal-years/:id/close|reopen` (close posts the year-end closing entry, reopen reverses it), `fx-revaluations/:id/reverse`, `custodies/:id/settle`, `purchase-requests/:id/submit|close|cancel`, `quotations/:id/select|create-order`, `leave-requests/:id/approve|reject`, `payrolls/:id/recalculate`.

**`:report`** = `trial-balance, general-ledger (accountId), income-statement, balance-sheet (asOf), cash-flow, receivables (asOf), payables (asOf), project-profitability, project-cost, budget-vs-actual, contractor-statement (partyId), supplier-statement (partyId), client-statement (partyId), contractor-extracts, client-extracts, retention, advances, expenses, management-summary`.

**`:entity` (lookups)** = `projects, clients, suppliers, contractors, employees, accounts, cost-centers, cash-boxes, bank-accounts, subcontracts, supplier-invoices, contractor-extracts, client-extracts, custodies, purchase-requests, purchase-request-items, purchase-orders, departments, positions`.

---

## 7. البنية / Architecture

```
prisma/schema.prisma          data model (all tenant tables carry companyId + FK)
prisma/seed.ts                demo data through the real services
src/lib/                      shared: permissions matrix, money (decimal), errors, extract maths
src/server/auth.ts            bcrypt, sha256-hashed session tokens, login throttling
src/server/context.ts         request context: user, role, permissions, company & project scope
src/server/api.ts             route() wrapper: auth, error mapping (zod/prisma/ApiError), CSV
src/server/resources/         declarative resource engine (scoping, same-company FK checks, numbering, audit)
src/server/services/          accounting, posting rules, approval engine, payroll, reports, dashboard
src/server/storage.ts         storage abstraction: local disk + S3-compatible driver (per-document storageDriver)
src/server/services/periods.ts  fiscal years, period lock, year-end close, close checklist;  cheques.ts lifecycle;  fx.ts rates;  revaluation.ts FX revaluation
scripts/                      bootstrap.ts (prod bootstrap), migrate-deploy.mjs, start-prod.sh, smoke.ts, backup/restore
src/app/api/                  route handlers
src/app/(app)/                authenticated UI pages;  src/components/ generic UI;  src/ui/ module configs
src/i18n/dict.ts              Arabic / English dictionaries
tests/                        vitest unit + integration;  scripts/smoke.ts HTTP smoke tests
```

Audit log: every create/update/delete/submit/approve/reject/post/reverse/cancel/upload/login is recorded with user, entity, entityId, companyId, before/after JSON, timestamp and IP.

---

## 8. النسخ الاحتياطي والاستعادة / Backup & restore

```bash
./scripts/backup.sh /var/backups/ccs        # pg_dump -Fc + verification + uploads tar.gz, 14-day retention (RETENTION_DAYS)
./scripts/restore.sh /var/backups/ccs/ccs_20261002_020000.dump                    # into DATABASE_URL (asks for confirmation)
./scripts/restore.sh backups/ccs_….dump "postgresql://user:pass@host:5432/ccs_copy" # into another database
```

Cron (daily at 02:30):

```cron
30 2 * * * cd /opt/ccs && ./scripts/backup.sh /var/backups/ccs >> /var/log/ccs-backup.log 2>&1
```

Manual equivalents: `pg_dump --format=custom --no-owner -f ccs.dump "$DB"` and `pg_restore --clean --if-exists --no-owner -d "$DB" ccs.dump`. Copy backups off-server (e.g. `rclone`/`aws s3 cp`). The docker-compose file also includes a `backup` service that dumps nightly into `./backups`.

---

## 9. النشر / Production deployment

### A) Docker + docker-compose (app + PostgreSQL + nightly backups)

```bash
export POSTGRES_PASSWORD='a-strong-password'
docker compose up -d --build                       # migrations run automatically on start
SEED_ON_START=true docker compose up -d --build    # first run only, loads demo data (truncates tables!)
```

**Tested:** on 2026-10-02 `docker compose up -d --build` was run on Docker 26 / Compose v2.26: the image built, the app waited for the healthy DB, applied all migrations, seeded (`SEED_ON_START=true`), became `healthy`, and the full smoke suite passed against it (185/185). (The test host needed an extra iptables rule because of stale legacy rules — not a compose issue.)

The `Dockerfile` is multi-stage (node:22-bookworm-slim), runs `prisma migrate deploy` in `scripts/docker-entrypoint.sh` (then the non-destructive bootstrap when `ADMIN_EMAIL` is set, or the demo seed with `SEED_ON_START=true`), runs as a non-root user, stores uploads in the `/app/storage` volume and exposes a healthcheck on `/api/health`. Put a TLS reverse proxy (nginx/Caddy/Traefik) in front and set `COOKIE_SECURE=true`.

### B) VPS (Ubuntu) without Docker

```bash
sudo apt install -y postgresql nginx && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
# create role/database as in Quick start, then:
git clone <repo> /opt/ccs && cd /opt/ccs && npm ci && cp .env.example .env   # set DATABASE_URL, COOKIE_SECURE=true, SHOW_DEMO_ACCOUNTS=false
ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='…' npm run db:migrate && npm run db:bootstrap && npm run build
# systemd unit: ExecStart=/usr/bin/npm run start:prod   (migrate deploy + bootstrap + next start on $PORT)
#               WorkingDirectory=/opt/ccs  Restart=always  User=ccs
# nginx: proxy_pass http://127.0.0.1:3000; client_max_body_size 25m;  + certbot for HTTPS
# cron: scripts/backup.sh (see section 8)
```

### Managed hosts — common rules

* **Runtime:** Node ≥ 20.9 (`engines`), Node 22 recommended (`.nvmrc`, Docker image, Render `NODE_VERSION`). `tsx` is a runtime dependency (bootstrap), `prisma generate` runs on `postinstall`.
* **Database:** any PostgreSQL ≥ 14 (tested on 17). Set `DATABASE_URL` for the app — on Neon / Supabase the **pooled** URL — and the **direct** URL in `DIRECT_URL` (or `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`, which the Neon / Supabase integrations set automatically): migrations always use the direct one.
* **Migrations** run automatically: `vercel-build` (Vercel) and `start:prod` (Render, Railway, VPS) call `scripts/migrate-deploy.mjs` → `prisma migrate deploy`, which takes an advisory lock (safe with several instances) and never resets data. `SKIP_MIGRATIONS=true` disables it (e.g. preview deployments without a DB).
* **First start:** a fresh production database is empty — no demo data. `scripts/bootstrap.ts` (run by `vercel-build` / `start:prod`, or `npm run db:bootstrap`) creates the default role permissions and approval workflows if missing and the first SUPER_ADMIN from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (≥ 10 chars) if that email doesn't exist; it never changes existing data. Log in, create the companies, then users. Only for a demo instance: `npm run db:seed` against the DB (**truncates everything**).
* **Attachments:** set `S3_BUCKET` (+ `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` for R2 / Wasabi / MinIO) and the S3 driver is selected automatically. On an ephemeral filesystem (Vercel is detected; set `EPHEMERAL_FS=true` elsewhere) local uploads are refused with a clear error and `/api/health?deep=1` reports storage as failing, unless `ALLOW_EPHEMERAL_UPLOADS=true` (or a persistent volume with `UPLOAD_DIR`). Documents remember which driver stored them, so switching keeps old files readable.
* **Always set:** `COOKIE_SECURE=true`, `SHOW_DEMO_ACCOUNTS=false`. Health check: `GET /api/health` (DB) / `?deep=1` (DB + storage). Login throttling lives in PostgreSQL, so it is shared across instances.

### C) Vercel + Neon

1. **Neon:** create a project (region close to the Vercel region, e.g. `aws-eu-central-1` with `fra1`). Copy the *pooled* connection string (`…-pooler…`, add `?sslmode=require&pgbouncer=true&connection_limit=1` for serverless) and the *direct* one. Or install the Neon integration from the Vercel marketplace — it sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) for you.
2. **Vercel:** *Add New → Project* → import the repo. `vercel.json` already sets `npm ci` and `buildCommand: npm run vercel-build` (prisma generate → migrate deploy → bootstrap → next build) and region `fra1`.
3. **Environment variables** (Production, and Preview if previews get a DB branch): `DATABASE_URL`, `DIRECT_URL` (unless the integration set `DATABASE_URL_UNPOOLED`), `COOKIE_SECURE=true`, `SHOW_DEMO_ACCOUNTS=false`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `S3_BUCKET` + S3 credentials (the filesystem is ephemeral — uploads need S3/R2). For previews without a database set `SKIP_MIGRATIONS=true`.
4. Deploy, open `/api/health?deep=1`, log in with `ADMIN_EMAIL`. Remove `ADMIN_PASSWORD` afterwards if you like (the user already exists).

### D) Render (Blueprint, `render.yaml`)

1. *New → Blueprint* → select the repo. It creates the `ccs-erp` web service (Node 22, `npm ci && npm run build:prod`, start `npm run start:prod`, health check `/api/health`, Frankfurt) and a Render PostgreSQL 17 database wired into `DATABASE_URL`.
2. Fill the `sync: false` variables when prompted: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `S3_*` (Render's filesystem is ephemeral — `EPHEMERAL_FS=true` is preset; a paid persistent disk with `UPLOAD_DIR` pointing at it plus `ALLOW_EPHEMERAL_UPLOADS=true` is the alternative, single instance only).
3. **Neon instead of Render Postgres:** delete the `databases:` block and the `fromDatabase` entry, set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) by hand.
4. Each deploy runs pending migrations and the idempotent bootstrap at start.

### E) Railway (`railway.json`)

1. *New Project → Deploy from GitHub repo*; add a **PostgreSQL** service (or use Neon) and reference it in the app's variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (Railway's Postgres has no pooler, so no `DIRECT_URL` is needed; with Neon set both).
2. `railway.json` sets build `npm run build:prod`, start `npm run start:prod` (migrate deploy + bootstrap + `next start -p $PORT`), health check `/api/health`, restart on failure. The builder picks Node 22 from `.nvmrc` / `engines`.
3. Variables: `COOKIE_SECURE=true`, `SHOW_DEMO_ACCOUNTS=false`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and either `S3_*` or a Railway **volume** mounted at e.g. `/data` with `UPLOAD_DIR=/data/uploads`.
4. *Settings → Networking → Generate domain*.

---

## 10. الاختبارات / Testing

* `npm test` — vitest unit + integration tests (101 tests in 16 files + 2 S3 tests that need an endpoint): double-entry validation, posting & ledger effect, trial balance / balance sheet, reversal, tenant isolation, project restriction, RBAC, approval workflow, extract maths, payment limits, statements, **accounting-period locking & close/reopen rules, cheque lifecycle entries (collect/deposit/clear/bounce/cancel/represent, charges, paid-amount adjustments), payroll rules (Egyptian tax schedules incl. high-income, insurance limits, per-company settings, permissions), multi-currency (rate lookup, conversion & rounding, same-currency rules, realized FX difference, USD cheques), persistent login throttling, storage drivers & ephemeral-filesystem policy, quotation ↔ request-item links, year-end closing entry & reopen, fiscal-year date validation, cheque-paid expenses, multi-currency extracts / custody / payroll / manual entries, FX revaluation (preview, posting, chronology, reversal, permissions), effective-dated payroll rules with Martyrs' Fund & UHI, seed invariant: no cash/bank account ever overdrawn**. The S3 driver tests run against a real S3-compatible endpoint when `S3_TEST_ENDPOINT` is set (e.g. `docker run -p 9090:9090 -e initialBuckets=ccs-docs adobe/s3mock` and `S3_TEST_ENDPOINT=http://localhost:9090`), otherwise they are skipped.
* `npm run smoke` — 199 HTTP checks against a running server (logins for all users, every page and list endpoint, reports, tenant isolation, RBAC, CSRF, CRUD, journal workflow, extracts, onboarding, procurement chain, payroll, documents, bank reconciliation, **period lock, cheque lifecycle, payroll rules, multi-currency (USD subcontract / payroll / custody / manual entry), FX revaluation preview & permissions, year-end close, out-of-fiscal-year rejection, cheque-paid expenses, payroll rule versions, deep storage health, quotation-by-id, login throttle 429**). **It writes data — run `npm run db:seed` afterwards for a clean demo.**
* `npm run build` — production build with type checking and lint.

## 11. Known limitations

* **FX:** revaluation covers the monetary balance-sheet accounts listed above; tax/statutory payables are treated as EGP obligations. Bank reconciliation works on EGP book values. Seeded rates are illustrative, not official CBE rates (no automatic rate feed). Reports are in EGP only (no presentation-currency translation).
* **Year-end close** posts one closing entry to retained earnings; there is no separate opening-balance entry for the new year (balance-sheet accounts simply carry forward) and no dividend / profit-distribution workflow.
* **Cheques:** no cheque book / numbering ranges or printing.
* **Payroll:** UHI dependant contributions and the UHI revenue solidarity contribution are not modelled; no special tax exemptions; end-of-service / annual tax settlement not computed. Statutory values must be verified against current law.
* **Deployment:** the Vercel/Render/Railway guides and config files follow each host's documented build/start model, but were not deployed from this environment; what was exercised end-to-end is Docker and `npm run start:prod` against an empty PostgreSQL (migrations applied, bootstrap created the admin, login OK, re-run idempotent, deep health flags local storage on an ephemeral FS).
* The public preview runs on a Cloudflare *quick tunnel*, whose URL is temporary and changes if the tunnel restarts.
