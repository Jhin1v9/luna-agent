'use strict';
/**
 * Bridge Factory — seleciona o transporte do cérebro do kernel (Fusão API).
 *   LUNA_TRANSPORT=api|cdp|auto   (default: auto = API primeiro, CDP como última rede)
 *
 * Resolução do provider de API (primeiro que existir):
 *   1. LUNA_API_BASE_URL + LUNA_API_MODEL (+ LUNA_API_KEY) — config manual
 *   2. Checkbox "usar mesma config da luna agent" (LUNA_WEB_USE_AGENT_CONFIG=true,
 *      default) → lê config/providers.json do luna-agent (mesmo contrato do painel)
 *      e pega o primeiro provider openai habilitado, em ordem de priority (a roda)
 *   3. KIMI_BASE_URL + KIMI_MODEL (+ KIMI_API_KEY) — legado do .env do kernel
 */
const fs = require('fs');
const path = require('path');

const AGENT_CONFIG_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'config', 'providers.json'),                                    // monorepo: …/luna-agent/config
  path.resolve(__dirname, '..', '..', '..', 'Luna cto', 'luna-agent', 'config', 'providers.json'),          // pasta original: Documents/…
  path.resolve(__dirname, '..', '..', '..', '..', 'Luna cto', 'luna-agent', 'config', 'providers.json'),     // original alt
  process.env.LUNA_AGENT_CONFIG_PATH || '',
].filter(Boolean);

function readAgentProvidersConfig() {
  const candidates = [
    process.env.LUNA_AGENT_CONFIG_PATH || '',
    path.resolve(__dirname, '..', '..', '..', 'Luna cto', 'luna-agent', 'config', 'providers.json'),  // pasta original do kernel
    path.resolve(__dirname, '..', '..', '..', 'config', 'providers.json'),                          // monorepo: kernel/ dentro do agent
    path.resolve(__dirname, '..', '..', '..', '..', 'Luna cto', 'luna-agent', 'config', 'providers.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      // só aceita o config do luna-agent — existem providers.json "decoy" por aí
      if (!p.replace(/\\/g, '/').includes('luna-agent')) continue;
      if (fs.existsSync(p)) return { config: JSON.parse(fs.readFileSync(p, 'utf8')), path: p };
    } catch (e) {
      console.warn(`[BRIDGE-FACTORY] providers.json ilegível em ${p}: ${e.message}`);
    }
  }
  return null;
}

// Injeta as keys do .env do luna-agent no processo (só *_API_KEY/*_TOKEN, só se
// ainda não existirem) — assim o kernel reutiliza o MESMO .env do agent.
let agentEnvLoaded = false;
function loadAgentEnv(configPath) {
  if (agentEnvLoaded || !configPath) return;
  const envPath = path.join(path.dirname(configPath), '..', '.env');
  try {
    if (!fs.existsSync(envPath)) return;
    let n = 0;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
      if (!m) continue;
      const [_, k, v] = m;
      if (!/(API_KEY|TOKEN)$/.test(k)) continue;
      if (process.env[k]) continue;
      process.env[k] = v.trim().replace(/^["']|["']$/g, '');
      n++;
    }
    agentEnvLoaded = true;
    console.log(`[BRIDGE-FACTORY] ${n} keys do .env do luna-agent injetadas no processo`);
  } catch (e) {
    console.warn(`[BRIDGE-FACTORY] falha ao ler .env do agent: ${e.message}`);
  }
}

function resolveApiProvider() {
  // 1. manual
  if (process.env.LUNA_API_BASE_URL && process.env.LUNA_API_MODEL) {
    return { baseUrl: process.env.LUNA_API_BASE_URL, model: process.env.LUNA_API_MODEL, apiKey: process.env.LUNA_API_KEY || null, label: 'manual' };
  }
  // 2. mesma config da luna agent (checkbox)
  const useAgent = (process.env.LUNA_WEB_USE_AGENT_CONFIG ?? 'true') === 'true';
  if (useAgent) {
    const found = readAgentProvidersConfig();
    if (found) {
      loadAgentEnv(found.path);
      const roda = (found.config.providers || [])
        .filter((p) => p.enabled && p.transport === 'openai' && p.baseUrl && p.model)
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
      const pick = roda[0];
      if (pick) {
        const key = pick.apiKeyEnv ? process.env[pick.apiKeyEnv] || null : null;
        console.log(`[BRIDGE-FACTORY] roda da luna agent em ${found.path}: ${pick.id} (${pick.model})`);
        return { baseUrl: pick.baseUrl, model: pick.model, apiKey: key, label: `agent:${pick.id}` };
      }
      console.warn('[BRIDGE-FACTORY] providers.json sem provider openai habilitado');
    } else {
      console.warn('[BRIDGE-FACTORY] config/providers.json do luna agent não encontrado perto do kernel');
    }
  }
  // 3. legado kernel .env
  if (process.env.KIMI_BASE_URL && process.env.KIMI_MODEL) {
    return { baseUrl: process.env.KIMI_BASE_URL, model: process.env.KIMI_MODEL, apiKey: process.env.KIMI_API_KEY || null, label: 'kernel-env' };
  }
  return null;
}

function createBridge() {
  const { KimiBridge } = require('./kimi-bridge.cjs');
  const { ApiBridge } = require('./api-bridge.cjs');

  const transport = (process.env.LUNA_TRANSPORT || 'auto').toLowerCase();
  if (transport === 'cdp') {
    console.log('[BRIDGE-FACTORY] transporte CDP (forçado por LUNA_TRANSPORT=cdp)');
    return new KimiBridge();
  }

  const provider = resolveApiProvider();
  if (provider) {
    if (transport === 'api' || transport === 'auto') {
      try {
        return new ApiBridge(provider);
      } catch (e) {
        if (transport === 'api') throw new Error(`LUNA_TRANSPORT=api mas provider inválido: ${e.message}`);
        console.warn(`[BRIDGE-FACTORY] ApiBridge falhou (${e.message}); caindo pro CDP`);
      }
    }
  } else if (transport === 'api') {
    throw new Error('LUNA_TRANSPORT=api mas nenhum provider resolvido (configure LUNA_API_* ou o config/providers.json do agent)');
  }

  console.log('[BRIDGE-FACTORY] transporte CDP (Kimi Web)');
  return new KimiBridge();
}

module.exports = { createBridge, resolveApiProvider, readAgentProvidersConfig };
