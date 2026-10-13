#!/usr/bin/env bash
# vps-run.sh "<comando remoto>" — roda comando no VPS nexudo-mp100 via Tailscale
exec /usr/bin/ssh -o ProxyCommand="'/c/Program Files/Tailscale/tailscale.exe' nc %h %p" -i ~/.ssh/kimi-vps -o IdentitiesOnly=yes -o ConnectTimeout=15 nexo@100.106.140.11 "$1"
