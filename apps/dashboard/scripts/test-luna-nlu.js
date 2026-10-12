#!/usr/bin/env node
/**
 * ═════════════════════════════════════════════════════════════════════════════
 * LUNA NLU — Suite de Testes Automatizados
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Testa: intents principais, fallback None, entities NER, multi-idioma
 * Uso: node scripts/test-luna-nlu.js
 */

const lunaNLU = require('../services/luna-nlu');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

let passed = 0;
let failed = 0;

function assert(condition, label, details = '') {
  if (condition) {
    passed++;
    console.log(`  ${COLORS.green}✓${COLORS.reset} ${label}`);
  } else {
    failed++;
    console.log(`  ${COLORS.red}✗${COLORS.reset} ${label}`);
    if (details) console.log(`    ${COLORS.dim}→ ${details}${COLORS.reset}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE INTENT CLASSIFICATION
// ═════════════════════════════════════════════════════════════════════════════

const INTENT_TESTS = [
  // Email
  { text: 'responde esse email pro cliente', lang: 'pt', expected: 'email.responder', minScore: 0.85 },
  { text: 'responde este mensaje', lang: 'es', expected: 'email.responder', minScore: 0.85 },
  { text: 'respon aquest email', lang: 'ca', expected: 'email.responder', minScore: 0.85 },
  { text: 'resume essa conversa', lang: 'pt', expected: 'email.resumir', minScore: 0.85 },
  { text: 'manda pra lixeira', lang: 'pt', expected: 'email.mover_lixeira', minScore: 0.50 },

  // Tarefas
  { text: 'cria uma tarefa urgente', lang: 'pt', expected: 'tarefa.criar', minScore: 0.85 },
  { text: 'crea una tarea', lang: 'es', expected: 'tarefa.criar', minScore: 0.85 },
  { text: 'mostra minhas tarefas', lang: 'pt', expected: 'tarefa.listar', minScore: 0.85 },
  { text: 'marca como concluída', lang: 'pt', expected: 'tarefa.concluir', minScore: 0.85 },
  { text: 'atribui tarefa pro Abner', lang: 'pt', expected: 'tarefa.atribuir', minScore: 0.50 },

  // Financeiro
  { text: 'quanto temos no caixa', lang: 'pt', expected: 'financeiro.consultar_caixa', minScore: 0.85 },
  { text: 'cuánto tenemos en caja', lang: 'es', expected: 'financeiro.consultar_caixa', minScore: 0.85 },
  { text: 'adiciona despesa', lang: 'pt', expected: 'financeiro.adicionar_despesa', minScore: 0.85 },

  // WhatsApp
  { text: 'manda zap pro cliente', lang: 'pt', expected: 'whatsapp.enviar_mensagem', minScore: 0.85 },
  { text: 'responde no whatsapp', lang: 'pt', expected: 'whatsapp.responder_cliente', minScore: 0.85 },

  // Orçamentos
  { text: 'faz proposta pro cliente', lang: 'pt', expected: 'orcamento.criar', minScore: 0.85 },
  { text: 'envia proposta comercial', lang: 'pt', expected: 'orcamento.enviar_cliente', minScore: 0.85 },

  // Sistema
  { text: 'o que você pode fazer', lang: 'pt', expected: 'sistema.ajuda', minScore: 0.85 },
  { text: 'como está o sistema', lang: 'pt', expected: 'sistema.status', minScore: 0.85 },
  { text: 'què pots fer', lang: 'ca', expected: 'sistema.ajuda', minScore: 0.85 },
];

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE FALLBACK (None)
// ═════════════════════════════════════════════════════════════════════════════

const FALLBACK_TESTS = [
  { text: 'batata frita no espaço sideral', lang: 'pt', maxScore: 0.50 },
  { text: 'cachorro quente', lang: 'pt', maxScore: 0.50 },
  { text: 'eu gosto de pizza', lang: 'pt', maxScore: 0.50 },
  { text: 'vamos ao cinema', lang: 'pt', maxScore: 0.50 },
  { text: 'xyz abc def ghi', lang: 'pt', maxScore: 0.50 },
  { text: 'patatas fritas', lang: 'es', maxScore: 0.50 },
  { text: 'me gusta la pizza', lang: 'es', maxScore: 0.50 },
  { text: 'asdfghjkl', lang: 'pt', maxScore: 0.50 },
  { text: 'foo bar baz qux', lang: 'pt', maxScore: 0.50 },
  { text: 'receita de bolo de chocolate', lang: 'pt', maxScore: 0.50 },
];

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE ENTITIES (NER)
// ═════════════════════════════════════════════════════════════════════════════

const ENTITY_TESTS = [
  { text: 'cria tarefa urgente para o cliente Nexo', lang: 'pt', expectedEntities: ['tarefa', 'prioridade', 'cliente'] },
  { text: 'envia mensagem pro cliente pelo whatsapp', lang: 'pt', expectedEntities: ['cliente'] },
  { text: 'cria projeto novo', lang: 'pt', expectedEntities: ['projeto'] },
  { text: 'faz orçamento urgente', lang: 'pt', expectedEntities: ['orcamento', 'prioridade'] },
];

// ═════════════════════════════════════════════════════════════════════════════
// EXECUÇÃO
// ═════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log(`${COLORS.cyan}═════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.cyan}  LUNA NLU — Suite de Testes Automatizados${COLORS.reset}`);
  console.log(`${COLORS.cyan}═════════════════════════════════════════════════════════════${COLORS.reset}\n`);

  console.log('[1/4] Treinando modelo...');
  await lunaNLU.train();
  console.log('');

  // ── Testes de Intent Classification ──
  console.log(`[2/4] ${COLORS.yellow}Testes de Intent Classification (${INTENT_TESTS.length})${COLORS.reset}`);
  for (const t of INTENT_TESTS) {
    const result = await lunaNLU.process(t.text, t.lang);
    const ok = result.intent === t.expected && result.score >= t.minScore;
    assert(
      ok,
      `[${t.lang}] "${t.text}" → ${result.intent} (score: ${result.score.toFixed(3)})`,
      !ok ? `Esperado: ${t.expected} >= ${t.minScore}` : ''
    );
  }
  console.log('');

  // ── Testes de Fallback ──
  console.log(`[3/4] ${COLORS.yellow}Testes de Fallback / None (${FALLBACK_TESTS.length})${COLORS.reset}`);
  for (const t of FALLBACK_TESTS) {
    const result = await lunaNLU.process(t.text, t.lang);
    const isNone = result.intent === 'None';
    const ok = isNone || result.score <= t.maxScore;
    assert(
      ok,
      `[${t.lang}] "${t.text}" → ${result.intent} (score: ${result.score.toFixed(3)})`,
      !ok ? `Esperado: None ou score <= ${t.maxScore}` : ''
    );
  }
  console.log('');

  // ── Testes de Entities ──
  console.log(`[4/4] ${COLORS.yellow}Testes de Entities / NER (${ENTITY_TESTS.length})${COLORS.reset}`);
  for (const t of ENTITY_TESTS) {
    const result = await lunaNLU.process(t.text, t.lang);
    const foundTypes = result.entities.map((e) => e.type);
    const missing = t.expectedEntities.filter((e) => !foundTypes.includes(e));
    const ok = missing.length === 0;
    assert(
      ok,
      `[${t.lang}] "${t.text}" → entities: [${foundTypes.join(', ') || 'nenhuma'}]`,
      !ok ? `Faltando: ${missing.join(', ')}` : ''
    );
  }
  console.log('');

  // ── Resumo ──
  console.log(`${COLORS.cyan}═════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`  Total: ${passed + failed} testes`);
  console.log(`  ${COLORS.green}Passaram: ${passed}${COLORS.reset}`);
  console.log(`  ${COLORS.red}Falharam: ${failed}${COLORS.reset}`);
  const pct = ((passed / (passed + failed)) * 100).toFixed(1);
  console.log(`  Taxa de sucesso: ${pct}%`);
  console.log(`${COLORS.cyan}═════════════════════════════════════════════════════════════${COLORS.reset}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(`${COLORS.red}Erro fatal:${COLORS.reset}`, e);
  process.exit(1);
});
