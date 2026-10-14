#!/usr/bin/env bash
# Deploy das envs do VPS — .env.vps é a FONTE DE VERDADE das envs do luna-agent
# que roda no VPS (nexudo). Nunca edite o .env direto no VPS; edite o .env.vps
# aqui no PC e rode este script. O .env local do PC NÃO é versionado nem
# transferido — mexer nele não afeta o VPS.
#
# Uso: bash scripts/deploy-env-vps.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
scp "$DIR/.env.vps" vps:/home/nexo/luna-agent/.env
echo "OK: .env.vps enviado para vps:~/luna-agent/.env"
echo "Reinicie os serviços lá: ssh vps 'pm2 restart all'"
