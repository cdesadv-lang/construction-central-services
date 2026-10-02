// Shared (client + server) RBAC definitions. Server enforcement lives in src/server/context.ts.
export const ROLES = [
  "SUPER_ADMIN",
  "GENERAL_MANAGER",
  "FINANCE_MANAGER",
  "CHIEF_ACCOUNTANT",
  "ACCOUNTANT",
  "EXTRACT_ACCOUNTANT",
  "COST_ACCOUNTANT",
  "PROCUREMENT_OFFICER",
  "HR_OFFICER",
  "TREASURY_ACCOUNTANT",
  "FINANCIAL_CONTROLLER",
  "VIEWER",
] as const;
export type RoleKey = (typeof ROLES)[number];

export const MODULES = [
  "dashboard",
  "companies",
  "projects",
  "accounting",
  "periods",
  "journals",
  "suppliers",
  "contractors",
  "clientExtracts",
  "contractorExtracts",
  "expenses",
  "custody",
  "payments",
  "treasury",
  "banks",
  "procurement",
  "costing",
  "hr",
  "payroll",
  "reports",
  "documents",
  "notifications",
  "settings",
  "audit",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "approve", "delete"] as const;
export type ActionKey = (typeof ACTIONS)[number];

type Grant = Partial<Record<ModuleKey, string>>; // string of letters: v c e a d

const ALL = "vcead";
const base: Grant = { dashboard: "v", notifications: "v", documents: "v" };

const MATRIX: Record<RoleKey, Grant> = {
  SUPER_ADMIN: Object.fromEntries(MODULES.map((m) => [m, ALL])) as Grant,
  GENERAL_MANAGER: {
    ...Object.fromEntries(MODULES.map((m) => [m, "v"])),
    companies: "vce",
    projects: "vce",
    journals: "va",
    expenses: "va",
    payments: "va",
    clientExtracts: "va",
    contractorExtracts: "va",
    procurement: "va",
    payroll: "va",
    treasury: "va",
    custody: "va",
    documents: "vc",
    settings: "v",
  },
  FINANCE_MANAGER: {
    ...base,
    companies: "v",
    projects: "vce",
    accounting: "vcea",
    periods: "vcea",
    journals: "vcead",
    suppliers: "vcead",
    contractors: "vcead",
    clientExtracts: "vcead",
    contractorExtracts: "vcead",
    expenses: "vcead",
    custody: "vcead",
    payments: "vcead",
    treasury: "vcead",
    banks: "vcead",
    procurement: "va",
    costing: "v",
    hr: "v",
    payroll: "va",
    reports: "v",
    documents: "vcd",
    audit: "v",
  },
  CHIEF_ACCOUNTANT: {
    ...base,
    companies: "v",
    projects: "v",
    accounting: "vcea",
    periods: "vce",
    journals: "vcea",
    suppliers: "vcea",
    contractors: "vcea",
    clientExtracts: "vcea",
    contractorExtracts: "vcea",
    expenses: "vcea",
    custody: "vcea",
    payments: "vcea",
    treasury: "va",
    banks: "vcea",
    procurement: "v",
    costing: "v",
    payroll: "va",
    reports: "v",
    documents: "vc",
    audit: "v",
  },
  ACCOUNTANT: {
    ...base,
    projects: "v",
    accounting: "v",
    periods: "v",
    journals: "vce",
    suppliers: "vce",
    contractors: "vce",
    clientExtracts: "vce",
    contractorExtracts: "vce",
    expenses: "vce",
    custody: "vce",
    payments: "vce",
    treasury: "v",
    banks: "v",
    costing: "v",
    reports: "v",
    documents: "vc",
  },
  EXTRACT_ACCOUNTANT: {
    ...base,
    projects: "v",
    contractors: "vce",
    clientExtracts: "vce",
    contractorExtracts: "vce",
    payments: "vce",
    suppliers: "v",
    reports: "v",
    documents: "vc",
  },
  COST_ACCOUNTANT: {
    ...base,
    projects: "ve",
    costing: "vcea",
    accounting: "v",
    journals: "v",
    expenses: "v",
    contractors: "v",
    clientExtracts: "v",
    contractorExtracts: "v",
    procurement: "v",
    payroll: "v",
    reports: "v",
    documents: "vc",
  },
  PROCUREMENT_OFFICER: {
    ...base,
    projects: "v",
    procurement: "vced",
    suppliers: "vce",
    reports: "v",
    documents: "vc",
  },
  HR_OFFICER: {
    ...base,
    projects: "v",
    hr: "vcead",
    payroll: "vce",
    custody: "v",
    reports: "v",
    documents: "vc",
  },
  TREASURY_ACCOUNTANT: {
    ...base,
    projects: "v",
    accounting: "v",
    treasury: "vcea",
    banks: "vcea",
    payments: "vcea",
    custody: "vce",
    suppliers: "v",
    contractors: "v",
    clientExtracts: "v",
    contractorExtracts: "v",
    reports: "v",
    documents: "vc",
  },
  FINANCIAL_CONTROLLER: {
    ...Object.fromEntries(MODULES.map((m) => [m, "v"])),
    settings: "",
  },
  VIEWER: { dashboard: "v", projects: "v", reports: "v", notifications: "v" },
};

const LETTER: Record<string, ActionKey> = { v: "view", c: "create", e: "edit", a: "approve", d: "delete" };

/** Default role -> module -> actions matrix (seeded into RolePermission; editable in Settings). */
export function defaultPermissions(): { role: RoleKey; module: ModuleKey; action: ActionKey }[] {
  const out: { role: RoleKey; module: ModuleKey; action: ActionKey }[] = [];
  for (const role of ROLES) {
    const g = MATRIX[role];
    for (const m of MODULES) {
      const letters = g[m] ?? "";
      for (const ch of letters) out.push({ role, module: m, action: LETTER[ch] });
    }
  }
  return out;
}

export const permKey = (module: string, action: string) => `${module}:${action}`;

/** Roles that see every company by default (central management). */
export const GLOBAL_ROLES: RoleKey[] = ["SUPER_ADMIN", "GENERAL_MANAGER", "FINANCE_MANAGER", "FINANCIAL_CONTROLLER"];
