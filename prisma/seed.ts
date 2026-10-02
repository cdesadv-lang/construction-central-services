/* eslint-disable @typescript-eslint/no-explicit-any */
// Realistic Egyptian demo data. All operational documents go through the real resource engine,
// approval workflow and posting rules, so every journal entry is generated exactly as in production.
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultPermissions } from "../src/lib/permissions";
import { DEFAULT_WORKFLOWS as WORKFLOWS } from "../src/server/default-workflows";
import { setupCompanyAccounts, accountIdByKey } from "../src/server/services/accounting";
import { buildContext, type Ctx } from "../src/server/context";
import { createDefaultPayrollSettings, STATUTORY_SOURCE_NOTE_2025 } from "../src/server/services/payroll";
import { EGYPT_2025_RULES } from "../src/lib/payroll-rules";
import { RESOURCES } from "../src/server/resources";
import { actionResource, createResource } from "../src/server/resources/engine";
import { prisma as appPrisma } from "../src/lib/db";

const prisma: PrismaClient = appPrisma;
const DEMO_PASSWORD = "Demo@12345";
const ADMIN_PASSWORD = "Admin@12345";

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

const late0 = (pr: any) => pr.seed.start >= "2025-12-01";
const d = (s: string) => new Date(s + "T10:00:00Z");
const ctxByRole: Partial<Record<Role, Ctx>> = {};

async function create(ctx: Ctx, res: string, body: any) {
  return createResource(RESOURCES[res], ctx, body);
}
async function act(ctx: Ctx, res: string, id: string, action: string, body: any = {}) {
  return actionResource(RESOURCES[res], ctx, id, action, body);
}
/** submit -> every workflow step approved by the matching role */
async function approve(res: string, id: string, submitter: Ctx) {
  await act(submitter, res, id, "submit");
  const docType = RESOURCES[res].docType!;
  for (let i = 0; i < 10; i++) {
    const req = await prisma.approvalRequest.findFirst({ where: { docType, docId: id, status: "PENDING" } });
    if (!req) break;
    const step = (req.steps as any[])[req.currentStep - 1];
    const approver = ctxByRole[step.role as Role]!;
    await act(approver, res, id, "approve", { comment: "تمت المراجعة والموافقة" });
  }
}
async function post(res: string, id: string, submitter: Ctx) {
  await approve(res, id, submitter);
  return act(ctxByRole.FINANCE_MANAGER!, res, id, "post");
}


interface CompanySeed {
  code: string;
  name: string;
  nameEn: string;
  cr: string;
  tax: string;
  address: string;
  phone: string;
  email: string;
  contact: string;
  pkg: "BASIC" | "STANDARD" | "PREMIUM";
  clients: [string, string][];
  projects: { code: string; name: string; client: number; value: number; budget: number; start: string; end: string; pm: string; consultant: string; location: string; status: any; pct: number }[];
  suppliers: [string, string, string][];
  contractors: [string, string][];
  employees: [string, string, number, number][]; // name, position, basic, allowances
  banks: [string, string, string][];
}

const COMPANIES: CompanySeed[] = [
  {
    code: "NILE",
    name: "شركة مقاولات النيل",
    nameEn: "Nile Contracting Co.",
    cr: "س.ت 145872 - القاهرة",
    tax: "512-874-369",
    address: "15 شارع التسعين الشمالي، التجمع الخامس، القاهرة الجديدة",
    phone: "02-25678901",
    email: "info@nile-contracting.eg",
    contact: "م. حسام الدين فؤاد",
    pkg: "PREMIUM",
    clients: [
      ["هيئة المجتمعات العمرانية الجديدة", "200-145-778"],
      ["محافظة الجيزة - مديرية الطرق", "200-556-120"],
      ["شركة العاصمة الإدارية للتنمية العمرانية", "200-874-001"],
    ],
    projects: [
      { code: "NIL-P01", name: "إنشاء مجمع سكني 24 عمارة - التجمع الخامس", client: 0, value: 85_000_000, budget: 70_000_000, start: "2025-09-01", end: "2027-06-30", pm: "م. كريم عبد العزيز", consultant: "دار الهندسة", location: "القاهرة الجديدة", status: "ACTIVE", pct: 35 },
      { code: "NIL-P02", name: "تطوير طريق الواحات - المرحلة الثانية", client: 1, value: 42_000_000, budget: 35_500_000, start: "2025-06-01", end: "2026-08-31", pm: "م. وليد منصور", consultant: "المكتب العربي للتصميمات", location: "الجيزة - طريق الواحات", status: "ACTIVE", pct: 72 },
      { code: "NIL-P03", name: "مبنى إداري 12 طابق - العاصمة الإدارية", client: 2, value: 120_000_000, budget: 98_000_000, start: "2026-11-01", end: "2028-10-31", pm: "م. شريف الجمال", consultant: "إيجي كونسلت", location: "العاصمة الإدارية - الحي الحكومي", status: "PLANNING", pct: 0 },
    ],
    suppliers: [
      ["شركة حديد عز", "100-200-300", "حديد تسليح"],
      ["شركة أسمنت السويس", "100-200-301", "أسمنت"],
      ["المصرية للخرسانة الجاهزة", "100-200-302", "خرسانة جاهزة"],
    ],
    contractors: [
      ["مؤسسة الأمل للمقاولات الكهربائية", "أعمال كهرباء"],
      ["شركة الفتح للأعمال الصحية", "أعمال صحية وسباكة"],
      ["مقاولات الصفا للنجارة المسلحة", "نجارة مسلحة وشدات"],
    ],
    employees: [
      ["محمد إبراهيم سالم", "مهندس موقع", 18000, 4000],
      ["أحمد سمير عبد الله", "مشرف تنفيذ", 12000, 2500],
      ["خالد محمود حسن", "محاسب موقع", 11000, 2000],
      ["مصطفى علي رمضان", "أمين مخزن", 8500, 1500],
      ["ياسر عبد الفتاح", "سائق معدات", 7500, 1500],
      ["هبة الله أحمد", "مسؤولة إدارية", 9000, 1500],
    ],
    banks: [
      ["البنك الأهلي المصري", "فرع التجمع الخامس", "1203040506070"],
      ["بنك مصر", "فرع مدينة نصر", "4401002003004"],
    ],
  },
  {
    code: "MODERN",
    name: "شركة البناء الحديث",
    nameEn: "Modern Building Co.",
    cr: "س.ت 98451 - الإسكندرية",
    tax: "623-115-480",
    address: "42 طريق الحرية، سموحة، الإسكندرية",
    phone: "03-4251122",
    email: "contact@modern-building.eg",
    contact: "أ. نادر صبحي",
    pkg: "STANDARD",
    clients: [
      ["شركة سموحة للاستثمار العقاري", "300-410-552"],
      ["مدارس النخبة الدولية", "300-410-990"],
      ["شركة بالم هيلز للتعمير", "300-411-120"],
    ],
    projects: [
      { code: "MOD-P01", name: "برج سكني 18 طابق - سموحة", client: 0, value: 64_000_000, budget: 52_000_000, start: "2025-10-15", end: "2027-04-30", pm: "م. عمرو الشناوي", consultant: "مكتب الإسكندرية الاستشاري", location: "الإسكندرية - سموحة", status: "ACTIVE", pct: 48 },
      { code: "MOD-P02", name: "مدرسة دولية - الشيخ زايد", client: 1, value: 28_500_000, budget: 24_000_000, start: "2025-08-01", end: "2026-09-15", pm: "م. رامي فكري", consultant: "الاستشاري المصري", location: "الشيخ زايد", status: "ACTIVE", pct: 80 },
      { code: "MOD-P03", name: "فيلات كمبوند - 6 أكتوبر", client: 2, value: 51_000_000, budget: 43_000_000, start: "2024-09-01", end: "2026-06-30", pm: "م. سامح يوسف", consultant: "ACE مهندسون استشاريون", location: "6 أكتوبر", status: "COMPLETED", pct: 100 },
    ],
    suppliers: [
      ["مصنع الجوهرة للسيراميك", "100-300-400", "سيراميك وبورسلين"],
      ["شركة السويدي للكابلات", "100-300-401", "كابلات"],
      ["شركة بيتون للخرسانة", "100-300-402", "خرسانة جاهزة"],
    ],
    contractors: [
      ["شركة النور للتشطيبات", "تشطيبات وديكور"],
      ["مقاولات الإخلاص للعزل", "أعمال عزل"],
    ],
    employees: [
      ["عمر حسن البنا", "مهندس موقع", 17000, 3500],
      ["إسلام فاروق", "مشرف تنفيذ", 11500, 2000],
      ["سارة محمود", "محاسبة", 10500, 2000],
      ["طارق عادل", "فني مساحة", 9000, 1500],
      ["محمود جمال", "حارس موقع", 6000, 1000],
    ],
    banks: [
      ["البنك التجاري الدولي CIB", "فرع سموحة", "100023456789"],
      ["بنك القاهرة", "فرع محطة الرمل", "2210334455"],
    ],
  },
  {
    code: "UNITED",
    name: "شركة الإنشاءات المتحدة",
    nameEn: "United Constructions Co.",
    cr: "س.ت 77120 - الجيزة",
    tax: "734-226-591",
    address: "8 شارع جامعة الدول العربية، المهندسين، الجيزة",
    phone: "02-33445566",
    email: "info@united-cons.eg",
    contact: "د. مجدي الحسيني",
    pkg: "PREMIUM",
    clients: [
      ["الشركة القابضة لمياه الشرب والصرف الصحي", "400-510-111"],
      ["وزارة الصحة والسكان", "400-510-222"],
      ["محافظة الدقهلية", "400-510-333"],
    ],
    projects: [
      { code: "UNI-P01", name: "محطة معالجة مياه - بني سويف", client: 0, value: 96_000_000, budget: 80_000_000, start: "2026-01-10", end: "2027-12-31", pm: "م. أيمن رشاد", consultant: "شركة المهندسون المتحدون", location: "بني سويف", status: "ACTIVE", pct: 22 },
      { code: "UNI-P02", name: "مستشفى عام 200 سرير - أسيوط", client: 1, value: 140_000_000, budget: 118_000_000, start: "2026-02-01", end: "2028-06-30", pm: "م. هشام القاضي", consultant: "دار الهندسة", location: "أسيوط", status: "ACTIVE", pct: 15 },
      { code: "UNI-P03", name: "كوبري علوي - المنصورة", client: 2, value: 37_000_000, budget: 31_000_000, start: "2025-07-01", end: "2026-07-31", pm: "م. باسم عطية", consultant: "مكتب الدلتا الاستشاري", location: "المنصورة", status: "SUSPENDED", pct: 40 },
    ],
    suppliers: [
      ["شركة بشاي للصلب", "100-400-500", "حديد تسليح"],
      ["أسمنت العريش", "100-400-501", "أسمنت"],
      ["المقاولون العرب للمعدات", "100-400-502", "تأجير معدات"],
    ],
    contractors: [
      ["شركة الدلتا للأعمال الميكانيكية", "أعمال ميكانيكية"],
      ["مؤسسة الرواد للحفر والردم", "حفر وردم"],
      ["شركة الصعيد للخرسانات", "أعمال خرسانية"],
    ],
    employees: [
      ["حسن عبد الحليم", "مدير مشروع", 25000, 6000],
      ["رضا شوقي", "مهندس موقع", 16000, 3000],
      ["إيمان سعيد", "محاسبة موقع", 10000, 2000],
      ["كمال نجيب", "مشرف معدات", 9500, 1500],
      ["عبد الرحيم صالح", "عامل فني", 6500, 1000],
      ["نادية فهمي", "سكرتارية", 7000, 1000],
    ],
    banks: [
      ["البنك الأهلي المصري", "فرع المهندسين", "1209988776655"],
      ["بنك الإسكندرية", "فرع الدقي", "3305566778"],
    ],
  },
];

/** Lowest running balance of a cash/bank account over time (EGP; in currency for foreign accounts). */
async function runningMin(companyId: string, accountId: string) {
  const rows = await prisma.$queryRaw<{ min: number | null }[]>`
    SELECT MIN(run)::float AS min FROM (
      SELECT SUM(amt) OVER (ORDER BY date) AS run FROM (
        SELECT e."date", SUM(CASE WHEN l."currency" IS NOT NULL AND l."currency" <> 'EGP'
                                  THEN (CASE WHEN l."debit" > 0 THEN l."fxAmount" ELSE -l."fxAmount" END)
                                  ELSE l."debit" - l."credit" END) AS amt
        FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
        WHERE e."companyId" = ${companyId} AND e."status" = 'POSTED' AND l."accountId" = ${accountId}
        GROUP BY e."date") d) r`;
  return Number(rows[0]?.min ?? 0);
}

async function main() {
  console.log("Resetting database...");
  await reset();
  await prisma.rolePermission.createMany({ data: defaultPermissions() });
  for (const w of WORKFLOWS) {
    await prisma.approvalWorkflow.create({
      data: { companyId: null, docType: w.docType, name: w.name, steps: { create: w.steps.map(([name, role], i) => ({ order: i + 1, name, role })) } },
    });
  }

  // Central services firm + client construction companies
  const central = await prisma.company.create({
    data: {
      code: "CCS",
      name: "مركز الخدمات المالية والإدارية لشركات المقاولات",
      nameEn: "Construction Central Services",
      commercialRegister: "س.ت 200100 - القاهرة",
      taxNumber: "450-100-200",
      address: "برج المهندسين، شارع شهاب، المهندسين، الجيزة",
      phone: "02-37600000",
      email: "info@ccs.eg",
      contactPerson: "أ. عادل منير",
      servicePackage: "PREMIUM",
      contractStart: d("2024-01-01"),
    },
  });
  await createDefaultPayrollSettings(prisma, central.id);
  await setupCompanyAccounts(prisma, central.id);
  const companies: any[] = [];
  for (const c of COMPANIES) {
    const co = await prisma.company.create({
      data: {
        code: c.code, name: c.name, nameEn: c.nameEn, commercialRegister: c.cr, taxNumber: c.tax, address: c.address, phone: c.phone, email: c.email,
        contactPerson: c.contact, servicePackage: c.pkg, contractStart: d("2025-01-01"), contractEnd: d("2027-12-31"), status: "ACTIVE",
      },
    });
    await setupCompanyAccounts(prisma, co.id);
    // payroll rules versions: 2025 (NOSI limits 2,300/14,500) and 2026 (2,700/16,700)
    await createDefaultPayrollSettings(prisma, co.id, { effectiveFrom: "2025-01-01", rules: EGYPT_2025_RULES, sourceNote: STATUTORY_SOURCE_NOTE_2025 });
    await createDefaultPayrollSettings(prisma, co.id);
    await prisma.costCenter.create({ data: { companyId: co.id, code: "CC-HQ", name: "الإدارة العامة" } });
    companies.push({ ...co, seed: c });
  }
  const [nile, modern, united] = companies;
  const allIds = companies.map((c) => c.id);

  // Users
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const users: { email: string; name: string; nameEn: string; role: Role; all?: boolean; companies?: string[] }[] = [
    { email: "admin@ccs.local", name: "مدير النظام", nameEn: "System Administrator", role: "SUPER_ADMIN", all: true },
    { email: "gm@ccs.local", name: "م. أحمد عبد الرحمن", nameEn: "Ahmed Abdelrahman (GM)", role: "GENERAL_MANAGER", all: true },
    { email: "cfo@ccs.local", name: "أ. محمود السيد", nameEn: "Mahmoud ElSayed (CFO)", role: "FINANCE_MANAGER", all: true },
    { email: "chief@ccs.local", name: "أ. طارق فهمي", nameEn: "Tarek Fahmy (Chief Accountant)", role: "CHIEF_ACCOUNTANT", companies: [central.id, ...allIds] },
    { email: "acc.nile@ccs.local", name: "أ. مينا جرجس", nameEn: "Mina Girgis (Accountant - Nile)", role: "ACCOUNTANT", companies: [nile.id] },
    { email: "acc.modern@ccs.local", name: "أ. دينا كمال", nameEn: "Dina Kamal (Accountant - Modern/United)", role: "ACCOUNTANT", companies: [modern.id, united.id] },
    { email: "site.nile@ccs.local", name: "أ. حمدي شعبان", nameEn: "Hamdy Shaaban (Site Accountant NIL-P01)", role: "ACCOUNTANT", companies: [nile.id] },
    { email: "extracts@ccs.local", name: "أ. ريهام عادل", nameEn: "Reham Adel (Extracts)", role: "EXTRACT_ACCOUNTANT", companies: allIds },
    { email: "cost@ccs.local", name: "أ. وائل نصر", nameEn: "Wael Nasr (Cost Accountant)", role: "COST_ACCOUNTANT", companies: allIds },
    { email: "treasury@ccs.local", name: "أ. سامي لطفي", nameEn: "Samy Lotfy (Treasury)", role: "TREASURY_ACCOUNTANT", companies: allIds },
    { email: "procurement@ccs.local", name: "أ. نهى رشدي", nameEn: "Noha Roshdy (Procurement)", role: "PROCUREMENT_OFFICER", companies: allIds },
    { email: "hr@ccs.local", name: "أ. منى حسين", nameEn: "Mona Hussein (HR)", role: "HR_OFFICER", companies: allIds },
    { email: "controller@ccs.local", name: "أ. هاني بدر", nameEn: "Hany Badr (Financial Controller)", role: "FINANCIAL_CONTROLLER", all: true },
    { email: "viewer@ccs.local", name: "مراجع خارجي", nameEn: "External Viewer", role: "VIEWER", companies: [nile.id] },
  ];
  const created: Record<string, any> = {};
  for (const u of users) {
    created[u.email] = await prisma.user.create({
      data: {
        email: u.email, name: u.name, nameEn: u.nameEn, role: u.role, allCompanies: !!u.all,
        passwordHash: u.role === "SUPER_ADMIN" ? adminHash : hash,
        companies: { create: (u.companies ?? []).map((companyId) => ({ companyId })) },
      },
    });
  }
  const ctx = async (email: string) => buildContext(created[email], "127.0.0.1");
  const admin = await ctx("admin@ccs.local");
  ctxByRole.CHIEF_ACCOUNTANT = await ctx("chief@ccs.local");
  ctxByRole.FINANCE_MANAGER = await ctx("cfo@ccs.local");
  ctxByRole.GENERAL_MANAGER = await ctx("gm@ccs.local");
  const treasuryCtx = await ctx("treasury@ccs.local");
  const hrCtx = await ctx("hr@ccs.local");
  const procCtx = await ctx("procurement@ccs.local");
  const extractCtx = await ctx("extracts@ccs.local");
  const costCtx = await ctx("cost@ccs.local");
  const accByCompany: Record<string, Ctx> = { [nile.id]: await ctx("acc.nile@ccs.local"), [modern.id]: await ctx("acc.modern@ccs.local"), [united.id]: await ctx("acc.modern@ccs.local") };

  for (const co of companies) {
    const s: CompanySeed = co.seed;
    const acc = accByCompany[co.id];
    const C = { companyId: co.id };
    console.log(`Seeding ${s.name} ...`);

    // Treasury & banks (through engine so ledger sub-accounts are created)
    const mainCash = await create(admin, "cash-boxes", { ...C, name: "الخزينة الرئيسية", keeper: "أمين الخزينة" });
    const siteCash = await create(admin, "cash-boxes", { ...C, name: "خزينة المواقع", keeper: "محاسب الموقع" });
    const banks = [];
    for (const [bn, br, no] of s.banks) banks.push(await create(admin, "bank-accounts", { ...C, bankName: bn, branch: br, accountNumber: no, iban: `EG38${no.padStart(25, "0")}` }));

    // Opening balance entry: capital injection (manual JE through approval workflow)
    const capital = await accountIdByKey(prisma, co.id, "CAPITAL");
    const openingJe = await create(acc, "journal-entries", {
      ...C,
      date: "2025-07-01",
      description: "قيد افتتاحي - إيداع رأس المال بالبنوك والخزينة",
      lines: [
        { accountId: banks[0].accountId, debit: 30_000_000, description: "رصيد افتتاحي بنك" },
        { accountId: banks[1].accountId, debit: 12_000_000, description: "رصيد افتتاحي بنك" },
        { accountId: mainCash.accountId, debit: 800_000, description: "رصيد افتتاحي خزينة" },
        { accountId: capital, credit: 42_800_000, description: "رأس المال المدفوع" },
      ],
    });
    await post("journal-entries", openingJe.id, acc);
    // Equipment purchase entry
    const eq = await accountIdByKey(prisma, co.id, "FA_EQUIPMENT");
    const eqJe = await create(acc, "journal-entries", {
      ...C,
      date: "2025-07-15",
      description: "شراء معدات إنشائية (خلاطة خرسانة + لودر)",
      lines: [
        { accountId: eq, debit: 3_600_000 },
        { accountId: banks[0].accountId, credit: 3_600_000 },
      ],
    });
    await post("journal-entries", eqJe.id, acc);

    // HR master data
    const deps = [];
    for (const n of ["الإدارة الهندسية", "الشؤون المالية", "الموارد البشرية", "المواقع والتنفيذ"]) deps.push(await create(hrCtx, "departments", { ...C, name: n }));
    const positions = new Map<string, any>();
    for (const e of s.employees) if (!positions.has(e[1])) positions.set(e[1], await create(hrCtx, "positions", { ...C, name: e[1] }));

    // Clients & projects
    const clients = [];
    for (const [name, tax] of s.clients) clients.push(await create(admin, "clients", { ...C, name, taxNumber: tax, contactPerson: "إدارة المشروعات", phone: "02-2" + Math.floor(1000000 + Math.random() * 8999999) }));
    const projects = [];
    for (const p of s.projects) {
      const pr = await create(admin, "projects", {
        ...C, code: p.code, name: p.name, clientId: clients[p.client].id, contractValue: p.value, budget: p.budget, startDate: p.start, endDate: p.end,
        projectManager: p.pm, consultant: p.consultant, location: p.location, status: p.status, completionPct: p.pct, clientRetentionPct: 5, clientTaxPct: 1, clientInsurancePct: 0.5,
      });
      projects.push({ ...pr, seed: p });
      const split = { MATERIALS: 0.42, LABOR: 0.16, EQUIPMENT: 0.1, SUBCONTRACTORS: 0.24, TRANSPORT: 0.03, OTHER: 0.05 };
      for (const [cat, f] of Object.entries(split)) await create(costCtx, "project-budgets", { ...C, projectId: pr.id, category: cat, amount: Math.round(p.budget * f) });
    }
    const active = projects.filter((p) => ["ACTIVE", "SUSPENDED", "COMPLETED"].includes(p.seed.status));

    // Employees
    const emps = [];
    let ei = 0;
    for (const [name, pos, basic, allow] of s.employees) {
      const project = active[ei % active.length];
      const e = await create(hrCtx, "employees", {
        ...C, name, positionId: positions.get(pos).id, departmentId: deps[ei % 4 === 1 ? 1 : ei % 4 === 2 ? 2 : 3].id, projectId: ei < s.employees.length - 1 ? project.id : null,
        hireDate: "2024-0" + ((ei % 8) + 1) + "-01", basicSalary: basic, allowances: allow, insuranceSalary: Math.min(basic, 14500),
        nationalId: "2" + String(85000000000000 + ei * 1234567 + co.code.length).slice(0, 13), phone: "010" + String(10000000 + ei * 7654321).slice(0, 8),
      });
      await create(hrCtx, "employee-contracts", { ...C, employeeId: e.id, type: "FIXED_TERM", startDate: "2025-01-01", endDate: "2026-12-31", salary: basic });
      emps.push(e);
      ei++;
    }
    // Split the first employee across two projects
    if (active.length > 1) {
      await create(hrCtx, "employee-allocations", { ...C, employeeId: emps[0].id, projectId: active[0].id, percent: 60 });
      await create(hrCtx, "employee-allocations", { ...C, employeeId: emps[0].id, projectId: active[1].id, percent: 40 });
    }

    // Suppliers & contractors
    const suppliers = [];
    for (const [name, tax, cat] of s.suppliers)
      suppliers.push(await create(admin, "suppliers", { ...C, name, taxNumber: tax, contactPerson: `مدير مبيعات ${cat}`, phone: "02-2" + String(4000000 + suppliers.length * 1111), paymentTermsDays: 45, bankName: "البنك الأهلي المصري", bankAccount: "99" + tax.replace(/-/g, "") }));
    const contractors = [];
    for (const [name, spec] of s.contractors) contractors.push(await create(admin, "contractors", { ...C, name, specialty: spec, taxNumber: "5" + String(10000000 + contractors.length * 777), phone: "011" + String(20000000 + contractors.length * 3333) }));

    // Subcontracts + contractor extracts + payments
    let ci = 0;
    for (const pr of active) {
      const contractor = contractors[ci % contractors.length];
      const value = Math.round(pr.seed.value * 0.18);
      const sc = await create(acc, "subcontracts", {
        ...C, contractorId: contractor.id, projectId: pr.id, scope: `${contractor.specialty ?? "أعمال"} - ${pr.name}`, contractValue: value, retentionPct: 5, taxPct: 1, insurancePct: 0.5, advanceRecoveryPct: 10,
        startDate: pr.seed.start, endDate: pr.seed.end,
      });
      // Advance payment 10%
      const adv = await create(extractCtx, "payments", { ...C, type: "CONTRACTOR_ADVANCE", date: late0(pr) ? "2026-02-15" : "2025-11-05", amount: Math.round(value * 0.1), method: "BANK", bankAccountId: banks[0].id, contractorId: contractor.id, projectId: pr.id, description: "دفعة مقدمة 10% من قيمة العقد" });
      await post("payments", adv.id, extractCtx);
      const fractions = pr.seed.status === "COMPLETED" ? [0.35, 0.7, 1.0] : [0.15, Math.min(0.9, pr.seed.pct / 100 + 0.05)];
      const late = pr.seed.start >= "2025-12-01";
      const months = late ? ["2026-03-31", "2026-06-30", "2026-08-31"] : ["2025-12-31", "2026-03-31", "2026-06-30"];
      let k = 0;
      for (const f of fractions) {
        const ex = await create(extractCtx, "contractor-extracts", {
          ...C, contractId: sc.id, periodFrom: k === 0 ? (late ? "2026-02-15" : "2025-11-01") : months[k - 1], periodTo: months[k], date: months[k],
          cumulativeGross: Math.round(value * f), otherDeductions: k === 1 ? 15_000 : 0, description: `مستخلص جاري رقم ${k + 1}`,
        });
        await post("contractor-extracts", ex.id, extractCtx);
        const full = await prisma.contractorExtract.findUniqueOrThrow({ where: { id: ex.id } });
        const payAmt = k < fractions.length - 1 ? Number(full.netAmount) : Math.round(Number(full.netAmount) * 0.5);
        const pay = await create(extractCtx, "payments", {
          ...C, type: "CONTRACTOR_PAYMENT", date: months[k].slice(0, 8) + "28", amount: payAmt, method: k === 0 ? "CHEQUE" : "BANK", bankAccountId: banks[k % 2].id,
          chequeNumber: k === 0 ? String(700100 + ci) : null, chequeDueDate: k === 0 ? months[k] : null, contractorExtractId: ex.id, description: `سداد مستخلص ${full.number}`,
        });
        await post("payments", pay.id, extractCtx);
        if (k === 0) {
          // issued cheque presented and cleared a few days later
          const ch = await prisma.cheque.findFirstOrThrow({ where: { paymentId: pay.id } });
          const d = new Date(months[k]);
          d.setUTCDate(d.getUTCDate() + 3);
          await act(treasuryCtx, "cheques", ch.id, "clear", { date: d.toISOString().slice(0, 10) });
        }
        k++;
      }
      ci++;
    }

    // Client extracts + receipts
    for (const pr of active) {
      const fr = pr.seed.status === "COMPLETED" ? [0.3, 0.65, 1.0] : [0.12, Math.max(0.2, pr.seed.pct / 100)];
      const dates = pr.seed.start >= "2025-12-01" ? ["2026-03-20", "2026-06-20", "2026-08-20"] : ["2025-12-20", "2026-04-20", "2026-07-20"];
      let k = 0;
      for (const f of fr) {
        const ex = await create(extractCtx, "client-extracts", {
          ...C, projectId: pr.id, periodFrom: k === 0 ? pr.seed.start : dates[k - 1], periodTo: dates[k], date: dates[k], cumulativeWork: Math.round(pr.seed.value * f),
          otherDeductions: k === 1 ? 25_000 : 0, description: `مستخلص جاري رقم ${k + 1} - ${pr.name}`,
        });
        await post("client-extracts", ex.id, extractCtx);
        const full = await prisma.clientExtract.findUniqueOrThrow({ where: { id: ex.id } });
        if (k < fr.length - 1 || pr.seed.status === "COMPLETED") {
          const rcv = await create(treasuryCtx, "payments", {
            ...C, type: "CLIENT_RECEIPT", date: dates[k].slice(0, 8) + "28", amount: k === fr.length - 1 ? Math.round(Number(full.netAmount) * 0.6) : Number(full.netAmount),
            ...(k === 1 ? { method: "CHEQUE", chequeNumber: String(5100200 + k * 10 + active.indexOf(pr)), chequeDueDate: dates[k] } : { method: "BANK", bankAccountId: banks[0].id }),
            clientExtractId: ex.id, description: `تحصيل مستخلص ${full.number}`,
          });
          await post("payments", rcv.id, treasuryCtx);
          if (k === 1) {
            // received cheque: send for collection, then cleared by the bank (two bank-side entries)
            const ch = await prisma.cheque.findFirstOrThrow({ where: { paymentId: rcv.id } });
            await act(treasuryCtx, "cheques", ch.id, "collect", { date: dates[k].slice(0, 8) + "29", bankAccountId: banks[0].id });
            await act(treasuryCtx, "cheques", ch.id, "clear", { date: dates[k].slice(0, 8) + "30", charges: 35 });
          }
        }
        k++;
      }
    }

    // Supplier invoices + payments
    let si = 0;
    for (const pr of active) {
      for (let j = 0; j < 2; j++) {
        const sup = suppliers[(si + j) % suppliers.length];
        const subtotal = Math.round(pr.seed.value * (j === 0 ? 0.045 : 0.025));
        const inv = await create(acc, "supplier-invoices", {
          ...C, supplierId: sup.id, supplierRef: `INV-${2026}${String(si * 10 + j).padStart(4, "0")}`, projectId: pr.id, date: j === 0 ? "2026-01-15" : "2026-05-10",
          category: j === 0 ? "MATERIALS" : si % 2 ? "EQUIPMENT" : "MATERIALS", description: j === 0 ? "توريد حديد تسليح وأسمنت" : "توريد مواد / تأجير معدات", subtotal, taxAmount: Math.round(subtotal * 0.14),
        });
        await post("supplier-invoices", inv.id, acc);
        const total = Math.round(subtotal * 1.14);
        const pay = await create(treasuryCtx, "payments", {
          ...C, type: "SUPPLIER_PAYMENT", date: j === 0 ? "2026-02-25" : "2026-06-20", amount: j === 0 ? total : Math.round(total * 0.4), method: "BANK", bankAccountId: banks[1].id, supplierInvoiceId: inv.id,
          description: "سداد فاتورة مورد",
        });
        await post("payments", pay.id, treasuryCtx);
      }
      si++;
    }

    // Custody with expenses + settlement
    const cust = await create(acc, "custodies", { ...C, employeeId: emps[2].id, amount: 60_000, date: "2026-05-01", purpose: "مصروفات نثرية للموقع", cashBoxId: mainCash.id, projectId: active[0].id });
    await post("custodies", cust.id, acc);
    for (const [type, amt, desc] of [["TRANSPORT", 8_500, "نقل عمالة"], ["FUEL", 12_300, "سولار للمعدات"], ["OTHER", 4_200, "أدوات مكتبية للموقع"]] as const) {
      const ex = await create(acc, "expenses", { ...C, projectId: active[0].id, type, date: "2026-05-1" + Math.floor(Math.random() * 9), amount: amt, paymentMethod: "CUSTODY", custodyId: cust.id, description: desc });
      await post("expenses", ex.id, acc);
    }
    await act(ctxByRole.FINANCE_MANAGER!, "custodies", cust.id, "settle");
    const cust2 = await create(acc, "custodies", { ...C, employeeId: emps[1].id, amount: 25_000, date: "2026-08-01", purpose: "عهدة مشتريات عاجلة للموقع", cashBoxId: mainCash.id, projectId: active[0].id });
    await post("custodies", cust2.id, acc);

    // Cash funding for site + direct expenses
    const dep = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_WITHDRAWAL", date: "2026-03-01", amount: 400_000, cashBoxId: mainCash.id, bankAccountId: banks[0].id, description: "سحب نقدية لتغذية الخزينة" });
    await post("treasury-transactions", dep.id, treasuryCtx);
    const tr = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "CASH_TRANSFER", date: "2026-03-02", amount: 250_000, cashBoxId: mainCash.id, toCashBoxId: siteCash.id, description: "تحويل لخزينة المواقع" });
    await post("treasury-transactions", tr.id, treasuryCtx);
    const bt = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_TRANSFER", date: "2026-04-01", amount: 2_000_000, bankAccountId: banks[0].id, toBankAccountId: banks[1].id, description: "تحويل بين الحسابات البنكية" });
    await post("treasury-transactions", bt.id, treasuryCtx);
    const bankCharges = await accountIdByKey(prisma, co.id, "BANK_CHARGES");
    const bc = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_PAYMENT", date: "2026-06-30", amount: 3_750, bankAccountId: banks[0].id, counterAccountId: bankCharges, description: "مصروفات وعمولات بنكية" });
    await post("treasury-transactions", bc.id, treasuryCtx);

    const expenseRows: [string, number, string, string, number][] = [
      ["LABOR", 145_000, "CASH", "يوميات عمالة الموقع", 0],
      ["EQUIPMENT", 88_000, "BANK", "إيجار ونش برجي", 0],
      ["RENT", 35_000, "BANK", "إيجار سكن العاملين", 1],
      ["TRANSPORT", 22_500, "CASH", "نقل مخلفات", 1],
      ["ADMIN", 18_000, "BANK", "مصروفات إدارية - اشتراكات وبرامج", -1],
      ["MATERIALS", 64_000, "CREDIT", "مواد عزل - على الحساب", 0],
      ["EQUIPMENT", 52_000, "CHEQUE", "صيانة شاملة للمعدات - بشيك", 0],
    ];
    for (const [type, amount, method, desc, pi] of expenseRows) {
      const e = await create(acc, "expenses", {
        ...C, projectId: pi >= 0 ? active[Math.min(pi, active.length - 1)].id : null, type, date: "2026-0" + (4 + (amount % 4)) + "-12", amount, paymentMethod: method,
        cashBoxId: method === "CASH" ? siteCash.id : null, bankAccountId: method === "BANK" || method === "CHEQUE" ? banks[1].id : null, supplierId: method === "CREDIT" || method === "CHEQUE" ? suppliers[0].id : null,
        employeeId: type === "LABOR" ? emps[1].id : null, description: desc,
        ...(method === "CHEQUE" ? { date: "2026-08-10", chequeNumber: String(660100 + clients.length), chequeDueDate: "2026-08-25" } : {}),
      });
      await post("expenses", e.id, acc);
      if (method === "CHEQUE") {
        // the issued cheque is presented and cleared by the bank (bank moves only now)
        const ch = await prisma.cheque.findFirstOrThrow({ where: { expenseId: e.id } });
        await act(treasuryCtx, "cheques", ch.id, "clear", { date: "2026-08-26" });
      }
    }

    // Payroll for two months + salary payment
    for (const month of ["2026-07", "2026-08"]) {
      await create(hrCtx, "hr-adjustments", { ...C, employeeId: emps[1].id, type: "OVERTIME", month, amount: 1_800, reason: "ساعات إضافية بالموقع" });
      await create(hrCtx, "hr-adjustments", { ...C, employeeId: emps[0].id, type: "BONUS", month, amount: 3_000, reason: "حافز إنجاز" });
      if (month === "2026-08") await create(hrCtx, "hr-adjustments", { ...C, employeeId: emps[3].id, type: "DEDUCTION", month, amount: 500, reason: "جزاء تأخير" });
      const pr = await create(hrCtx, "payrolls", { ...C, month });
      await post("payrolls", pr.id, hrCtx);
      const full = await prisma.payroll.findUniqueOrThrow({ where: { id: pr.id } });
      const sp = await create(treasuryCtx, "treasury-transactions", {
        ...C, kind: "BANK_PAYMENT", date: `${month}-28`, amount: Number(full.totalNet), bankAccountId: banks[0].id, counterAccountId: await accountIdByKey(prisma, co.id, "SALARIES_PAYABLE"),
        description: `صرف رواتب شهر ${month}`,
      });
      await post("treasury-transactions", sp.id, treasuryCtx);
    }
    // Attendance & leave samples
    for (let day = 1; day <= 5; day++) {
      for (const e of emps.slice(0, 3)) {
        await create(hrCtx, "attendance", { ...C, employeeId: e.id, date: `2026-09-0${day}`, status: day === 3 && e === emps[2] ? "ABSENT" : "PRESENT", hours: 8, overtimeHours: e === emps[1] ? 2 : 0 });
      }
    }
    const lv = await create(hrCtx, "leave-requests", { ...C, employeeId: emps[4].id, type: "ANNUAL", fromDate: "2026-09-14", toDate: "2026-09-18", reason: "إجازة سنوية" });
    await act(hrCtx, "leave-requests", lv.id, "approve");
    await create(hrCtx, "leave-requests", { ...C, employeeId: emps[3].id, type: "SICK", fromDate: "2026-09-21", toDate: "2026-09-22", reason: "إجازة مرضية" });

    // Procurement cycle: PR -> quotations -> PO -> receipt -> invoice
    const prq = await create(procCtx, "purchase-requests", {
      ...C, projectId: active[0].id, date: "2026-08-03", requestedBy: s.employees[0][0], notes: "توريد مواد للمرحلة القادمة",
      items: [{ description: "حديد تسليح 16 مم", unit: "طن", quantity: 40 }, { description: "أسمنت بورتلاندي", unit: "طن", quantity: 120 }],
    });
    await act(procCtx, "purchase-requests", prq.id, "submit");
    const prItems = await prisma.purchaseRequestItem.findMany({ where: { requestId: prq.id } });
    const quotes = [];
    for (const [i, sup] of suppliers.entries()) {
      quotes.push(
        await create(procCtx, "quotations", {
          ...C, requestId: prq.id, supplierId: sup.id, date: "2026-08-06", validUntil: "2026-09-06", deliveryDays: 7 + i * 3,
          items: [
            { requestItemId: prItems[0].id, description: prItems[0].description, quantity: 40, unitPrice: 38_500 + i * 900 },
            { requestItemId: prItems[1].id, description: prItems[1].description, quantity: 120, unitPrice: 2_950 - i * 40 },
          ],
        }),
      );
    }
    const po = await act(procCtx, "quotations", quotes[0].id, "create-order");
    await post("purchase-orders", po.id, procCtx);
    const poItems = await prisma.purchaseOrderItem.findMany({ where: { orderId: po.id } });
    await create(procCtx, "goods-receipts", { ...C, orderId: po.id, date: "2026-08-15", notes: "استلام جزئي", items: poItems.map((i) => ({ orderItemId: i.id, quantity: Number(i.quantity) / 2 })) });
    const poFull = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    const inv = await create(acc, "supplier-invoices", {
      ...C, supplierId: poFull.supplierId, purchaseOrderId: po.id, projectId: poFull.projectId, date: "2026-08-16", category: "MATERIALS", description: `فاتورة على أمر شراء ${poFull.number} (استلام جزئي)`,
      subtotal: Number(poFull.subtotal) / 2, taxAmount: Number(poFull.taxAmount) / 2,
    });
    await post("supplier-invoices", inv.id, acc);
    const prq2 = await create(procCtx, "purchase-requests", { ...C, projectId: active[active.length - 1].id, date: "2026-09-20", requestedBy: s.employees[1][0], items: [{ description: "بلوك أسمنتي 20 سم", unit: "ألف", quantity: 25 }] });
    void prq2;

    // Manual cheque register entry
    const arId = await accountIdByKey(prisma, co.id, "AR");
    const apId = await accountIdByKey(prisma, co.id, "AP_SUPPLIERS");
    // post-dated cheque still in hand
    await create(treasuryCtx, "cheques", { ...C, number: String(880100 + clients.length), type: "RECEIVED", drawerBank: "البنك الأهلي المصري", amount: 250_000, issueDate: "2026-09-10", dueDate: "2026-10-15", partyName: clients[0].name, partyType: "CLIENT", partyId: clients[0].id, counterAccountId: arId, notes: "شيك مؤجل من العميل" });
    // deposited then bounced (with bank charges) — receivable restored on the client
    const bounced = await create(treasuryCtx, "cheques", { ...C, number: String(880200 + clients.length), type: "RECEIVED", drawerBank: "بنك مصر", amount: 85_000, issueDate: "2026-08-05", dueDate: "2026-08-10", partyName: clients[0].name, partyType: "CLIENT", partyId: clients[0].id, counterAccountId: arId });
    await act(treasuryCtx, "cheques", bounced.id, "deposit", { date: "2026-08-10", bankAccountId: banks[0].id });
    await act(treasuryCtx, "cheques", bounced.id, "bounce", { date: "2026-08-14", charges: 150, notes: "رصيد غير كاف" });
    // issued cheque to a supplier, not yet presented
    await create(treasuryCtx, "cheques", { ...C, number: String(990300 + clients.length), type: "ISSUED", bankAccountId: banks[1 % banks.length].id, amount: 64_000, issueDate: "2026-09-18", dueDate: "2026-10-05", partyName: suppliers[0].name, partyType: "SUPPLIER", partyId: suppliers[0].id, counterAccountId: apId });

    // Multi-currency demo: monthly demo rates, a USD bank account funded in USD, a USD import invoice
    // paid a month later at a different rate (realized FX difference posted automatically).
    const rateRows: { companyId: string; currency: string; date: Date; rate: number; source: string }[] = [];
    for (let i = 0; i < 22; i++) {
      const date = new Date(Date.UTC(2025, i, 1));
      const usd = Math.round((50.6 - 0.12 * i) * 10000) / 10000;
      const src = "أسعار توضيحية للعرض (ليست أسعار البنك المركزي الرسمية)";
      rateRows.push({ ...C, currency: "USD", date, rate: usd, source: src });
      rateRows.push({ ...C, currency: "EUR", date, rate: Math.round(usd * (1.08 + 0.004 * i) * 10000) / 10000, source: src });
      rateRows.push({ ...C, currency: "SAR", date, rate: Math.round((usd / 3.75) * 10000) / 10000, source: src });
    }
    await prisma.exchangeRate.createMany({ data: rateRows });
    const usdBank = await create(admin, "bank-accounts", { ...C, bankName: "البنك التجاري الدولي CIB", branch: "الحساب الدولاري", accountNumber: `USD-${s.banks[0][2]}`, currency: "USD" });
    const usdIn = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_RECEIPT", date: "2026-07-05", amount: 60_000, currency: "USD", bankAccountId: usdBank.id, counterAccountId: await accountIdByKey(prisma, co.id, "CAPITAL"), description: "زيادة رأس المال بالدولار" });
    await post("treasury-transactions", usdIn.id, treasuryCtx);
    const usdInv = await create(acc, "supplier-invoices", { ...C, supplierId: suppliers[1 % suppliers.length].id, projectId: active[0].id, date: "2026-07-20", category: "EQUIPMENT", currency: "USD", subtotal: 12_000, taxAmount: 0, supplierRef: "IMP-USD-01", description: "استيراد قطع غيار معدات (بالدولار)" });
    await post("supplier-invoices", usdInv.id, acc);
    const usdPay = await create(acc, "payments", { ...C, type: "SUPPLIER_PAYMENT", date: "2026-08-20", amount: 12_000, currency: "USD", method: "BANK", bankAccountId: usdBank.id, supplierInvoiceId: usdInv.id, description: "سداد فاتورة الاستيراد من الحساب الدولاري" });
    await post("payments", usdPay.id, acc);

    // USD subcontract (foreign specialist): extract at month end, partial payment from the USD account
    const usdSc = await create(acc, "subcontracts", {
      ...C, contractorId: contractors[1 % contractors.length].id, projectId: active[0].id, scope: "توريد وتركيب أنظمة تحكم مستوردة (بالدولار)", contractValue: 80_000, currency: "USD",
      retentionPct: 5, taxPct: 1, insurancePct: 0, advanceRecoveryPct: 0, startDate: "2026-07-01", endDate: "2026-12-31",
    });
    const usdEx = await create(extractCtx, "contractor-extracts", { ...C, contractId: usdSc.id, periodFrom: "2026-07-01", periodTo: "2026-08-31", date: "2026-08-31", cumulativeGross: 30_000, description: "مستخلص رقم 1 (بالدولار)" });
    await post("contractor-extracts", usdEx.id, extractCtx);
    const usdExFull = await prisma.contractorExtract.findUniqueOrThrow({ where: { id: usdEx.id } });
    const usdExPay = await create(extractCtx, "payments", { ...C, type: "CONTRACTOR_PAYMENT", date: "2026-09-15", amount: Math.round(Number(usdExFull.netAmount) * 0.5), currency: "USD", method: "BANK", bankAccountId: usdBank.id, contractorExtractId: usdEx.id, description: `سداد جزئي لمستخلص ${usdExFull.number} بالدولار` });
    await post("payments", usdExPay.id, extractCtx);

    // USD petty cash: funded from the USD account, a USD custody with a USD expense (custody still open)
    const usdCash = await create(admin, "cash-boxes", { ...C, name: "خزينة الدولار", keeper: "أمين الخزينة", currency: "USD" });
    const usdW = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_WITHDRAWAL", date: "2026-08-03", amount: 5_000, currency: "USD", bankAccountId: usdBank.id, cashBoxId: usdCash.id, description: "سحب نقدية دولارية" });
    await post("treasury-transactions", usdW.id, treasuryCtx);
    const usdCust = await create(acc, "custodies", { ...C, employeeId: emps[0].id, amount: 2_000, currency: "USD", date: "2026-08-05", purpose: "عهدة سفر لمعاينة معدات بالخارج (بالدولار)", cashBoxId: usdCash.id, projectId: active[0].id });
    await post("custodies", usdCust.id, acc);
    const usdCustEx = await create(acc, "expenses", { ...C, projectId: active[0].id, type: "TRANSPORT", date: "2026-08-12", amount: 850, currency: "USD", paymentMethod: "CUSTODY", custodyId: usdCust.id, description: "تذاكر سفر وإقامة (بالدولار)" });
    await post("expenses", usdCustEx.id, acc);

    // Manual USD journal entry (accrual entered in USD, converted at the month rate)
    const usdJe = await create(acc, "journal-entries", {
      ...C, date: "2026-08-25", currency: "USD", description: "استحقاق رسوم فحص فني لمعدات مستوردة (بالدولار)", projectId: active[0].id,
      lines: [
        { accountId: await accountIdByKey(prisma, co.id, "COST_EQUIPMENT"), debit: 1_500, projectId: active[0].id },
        { accountId: apId, credit: 1_500, partyType: "SUPPLIER", partyId: suppliers[1 % suppliers.length].id },
      ],
    });
    await post("journal-entries", usdJe.id, acc);

    if (co.code === "NILE") {
      // Expat engineer paid in USD: separate USD payroll for August, paid from the USD account
      const expat = await create(hrCtx, "employees", {
        ...C, name: "John Carter", positionId: positions.get(s.employees[0][1]).id, departmentId: deps[0].id, projectId: active[0].id, hireDate: "2026-06-01",
        salaryCurrency: "USD", basicSalary: 3_000, allowances: 500, insuranceSalary: 0, nationalId: "P-US-55120034",
      });
      const usdPr = await create(hrCtx, "payrolls", { ...C, month: "2026-08", currency: "USD" });
      await post("payrolls", usdPr.id, hrCtx);
      const usdPrFull = await prisma.payroll.findUniqueOrThrow({ where: { id: usdPr.id } });
      const usdSal = await create(treasuryCtx, "treasury-transactions", {
        ...C, kind: "BANK_PAYMENT", date: "2026-08-31", amount: Number(usdPrFull.totalNet), currency: "USD", bankAccountId: usdBank.id, counterAccountId: await accountIdByKey(prisma, co.id, "SALARIES_PAYABLE"),
        description: "صرف رواتب الدولار - أغسطس 2026",
      });
      await post("treasury-transactions", usdSal.id, treasuryCtx);
      void expat;

      // Project billed in USD to a foreign-funded client: client extract + receipt into the USD account
      const usdProject = await create(admin, "projects", {
        ...C, code: "NIL-P04", name: "محطة طاقة شمسية 5 ميجاوات - تمويل دولي (بالدولار)", clientId: clients[2].id, contractValue: 2_400_000, currency: "USD", budget: 1_950_000,
        startDate: "2026-07-01", endDate: "2027-06-30", projectManager: "م. كريم عبد العزيز", consultant: "Lahmeyer International", location: "بنبان - أسوان", status: "ACTIVE", completionPct: 8,
        clientRetentionPct: 5, clientTaxPct: 1, clientInsurancePct: 0,
      });
      const usdCe = await create(extractCtx, "client-extracts", { ...C, projectId: usdProject.id, periodFrom: "2026-07-01", periodTo: "2026-08-20", date: "2026-08-20", cumulativeWork: 190_000, description: "مستخلص رقم 1 - محطة الطاقة الشمسية (بالدولار)" });
      await post("client-extracts", usdCe.id, extractCtx);
      const usdCeFull = await prisma.clientExtract.findUniqueOrThrow({ where: { id: usdCe.id } });
      const usdRcv = await create(treasuryCtx, "payments", { ...C, type: "CLIENT_RECEIPT", date: "2026-09-10", amount: Number(usdCeFull.netAmount), currency: "USD", method: "BANK", bankAccountId: usdBank.id, clientExtractId: usdCe.id, description: `تحصيل مستخلص ${usdCeFull.number} بالدولار` });
      await post("payments", usdRcv.id, treasuryCtx);
    }

    // Month-end FX revaluations of open USD balances (unrealized gain/loss), each auto-reversed on the next day
    await create(ctxByRole.CHIEF_ACCOUNTANT!, "fx-revaluations", { ...C, date: "2026-08-31", notes: "إعادة تقييم نهاية أغسطس بسعر الإقفال" });
    await create(ctxByRole.CHIEF_ACCOUNTANT!, "fx-revaluations", { ...C, date: "2026-09-30", notes: "إعادة تقييم نهاية سبتمبر بسعر الإقفال" });

    // Items awaiting approval (to populate approval inbox) and drafts
    const pendingJe = await create(acc, "journal-entries", {
      ...C, date: "2026-09-25", description: "قيد تسوية - استحقاق إيجار معدات سبتمبر", projectId: active[0].id,
      lines: [
        { accountId: await accountIdByKey(prisma, co.id, "COST_EQUIPMENT"), debit: 45_000, projectId: active[0].id },
        { accountId: await accountIdByKey(prisma, co.id, "AP_SUPPLIERS"), credit: 45_000, partyType: "SUPPLIER", partyId: suppliers[2].id },
      ],
    });
    await act(acc, "journal-entries", pendingJe.id, "submit");
    const pendingExp = await create(acc, "expenses", { ...C, projectId: active[0].id, type: "EQUIPMENT", date: "2026-09-27", amount: 27_500, paymentMethod: "CASH", cashBoxId: siteCash.id, description: "صيانة لودر" });
    await act(acc, "expenses", pendingExp.id, "submit");
    await act(ctxByRole.CHIEF_ACCOUNTANT!, "expenses", pendingExp.id, "approve", { comment: "مراجعة المستندات سليمة" });
    await create(acc, "expenses", { ...C, projectId: active[0].id, type: "FUEL", date: "2026-09-29", amount: 9_800, paymentMethod: "CASH", cashBoxId: siteCash.id, description: "وقود معدات (مسودة)" });
    // A pending contractor extract (next extract on the first contract)
    const sc1 = await prisma.subContract.findFirstOrThrow({ where: { companyId: co.id }, orderBy: { number: "asc" } });
    const lastEx = await prisma.contractorExtract.aggregate({ where: { contractId: sc1.id, status: "POSTED" }, _sum: { currentGross: true } });
    const nextCum = Math.min(Number(sc1.contractValue), Number(lastEx._sum.currentGross ?? 0) + Math.round(Number(sc1.contractValue) * 0.08));
    if (nextCum > Number(lastEx._sum.currentGross ?? 0)) {
      const pex = await create(extractCtx, "contractor-extracts", { ...C, contractId: sc1.id, periodFrom: "2026-07-01", periodTo: "2026-09-30", date: "2026-09-30", cumulativeGross: nextCum, description: "مستخلص جاري - تحت المراجعة" });
      await act(extractCtx, "contractor-extracts", pex.id, "submit");
    }

    // Liquidity: no cash box / bank account may dip below zero at any date. Fund any shortfall early in the year
    // (transfer from the main bank, or a cash withdrawal for cash boxes); top up the main bank with capital if needed.
    const egpAccounts = [...banks.slice(1).map((b) => ({ kind: "bank" as const, row: b })), { kind: "cash" as const, row: siteCash }, { kind: "cash" as const, row: mainCash }];
    for (const a of egpAccounts) {
      const min = await runningMin(co.id, a.row.accountId);
      if (min >= 0) continue;
      const amount = Math.ceil((-min + 50_000) / 50_000) * 50_000;
      const body = a.kind === "bank"
        ? { kind: "BANK_TRANSFER", bankAccountId: banks[0].id, toBankAccountId: a.row.id, description: "تمويل الحساب البنكي من الحساب الرئيسي" }
        : { kind: "BANK_WITHDRAWAL", bankAccountId: banks[0].id, cashBoxId: a.row.id, description: "تغذية الخزينة من البنك الرئيسي" };
      const t = await create(treasuryCtx, "treasury-transactions", { ...C, date: "2025-07-02", amount, ...body });
      await post("treasury-transactions", t.id, treasuryCtx);
    }
    const mainMin = await runningMin(co.id, banks[0].accountId);
    if (mainMin < 0) {
      const t = await create(treasuryCtx, "treasury-transactions", { ...C, kind: "BANK_RECEIPT", date: "2025-07-01", amount: Math.ceil((-mainMin + 100_000) / 100_000) * 100_000, bankAccountId: banks[0].id, counterAccountId: capital, description: "زيادة رأس المال المدفوع" });
      await post("treasury-transactions", t.id, treasuryCtx);
    }
  }

  // Restrict the site accountant to a single project (project-level permissions demo)
  const p1 = await prisma.project.findFirstOrThrow({ where: { code: "NIL-P01" } });
  await prisma.userProject.create({ data: { userId: created["site.nile@ccs.local"].id, projectId: p1.id } });

  // Fiscal years 2025 & 2026 for every company; months through June 2026 are closed via the real checklist/close service.
  const MANUAL = ["accruals", "depreciation", "inventory", "review"];
  for (const co of await prisma.company.findMany({ orderBy: { code: "asc" } })) {
    for (const year of [2025, 2026]) await create(admin, "fiscal-years", { companyId: co.id, year });
    const periods = await prisma.accountingPeriod.findMany({ where: { companyId: co.id, startDate: { lt: new Date(Date.UTC(2026, 6, 1)) } }, orderBy: { startDate: "asc" } });
    for (const p of periods) {
      for (const key of MANUAL) await act(ctxByRole.CHIEF_ACCOUNTANT!, "accounting-periods", p.id, "checklist", { key, done: true });
      try {
        await act(ctxByRole.FINANCE_MANAGER!, "accounting-periods", p.id, "close", { notes: "إقفال شهري (بيانات تجريبية)" });
      } catch (e) {
        console.warn(`  ! ${co.code} ${p.year}-${p.month} not closed: ${(e as Error).message}`);
        break;
      }
    }
    // Year-end close of FY 2025: posts the closing entry (revenue & expenses -> retained earnings)
    const fy25 = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: co.id, name: "2025" }, include: { periods: true } });
    if (fy25.periods.every((p) => p.status === "CLOSED")) await act(ctxByRole.FINANCE_MANAGER!, "fiscal-years", fy25.id, "close");
  }

  // Sanity: no cash box or bank account is overdrawn at any date
  for (const a of await prisma.account.findMany({ where: { parent: { systemKey: { in: ["CASH_PARENT", "BANK_PARENT"] } } } })) {
    const min = await runningMin(a.companyId, a.id);
    if (min < -0.005) throw new Error(`Seed invariant: ${a.code} ${a.name} goes negative (${min})`);
  }

  const counts = {
    companies: await prisma.company.count(),
    closedPeriods: await prisma.accountingPeriod.count({ where: { status: "CLOSED" } }),
    closedFiscalYears: await prisma.fiscalYear.count({ where: { status: "CLOSED" } }),
    exchangeRates: await prisma.exchangeRate.count(),
    fxJournalLines: await prisma.journalLine.count({ where: { currency: { not: null } } }),
    fxRevaluations: await prisma.fxRevaluation.count(),
    projects: await prisma.project.count(),
    journalEntries: await prisma.journalEntry.count(),
    postedEntries: await prisma.journalEntry.count({ where: { status: "POSTED" } }),
    contractorExtracts: await prisma.contractorExtract.count(),
    clientExtracts: await prisma.clientExtract.count(),
    payments: await prisma.payment.count(),
    expenses: await prisma.expense.count(),
    employees: await prisma.employee.count(),
    payrolls: await prisma.payroll.count(),
    users: await prisma.user.count(),
    pendingApprovals: await prisma.approvalRequest.count({ where: { status: "PENDING" } }),
  };
  const tb = await prisma.journalLine.aggregate({ where: { entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  console.log("Seed complete:", counts);
  console.log("Ledger check (all posted lines): debit", tb._sum.debit?.toString(), "credit", tb._sum.credit?.toString());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
