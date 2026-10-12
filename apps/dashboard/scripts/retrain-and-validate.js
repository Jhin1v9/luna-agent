#!/usr/bin/env node
/**
 * Força retreinamento do modelo NLU com corpus corrigido e valida.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MODEL_PATH = path.join(__dirname, '..', 'data', 'luna-model.nlp');

console.log('[1/3] Apagando modelo antigo...');
if (fs.existsSync(MODEL_PATH)) {
  fs.unlinkSync(MODEL_PATH);
  console.log('  ✓ Modelo antigo removido');
}

console.log('\n[2/3] Retreinando modelo com corpus corrigido...');
console.log('  (isso pode levar 30-60 segundos)...');

try {
  execSync('node -e "const nlu = require(\'../services/luna-nlu\'); nlu.train().then(() => process.exit(0))"', {
    cwd: __dirname,
    stdio: 'inherit',
    timeout: 120000,
  });
} catch (e) {
  console.error('Erro no treinamento:', e.message);
  process.exit(1);
}

console.log('\n[3/3] Rodando validação completa...\n');
try {
  execSync('node scripts/validate-nlu-full.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    timeout: 300000,
  });
} catch (e) {
  // validate-nlu-full.js retorna exit 1 se houver erros, o que é esperado
  process.exit(e.status || 1);
}
