#!/usr/bin/env bash
# Backup do Postgres do luna-agent (§30 backup/restore).
# (MSYS_NO_PATHCONV: sem isso, Git Bash converte /tmp do container em path Windows)
export MSYS_NO_PATH_CONV=1 MSYS_NO_PATHCONV=1
# Uso: bash scripts/backup-db.sh   → backups/luna-YYYYMMDD-HHMM.dump
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M)
OUT="backups/luna-${STAMP}.dump"
mkdir -p backups
docker exec luna-postgres pg_dump -U luna -d luna -Fc -f /tmp/backup.dump
docker cp luna-postgres:/tmp/backup.dump "$OUT"
docker exec luna-postgres rm /tmp/backup.dump
ls -la "$OUT"
echo "backup ok: $OUT"
