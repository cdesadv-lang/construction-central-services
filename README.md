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
| `npm run db:migrate:dev` | Create a new migration during development |
| `npm run db:seed` | Truncate all tables and load demo data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `scripts/backup.sh [dir]` | pg_dump backup (+ uploads tarball), retention |
| `scripts/restore.sh <file.dump> [db_url]` | pg_restore a backup |

### Environment variables (`.env.example`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Prisma) |
| `TEST_DATABASE_URL` | Separate database for `npm test` (it is wiped & re-seeded) |
| `SESSION_TTL_HOURS` | Session lifetime (default 12) |
| `COOKIE_SECURE` | `true` behind HTTPS (Secure cookie) |
| `UPLOAD_DIR` | Local attachments directory (default `./storage/uploads`) |
| `MAX_UPLOAD_MB` | Upload size limit (default 20) |
| `SHOW_DEMO_ACCOUNTS` | Show demo-account shortcuts on the login page (`false` in production) |
| `LOGIN_MAX_FAILURES` / `LOGIN_MAX_FAILURES_PER_EMAIL` / `LOGIN_MAX_FAILURES_PER_IP` | Failed logins before a lock (defaults 10 per email+IP, 30 per email, 50 per IP) |
| `LOGIN_WINDOW_MINUTES` / `LOGIN_LOCK_MINUTES` | Counting window and lock duration (default 15 / 15) |
| `STORAGE_DRIVER` | `local` (default, `UPLOAD_DIR`) or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX`, `S3_SSE` | S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Wasabi…). `S3_ENDPOINT` empty = AWS |

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
| Expense | Dr project cost / expense (by type) — Cr cash box / bank / custody / supplier (credit) |
| Supplier invoice | Dr cost or expense + Dr VAT input — Cr supplier payable |
| Supplier / contractor payment | Dr payable — Cr cash/bank (limited to the remaining balance of the linked invoice/extract) |
| Contractor advance | Dr contractor advances — Cr cash/bank |
| Client receipt | Dr cash/bank — Cr AR |
| Contractor extract | Dr subcontractor cost (current work) — Cr contractor payable (net), retention payable, WHT payable, insurance payable, advance recovery, penalties income |
| Client extract | Dr AR (net), retention receivable, WHT receivable, client insurance/deductions — Cr contract revenue (work value) |
| Payroll | Dr labor cost per allocated project / admin salaries + company insurance — Cr salaries payable, insurance & tax payables, deductions |
| Treasury | Cash/bank receipts, payments, transfers, deposits, withdrawals |
| Custody | Dr employee custody — Cr cash box; settlement returns the remainder and closes it |

### Accounting periods & month-end close / الفترات المحاسبية والإقفال

* `FiscalYear` (per company, any start month) with 12 monthly `AccountingPeriod`s (`OPEN` / `CLOSED`). Page **/periods**; resources `fiscal-years` and `accounting-periods` (actions `checklist`, `close`, `reopen`).
* **Lock:** creating, editing, deleting, submitting, approving or posting any ledger document or journal entry dated in a closed period is rejected (422) — enforced both in the ledger layer (`createJournalEntry`, draft-entry edits, posting) and in the document engine (payroll uses the month end). Reversals of documents from a closed period are dated today. Dates outside any defined fiscal year are treated as open.
* **Close checklist** (per period): automatic blocking checks — previous period closed, no unposted documents (draft / pending / approved) dated in the period, period trial balance balanced; automatic warnings — payroll posted for the month, bank accounts reconciled to the period end, received cheques due in the period still in hand; required manual items — accruals, depreciation, inventory/WIP, review & sign-off.
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

### Payroll rules / قواعد الرواتب (per company, editable)

*Payroll → Payroll rules* (`GET/PUT /api/payroll-settings?companyId=`, edit needs `payroll:approve`, audit-logged, validated) — employee / employer social-insurance %, monthly minimum / maximum insurable wage, annual personal exemption, the salary-tax bracket table, the high-income schedules, overtime multiplier, hours/days per month, and whether absence/penalty deductions reduce taxable income. A live calculator shows the effect before saving. Each payroll line: insurance on the insurable wage clamped to [min, max] (0 = not insured); monthly tax = annual tax on (12 × monthly taxable − personal exemption) ÷ 12.

Seeded defaults (Egypt, 2026) and sources:

| Rule | Value | Source |
|---|---|---|
| Social insurance shares | employee 11 %, employer 18.75 % of the insurable wage | Social Insurance & Pensions Law 148/2019 |
| Insurable wage limits from 1 Jan 2026 | min 2,700 EGP / max 16,700 EGP per month | NOSI announcement 30/11/2025 — https://www.nosi.gov.eg/ar/News/Pages/2025-11-30.aspx |
| Personal exemption | 20,000 EGP / year | Income Tax Law 91/2005 as amended by Law 7/2024 — https://eta.gov.eg/sites/default/files/2024-03/law_no.7-2024.pdf |
| Salary-tax brackets (annual taxable income) | 0–40k 0 % · 40–55k 10 % · 55–70k 15 % · 70–200k 20 % · 200–400k 22.5 % · 400k–1.2M 25 % · > 1.2M 27.5 % | Law 7/2024 |
| High-income schedules (lower brackets withdrawn) | > 600k–700k: 10 % up to 55k then standard (25 % above 400k) · > 700k–800k: 15 % up to 70k … · > 800k–900k: 20 % up to 200k … · > 900k–1.2M: 22.5 % up to 400k, 25 % above · > 1.2M: 25 % up to 1.2M, 27.5 % above | Law 7/2024 |

Verify against current law before relying on it (the table is editable for exactly this reason). Not modelled: the Martyrs' Fund 0.05 % contribution, special exemptions (disability, etc.), comprehensive health-insurance contributions.

### Multi-currency / تعدد العملات (basics)

* Base currency of the books is **EGP** (`Company.baseCurrency`). Cash boxes and bank accounts have a currency (fixed at creation). Expenses, payments, supplier invoices, treasury transactions and cheques carry `currency` + `exchangeRate` (EGP per unit).
* **Rates:** per-company table (*Accounting → Exchange rates*, resource `exchange-rates`, module `accounting`). A document in a foreign currency takes the latest rate on or before its date unless a rate is entered; no rate → 422.
* **Posting:** amounts are converted to EGP; each journal line keeps `currency`, `fxAmount` (original amount) and `exchangeRate` (shown in the entry view). Rounding is absorbed so entries always balance. The cash box / bank account must be in the document currency (transfers are same-currency). Extracts are EGP-only. Paying a foreign-currency supplier invoice at a different rate settles the payable at the invoice rate and posts the difference to *Foreign exchange differences* (5206) — realized gain/loss.
* Bank accounts and cash boxes show the balance in their own currency (`fxBalance`) and the EGP equivalent. Cheques keep their original rate through their lifecycle; their bank charges are in the cheque currency.

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
| `GET/PUT /api/payroll-settings?companyId=` | Payroll rules per company |
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

**`:resource`** = `projects, clients, project-budgets, accounts, cost-centers, journal-entries, suppliers, supplier-invoices, contractors, subcontracts, contractor-extracts, client-extracts, expenses, custodies, payments, cash-boxes, bank-accounts, treasury-transactions, cheques, bank-reconciliations, purchase-requests, quotations, purchase-orders, goods-receipts, departments, positions, employees, employee-allocations, employee-contracts, attendance, leave-requests, hr-adjustments, payrolls, fiscal-years, accounting-periods, exchange-rates`.
Custom actions: `cheques/:id/collect|deposit|clear|bounce|cancel|represent` (body: `date, bankAccountId, charges, notes`), `accounting-periods/:id/checklist|close|reopen`, `fiscal-years/:id/close|reopen`, `custodies/:id/settle`, `purchase-requests/:id/submit|close|cancel`, `quotations/:id/select|create-order`, `leave-requests/:id/approve|reject`, `payrolls/:id/recalculate`.

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
src/server/services/periods.ts  fiscal years, period lock, close checklist;  cheques.ts lifecycle;  fx.ts rates
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

The `Dockerfile` is multi-stage (node:20-bookworm-slim), runs `prisma migrate deploy` in `scripts/docker-entrypoint.sh`, runs as a non-root user, stores uploads in the `/app/storage` volume and exposes a healthcheck on `/api/health`. Put a TLS reverse proxy (nginx/Caddy/Traefik) in front and set `COOKIE_SECURE=true`.

### B) VPS (Ubuntu) without Docker

```bash
sudo apt install -y postgresql nginx && curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
# create role/database as in Quick start, then:
git clone <repo> /opt/ccs && cd /opt/ccs && npm ci && cp .env.example .env   # set DATABASE_URL, COOKIE_SECURE=true, SHOW_DEMO_ACCOUNTS=false
npm run db:migrate && npm run build
# systemd unit: ExecStart=/usr/bin/npm start  WorkingDirectory=/opt/ccs  Restart=always  User=ccs
# nginx: proxy_pass http://127.0.0.1:3000; client_max_body_size 25m;  + certbot for HTTPS
# cron: scripts/backup.sh (see section 8)
```

### C) Vercel + managed PostgreSQL (Neon / Supabase / RDS)

1. Create the managed database; set `DATABASE_URL` (use the pooled URL for the app; run migrations with the direct URL: `DATABASE_URL=<direct> npx prisma migrate deploy`).
2. Import the repo in Vercel; set env vars (`DATABASE_URL`, `COOKIE_SECURE=true`, `SHOW_DEMO_ACCOUNTS=false`).
3. **Attachments:** Vercel's filesystem is ephemeral — set `STORAGE_DRIVER=s3` with an S3-compatible bucket (S3, R2, …). Documents remember which driver stored them, so existing local files stay readable after switching.
4. Login throttling is stored in PostgreSQL (`LoginThrottle`), so it is shared across instances.

---

## 10. الاختبارات / Testing

* `npm test` — vitest unit + integration tests (85 tests in 14 files): double-entry validation, posting & ledger effect, trial balance / balance sheet, reversal, tenant isolation, project restriction, RBAC, approval workflow, extract maths, payment limits, statements, **accounting-period locking & close/reopen rules, cheque lifecycle entries (collect/deposit/clear/bounce/cancel/represent, charges, paid-amount adjustments), payroll rules (Egyptian tax schedules incl. high-income, insurance limits, per-company settings, permissions), multi-currency (rate lookup, conversion & rounding, same-currency rules, realized FX difference, USD cheques), persistent login throttling, storage drivers, quotation ↔ request-item links**. The S3 driver tests run against a real S3-compatible endpoint when `S3_TEST_ENDPOINT` is set (e.g. `docker run -p 9090:9090 -e initialBuckets=ccs-docs adobe/s3mock` and `S3_TEST_ENDPOINT=http://localhost:9090`), otherwise they are skipped.
* `npm run smoke` — 185 HTTP checks against a running server (logins for all users, every page and list endpoint, reports, tenant isolation, RBAC, CSRF, CRUD, journal workflow, extracts, onboarding, procurement chain, payroll, documents, bank reconciliation, **period lock, cheque lifecycle, payroll rules, multi-currency, quotation-by-id, login throttle 429**). **It writes data — run `npm run db:seed` afterwards for a clean demo.**
* `npm run build` — production build with type checking and lint.

## 11. Known limitations

* **FX:** no revaluation of open foreign-currency balances at period end and no unrealized gains/losses; realized differences are posted only when a foreign-currency supplier invoice is paid at a different rate (cheques keep their original rate through clearing; bouncing a cheque issued against an FX invoice restores the payable at the payment rate). Extracts, payroll, custody and manual journal entries are EGP-only. Seeded rates are illustrative, not official CBE rates. Bank reconciliation works on EGP book values.
* **Periods:** closing a fiscal year locks it but does not generate a year-end closing entry to retained earnings; dates outside any defined fiscal year are open.
* **Cheques:** an expense paid with method `CHEQUE` still credits the bank directly (use a payment or a stand-alone cheque for the full lifecycle); no cheque book / numbering ranges or printing.
* **Payroll rules** are one current rule set per company (no effective-dated history; posted payrolls keep their computed amounts). Not modelled: Martyrs' Fund contribution, special exemptions, comprehensive health-insurance contribution.
* The AWS SDK v3 warns that Node 20 support ends in 2026; plan a Node 22 upgrade.
* The public preview runs on a Cloudflare *quick tunnel*, whose URL is temporary and changes if the tunnel restarts.
