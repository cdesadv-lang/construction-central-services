#!/bin/sh
# Production start for managed hosts (Render, Railway, Fly, a VPS…):
#   1) apply pending migrations   2) optional idempotent bootstrap (permissions, workflows, first admin)
#   3) next start on $PORT (default 3000)
set -e
node scripts/migrate-deploy.mjs
if [ "${BOOTSTRAP_ON_START:-true}" = "true" ]; then
  npx tsx scripts/bootstrap.ts
fi
exec npx next start -p "${PORT:-3000}"
