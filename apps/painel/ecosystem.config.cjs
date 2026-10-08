// pm2: painel da Luna na 3101 (registrar com `pm2 save` p/ sobreviver a reboot)
module.exports = {
  apps: [
    {
      name: 'painel-luna',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3101 -H 127.0.0.1',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
