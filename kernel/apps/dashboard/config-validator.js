/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Config Validator — backend-wide guardrails for security-sensitive env vars
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && String(secret).trim().length > 0) {
    return String(secret).trim();
  }

  if (process.env.NODE_ENV === 'test') {
    console.warn('[SECURITY] JWT_SECRET não definido. Modo teste detectado — usando fallback temporário inseguro.');
    return 'nexo-test-secret-2026';
  }

  console.error('\n❌❌❌ FATAL: JWT_SECRET não está definido no ambiente ❌❌❌');
  console.error('   Sessões seriam invalidadas a cada reinicialização se continuássemos.');
  console.error('   Ação obrigatória: defina JWT_SECRET nas variáveis de ambiente (Render Dashboard, .env ou PM2 env).');
  console.error(`   NODE_ENV atual: ${process.env.NODE_ENV || '(não definido)'}\n`);
  process.exit(1);
}

function resolvePort(name, envVar, fallback) {
  const raw = process.env[envVar];
  const port = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[FATAL] ${name} (${envVar}=${raw}) não é uma porta válida.`);
    process.exit(1);
  }
  console.log(`[CONFIG] ${name}=${port} (fonte: ${raw ? envVar : 'fallback ' + fallback})`);
  return port;
}

module.exports = { resolveJwtSecret, resolvePort };
