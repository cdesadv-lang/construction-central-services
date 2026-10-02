#!/usr/bin/env bash
# Restore a dump produced by scripts/backup.sh.
# Usage: scripts/restore.sh backups/ccs_YYYYMMDD_HHMMSS.dump [target_database_url]
# WARNING: --clean drops and recreates objects in the target database.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: restore.sh <file.dump> [database_url]}"
TARGET="${2:-${DATABASE_URL:-}}"
if [ -z "$TARGET" ] && [ -f .env ]; then TARGET="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"; fi
: "${TARGET:?target database url not set}"
TARGET="${TARGET%%\?*}"
read -r -p "Restore $FILE into ${TARGET%%@*}@… (existing data will be replaced)? [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --dbname="$TARGET" "$FILE"
echo "restore complete"
