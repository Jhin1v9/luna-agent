#!/usr/bin/env bash
# vps-cp.sh <remoto> <local> — scp do VPS via Tailscale
exec /usr/bin/scp -o ProxyCommand="'/c/Program Files/Tailscale/tailscale.exe' nc %h %p" -i ~/.ssh/kimi-vps -o IdentitiesOnly=yes -o ConnectTimeout=15 "nexo@100.106.140.11:$1" "$2"
