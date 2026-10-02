// Non-destructive production bootstrap (idempotent):
//   * default role × module × action permissions (fresh install only, i.e. no users yet)
//   * default global approval workflows (only when none exist)
//   * the first SUPER_ADMIN from ADMIN_EMAIL / ADMIN_PASSWORD (only when no user with that email exists)
// Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' npm run db:bootstrap
// Unlike `npm run db:seed` it never deletes data, so it is safe to run on every deploy.
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { defaultPermissions } from "../src/lib/permissions";
import { DEFAULT_WORKFLOWS } from "../src/server/default-workflows";

async function main() {
  const done: string[] = [];
  // Fresh install (no users yet): load the full default matrix (some migrations pre-insert rows for new modules,
  // so "table empty" is not a reliable signal). Existing installs keep their edited matrix untouched.
  if ((await prisma.user.count()) === 0) {
    const r = await prisma.rolePermission.createMany({ data: defaultPermissions(), skipDuplicates: true });
    done.push(`permissions: ${r.count}`);
  }
  if ((await prisma.approvalWorkflow.count()) === 0) {
    for (const w of DEFAULT_WORKFLOWS) {
      await prisma.approvalWorkflow.create({
        data: { companyId: null, docType: w.docType, name: w.name, steps: { create: w.steps.map(([name, role], i) => ({ order: i + 1, name, role })) } },
      });
    }
    done.push(`workflows: ${DEFAULT_WORKFLOWS.length}`);
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      if (!password || password.length < 10) throw new Error("ADMIN_PASSWORD (at least 10 characters) is required to create the first admin");
      await prisma.user.create({ data: { email, name: process.env.ADMIN_NAME || "System Administrator", role: "SUPER_ADMIN", allCompanies: true, passwordHash: await bcrypt.hash(password, 10) } });
      done.push(`admin created: ${email}`);
    }
  } else if ((await prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true } })) === 0) {
    console.warn("[bootstrap] no SUPER_ADMIN exists — set ADMIN_EMAIL and ADMIN_PASSWORD and run again");
  }
  console.log(`[bootstrap] ${done.length ? done.join(", ") : "nothing to do"}`);
}

main()
  .catch((e) => {
    console.error("[bootstrap] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
