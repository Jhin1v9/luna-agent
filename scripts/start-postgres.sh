#!/usr/bin/env bash
# Sobe Postgres 16 para o luna-agent (dev). Idempotente.
set -euo pipefail
NAME=luna-postgres
if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "postgres container '$NAME' já está rodando (localhost:5433)"
  exit 0
fi
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker start "$NAME"
else
  docker run --name "$NAME" \
    -e POSTGRES_USER=luna \
    -e POSTGRES_PASSWORD=luna \
    -e POSTGRES_DB=luna \
    -p 5433:5432 \
    -d postgres:16
fi
echo "aguardando postgres..."
for i in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U luna >/dev/null 2>&1; then
    echo "pronto: postgres://luna:luna@localhost:5433/luna"
    exit 0
  fi
  sleep 1
done
echo "timeout aguardando postgres" >&2
exit 1
