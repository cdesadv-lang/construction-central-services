#!/bin/sh
# Applies pending migrations, optionally seeds demo data, then starts the app.
set -e
echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_START=true -> seeding demo data (TRUNCATES ALL TABLES)"
  npx tsx prisma/seed.ts
fi
exec "$@"
