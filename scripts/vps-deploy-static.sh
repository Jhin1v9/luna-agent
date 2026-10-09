#!/usr/bin/env bash
# vps-deploy-static.sh — publica uma pasta de página estática na VPS (Nexo Digital)
# Uso: bash scripts/vps-deploy-static.sh <pasta-local> <subpasta-no-html> [rota-publica]
#   pasta-local        : diretório local com index.html (+ assets) — ex: analises/ia-concorrentes
#   subpasta-no-html   : destino em static-htmls/html/ — ex: agente-ia/analises/concorrentes
#   rota-publica (opt) : se dada, faz curl de verificação — ex: agente-ia/analises/concorrentes/
# Exige: ssh alias `vps` (Tailscale). Fail-closed: aborta em qualquer falha.
set -euo pipefail

LOCAL_DIR="${1:?uso: vps-deploy-static.sh <pasta-local> <subpasta-no-html> [rota-publica]}"
REMOTE_SUB="${2:?falta <subpasta-no-html>}"
PUBLIC_ROUTE="${3:-}"

REMOTE_BASE="/home/nexo/Documentos/VPS/VPS/static-htmls/html"

[ -f "$LOCAL_DIR/index.html" ] || { echo "ERRO: $LOCAL_DIR/index.html não existe"; exit 1; }

echo ">> subindo '$LOCAL_DIR' -> vps:$REMOTE_BASE/$REMOTE_SUB"
ssh vps "mkdir -p '$REMOTE_BASE/$REMOTE_SUB'"
scp "$LOCAL_DIR"/*.html "$LOCAL_DIR"/*.css vps:"$REMOTE_BASE/$REMOTE_SUB/"

if [ -n "$PUBLIC_ROUTE" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -A "Mozilla/5.0" "https://vps.nexo-digital.app/${PUBLIC_ROUTE}")
  echo ">> verificação: https://vps.nexo-digital.app/${PUBLIC_ROUTE} -> HTTP $CODE"
  [ "$CODE" = "200" ] || { echo "ERRO: rota não pública (403 = sem handle no Caddy; veja .brain/luna/toolkit.md)"; exit 1; }
fi
echo "OK"
