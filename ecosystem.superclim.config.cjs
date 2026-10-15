const path = require('path');
const os = require('os');

const agentRoot = __dirname;
const workspaceRoot = path.dirname(agentRoot);
const kernelRoot = process.env.LUNA_KERNEL_ROOT || path.join(workspaceRoot, 'luna-kernel');
const brainRoot = process.env.LUNA_BRAIN_ROOT || path.join(workspaceRoot, 'brain-superclim');
const tsx = path.join(agentRoot, 'node_modules/tsx/dist/cli.mjs');

module.exports = {
  apps: [
    {
      name: 'brain-superclim',
      script: path.join(brainRoot, 'atlas/server.mjs'),
      cwd: brainRoot,
      node_args: `--env-file=${path.join(brainRoot, '.env')}`,
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-server',
      script: path.join(kernelRoot, 'apps/dashboard/luna-server.js'),
      cwd: path.join(kernelRoot, 'apps/dashboard'),
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        LUNA_HOME: process.env.LUNA_HOME || path.join(os.homedir(), '.luna-superclim'),
        LUNA_KERNEL_DIR: path.join(kernelRoot, 'packages/kernel'),
        LUNA_DIR: path.join(kernelRoot, 'packages/kernel'),
        NEXO_DIR: path.join(kernelRoot, 'apps/dashboard'),
      },
    },
    {
      name: 'luna-orchestrator',
      script: tsx,
      args: 'src/index.ts',
      cwd: path.join(agentRoot, 'apps/orchestrator'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-worker',
      script: tsx,
      args: 'src/index.ts',
      cwd: path.join(agentRoot, 'apps/worker'),
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'luna-whatsplay',
      script: tsx,
      args: 'src/index.ts',
      cwd: path.join(agentRoot, 'apps/whatsplay'),
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'luna-painel',
      script: path.join(agentRoot, 'apps/painel/node_modules/next/dist/bin/next'),
      args: 'start -p 3101 -H 127.0.0.1',
      cwd: path.join(agentRoot, 'apps/painel'),
      autorestart: true,
      max_memory_restart: '512M',
    }
  ],
};
