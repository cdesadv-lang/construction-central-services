#!/usr/bin/env node
// Applies pending Prisma migrations (`prisma migrate deploy`) for managed hosts.
//   * direct (non-pooled) connection used for migrations, first one set of: MIGRATE_DATABASE_URL, DIRECT_URL,
//     DATABASE_URL_UNPOOLED (Neon / Vercel integration), POSTGRES_URL_NON_POOLING (Supabase / Vercel);
//     falls back to DATABASE_URL. Poolers (PgBouncer in transaction mode) are fine for the app but not for migrations.
//   * SKIP_MIGRATIONS=true — skip (e.g. Vercel preview builds without a database).
// `prisma migrate deploy` takes a Postgres advisory lock, so concurrent instances are safe.
import { spawnSync } from "node:child_process";

if (process.env.SKIP_MIGRATIONS === "true") {
  console.log("[migrate] SKIP_MIGRATIONS=true — skipping prisma migrate deploy");
  process.exit(0);
}
const KEYS = ["MIGRATE_DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"];
const which = KEYS.find((k) => process.env[k]);
const url = which && process.env[which];
if (!url) {
  console.error("[migrate] DATABASE_URL (or DIRECT_URL) is not set — cannot apply migrations");
  process.exit(1);
}
console.log(`[migrate] prisma migrate deploy (using ${which})`);
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);
