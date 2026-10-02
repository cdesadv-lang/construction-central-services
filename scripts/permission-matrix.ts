// Prints the default permission matrix as a Markdown table (used for README §3).  npx tsx scripts/permission-matrix.ts
import { ACTIONS, MODULES, ROLES, defaultPermissions } from "../src/lib/permissions";

const ABBR: Record<string, string> = { SUPER_ADMIN: "SA", GENERAL_MANAGER: "GM", FINANCE_MANAGER: "FM", CHIEF_ACCOUNTANT: "CA", ACCOUNTANT: "ACC", EXTRACT_ACCOUNTANT: "EXT", COST_ACCOUNTANT: "COST", PROCUREMENT_OFFICER: "PROC", HR_OFFICER: "HR", TREASURY_ACCOUNTANT: "TRS", FINANCIAL_CONTROLLER: "FC", VIEWER: "VW" };
const set = new Set(defaultPermissions().map((p) => `${p.role}|${p.module}|${p.action}`));
const roles = ROLES.filter((r) => ABBR[r]);
console.log(`| Module | ${roles.map((r) => ABBR[r]).join(" | ")} |`);
console.log(`|---|${roles.map(() => ":-:").join("|")}|`);
for (const m of MODULES) {
  const cells = roles.map((r) => ACTIONS.filter((a) => set.has(`${r}|${m}|${a}`)).map((a) => a[0].toUpperCase()).join("") || "—");
  console.log(`| ${m} | ${cells.join(" | ")} |`);
}
