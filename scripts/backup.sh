#!/usr/bin/env bash
# PostgreSQL backup for Construction Central Services.
# Usage: scripts/backup.sh [backup_dir]
# Reads DATABASE_URL from the environment or from .env. Keeps RETENTION_DAYS (default 14) days of dumps.
# Also archives uploaded documents (UPLOAD_DIR) next to the dump.
# Cron example (daily 02:30):
#   30 2 * * * cd /opt/ccs && ./scripts/backup.sh /var/backups/ccs >> /var/log/ccs-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
DB_URL="${DATABASE_URL%%\?*}"   # pg_dump does not understand Prisma's ?schema=public
DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
UPLOADS="${UPLOAD_DIR:-./storage/uploads}"
mkdir -p "$DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$DIR/ccs_${TS}.dump"
echo "[$(date -Is)] dumping database -> $OUT"
pg_dump --format=custom --no-owner --no-privileges --file="$OUT" "$DB_URL"
pg_restore --list "$OUT" > /dev/null   # verify the archive is readable
if [ -d "$UPLOADS" ]; then
  tar -czf "$DIR/ccs_uploads_${TS}.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
fi
find "$DIR" -name 'ccs_*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$DIR" -name 'ccs_uploads_*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -Is)] done ($(du -h "$OUT" | cut -f1))"
