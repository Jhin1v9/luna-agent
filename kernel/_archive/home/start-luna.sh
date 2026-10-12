#!/bin/bash
export LUNA_KERNEL_DIR=/home/elias-mendes/.luna-kernel
cd /home/elias-mendes/NEXO_DASHBOARD_PRO/backend && nohup node luna-server.js > /tmp/luna-server.log 2>&1 &
cd /home/elias-mendes/NEXO_DASHBOARD_PRO/agents && nohup node telegram-luna-adapter.cjs > /tmp/telegram-adapter.log 2>&1 &
echo "Luna iniciada!"
