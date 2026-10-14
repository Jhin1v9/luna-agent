import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';
import path from 'path';

/**
 * Auto-discover the Luna backend port.
 */
function discoverBackendPort() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'apps', 'dashboard', '.luna-runtime.json'),
    path.resolve(__dirname, '..', '.luna-runtime.json'),
    path.resolve(__dirname, '.luna-runtime.json'),
  ];

  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.apiPort) {
        console.log(`[vite] Backend discovered via ${file} → port ${data.apiPort}`);
        return data.apiPort;
      }
    } catch { /* ignore */ }
  }

  const fallbackPorts = [3458, 3000, 8080, 5000, 3456];
  console.log(`[vite] No runtime config found. Trying fallback ports: ${fallbackPorts.join(', ')}`);
  return fallbackPorts[0];
}

const BACKEND_PORT = process.env.LUNA_CONFIG_PORT || discoverBackendPort();
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

export default defineConfig({
  // Caminhos relativos: permite servir o app em qualquer prefixo (/luna/ via Caddy)
  base: './',
  plugins: [svelte(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    https: true,
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.duckdns.org', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            console.warn(`[vite] Proxy error to ${BACKEND_URL}${req.url}: ${err.message}`);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Backend unavailable', port: BACKEND_PORT }));
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
