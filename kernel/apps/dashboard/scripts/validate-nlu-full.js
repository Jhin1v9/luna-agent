#!/usr/bin/env node
/**
 * ═════════════════════════════════════════════════════════════════════════════
 * LUNA NLU — Validação Completa de Todos os Intents
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Testa CADA frase do TRAINING_CORPUS contra o modelo treinado.
 * Identifica intents com classificação errada, score baixo, ou instáveis.
 * Adiciona exemplos extras e re-treina automaticamente para intents falhos.
 *
 * Uso: node scripts/validate-nlu-full.js [--fix]
 */

const fs = require('fs');
const path = require('path');
const lunaNLU = require('../services/luna-nlu');

const FIX_MODE = process.argv.includes('--fix');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function c(name, text) {
  return `${COLORS[name]}${text}${COLORS.reset}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ESTRUTURAS DE DADOS
// ═════════════════════════════════════════════════════════════════════════════

const results = {
  total: 0,
  correct: 0,
  wrong: 0,
  lowScore: 0,      // correto mas score < 0.85
  byIntent: {},     // estatísticas por intent
  wrongDetails: [], // detalhes de cada erro
};

const MIN_SCORE = 0.85;
const SCORE_WARNING = 0.50;

// Inicializa estatísticas por intent
function initIntentStats(intent) {
  if (!results.byIntent[intent]) {
    results.byIntent[intent] = {
      total: 0,
      correct: 0,
      wrong: 0,
      lowScore: 0,
      minScore: 1.0,
      maxScore: 0,
      avgScore: 0,
      scores: [],
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 1 — VALIDAÇÃO
// ═════════════════════════════════════════════════════════════════════════════

async function validateAll() {
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log(c('cyan', '  LUNA NLU — Validação Completa de Intents'));
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log();

  console.log('[1/3] Carregando modelo...');
  await lunaNLU.train();
  console.log();

  const corpus = lunaNLU.TRAINING_CORPUS;
  if (!corpus) {
    console.error(c('red', 'ERRO: TRAINING_CORPUS não exportado do módulo luna-nlu.js'));
    process.exit(1);
  }

  const intentKeys = Object.keys(corpus);
  console.log(`[2/3] Validando ${c('bold', intentKeys.length)} intents...\n`);

  for (const intent of intentKeys) {
    initIntentStats(intent);
    const translations = corpus[intent];

    for (const [lang, utterances] of Object.entries(translations)) {
      for (const utterance of utterances) {
        results.total++;
        results.byIntent[intent].total++;

        const result = await lunaNLU.process(utterance, lang);
        const predicted = result.intent;
        const score = result.score || 0;

        results.byIntent[intent].scores.push(score);
        results.byIntent[intent].minScore = Math.min(results.byIntent[intent].minScore, score);
        results.byIntent[intent].maxScore = Math.max(results.byIntent[intent].maxScore, score);

        const isCorrect = predicted === intent;
        const isLowScore = isCorrect && score < MIN_SCORE;

        if (isCorrect) {
          results.correct++;
          results.byIntent[intent].correct++;
          if (isLowScore) {
            results.lowScore++;
            results.byIntent[intent].lowScore++;
          }
        } else {
          results.wrong++;
          results.byIntent[intent].wrong++;
          results.wrongDetails.push({
            intent,
            lang,
            utterance,
            predicted,
            score,
            issue: 'wrong_intent',
          });
        }
      }
    }
  }

  // Calcula médias
  for (const intent of intentKeys) {
    const stats = results.byIntent[intent];
    stats.avgScore = stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 2 — RELATÓRIO
// ═════════════════════════════════════════════════════════════════════════════

function printReport() {
  console.log();
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log(c('cyan', '  RELATÓRIO DE VALIDAÇÃO'));
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log();

  // ── Resumo geral ──
  const pctCorrect = ((results.correct / results.total) * 100).toFixed(1);
  const pctWrong = ((results.wrong / results.total) * 100).toFixed(1);
  const pctLow = ((results.lowScore / results.total) * 100).toFixed(1);

  console.log(c('bold', 'Resumo Geral:'));
  console.log(`  Total de frases testadas: ${results.total}`);
  console.log(`  ${c('green', '✓ Classificados corretamente:')} ${results.correct} (${pctCorrect}%)`);
  console.log(`  ${c('red', '✗ Classificados ERRADOS:')} ${results.wrong} (${pctWrong}%)`);
  console.log(`  ${c('yellow', '⚠ Corretos mas score < ${MIN_SCORE}:')} ${results.lowScore} (${pctLow}%)`);
  console.log();

  // ── Intents com problemas ──
  const problematicIntents = Object.entries(results.byIntent)
    .filter(([_, s]) => s.wrong > 0 || s.lowScore > 0)
    .sort((a, b) => (b[1].wrong + b[1].lowScore) - (a[1].wrong + a[1].lowScore));

  if (problematicIntents.length > 0) {
    console.log(c('bold', `Intents com Problemas (${problematicIntents.length}):`));
    console.log();
    for (const [intent, stats] of problematicIntents) {
      const accuracy = ((stats.correct / stats.total) * 100).toFixed(1);
      const color = stats.wrong > 0 ? 'red' : 'yellow';
      console.log(`  ${c(color, '▸')} ${c('bold', intent)}`);
      console.log(`    Frases: ${stats.total} | Corretas: ${stats.correct} | Erradas: ${stats.wrong} | Baixo score: ${stats.lowScore}`);
      console.log(`    Acurácia: ${accuracy}% | Score médio: ${stats.avgScore.toFixed(3)} | Min: ${stats.minScore.toFixed(3)} | Max: ${stats.maxScore.toFixed(3)}`);

      // Mostra exemplos de erros
      const errors = results.wrongDetails.filter(d => d.intent === intent).slice(0, 5);
      for (const err of errors) {
        console.log(`    ${c('red', '✗')} [${err.lang}] "${err.utterance}"`);
        console.log(`      → Previsto: ${c('red', err.predicted)} (score: ${err.score.toFixed(3)})`);
      }
      console.log();
    }
  } else {
    console.log(c('green', '✓ Todos os intents estão 100% corretos com score adequado!'));
  }

  // ── Intents 100% perfeitos ──
  const perfectIntents = Object.entries(results.byIntent)
    .filter(([_, s]) => s.wrong === 0 && s.lowScore === 0)
    .sort((a, b) => b[1].avgScore - a[1].avgScore);

  if (perfectIntents.length > 0) {
    console.log(c('bold', `Intents Perfeitos (${perfectIntents.length}):`));
    for (const [intent, stats] of perfectIntents) {
      console.log(`  ${c('green', '✓')} ${intent} — score médio: ${stats.avgScore.toFixed(3)} (${stats.total} frases)`);
    }
    console.log();
  }

  // ── Intents NUNCA testados (sem corpus) ──
  const allDeclaredIntents = [];
  for (const [domain, info] of Object.entries(lunaNLU.DOMAINS)) {
    for (const intent of info.intents) {
      allDeclaredIntents.push(intent);
    }
  }
  const corpusIntents = Object.keys(results.byIntent);
  const missingIntents = allDeclaredIntents.filter(i => !corpusIntents.includes(i));

  if (missingIntents.length > 0) {
    console.log(c('red', `Intents SEM CORPUS de treinamento (${missingIntents.length}):`));
    for (const intent of missingIntents) {
      console.log(`  ${c('red', '⚠')} ${intent} — NÃO TEM FRASES NO TRAINING_CORPUS`);
    }
    console.log();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 3 — AUTO-FIX (retreinar intents problemáticos)
// ═════════════════════════════════════════════════════════════════════════════

async function autoFix() {
  const problematicIntents = Object.entries(results.byIntent)
    .filter(([_, s]) => s.wrong > 0 || s.lowScore > 0)
    .sort((a, b) => (b[1].wrong + b[1].lowScore) - (a[1].wrong + a[1].lowScore));

  if (problematicIntents.length === 0) {
    console.log(c('green', 'Nada para corrigir — todos os intents estão perfeitos!'));
    return;
  }

  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log(c('cyan', '  FASE 3 — AUTO-FIX: Retreinando Intents Problemáticos'));
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));
  console.log();

  for (const [intent, stats] of problematicIntents) {
    console.log(c('yellow', `▸ Corrigindo: ${intent}`));

    // Coleta frases que falharam
    const failedUtterances = results.wrongDetails
      .filter(d => d.intent === intent)
      .map(d => ({ lang: d.lang, utterance: d.utterance }));

    // Também coleta frases com score baixo
    const corpus = lunaNLU.TRAINING_CORPUS[intent];
    const lowScoreUtterances = [];
    if (corpus) {
      for (const [lang, utterances] of Object.entries(corpus)) {
        for (const utterance of utterances) {
          const result = await lunaNLU.process(utterance, lang);
          if (result.intent === intent && result.score < MIN_SCORE) {
            lowScoreUtterances.push({ lang, utterance });
          }
        }
      }
    }

    // Adiciona exemplos extras: variações das frases que falharam
    const toAdd = new Set();
    for (const { lang, utterance } of [...failedUtterances, ...lowScoreUtterances]) {
      toAdd.add(JSON.stringify({ lang, utterance }));
      // Variações simples
      const variations = generateVariations(utterance);
      for (const v of variations) {
        toAdd.add(JSON.stringify({ lang, utterance: v }));
      }
    }

    let addedCount = 0;
    for (const item of toAdd) {
      const { lang, utterance } = JSON.parse(item);
      // Evita duplicatas no corpus original
      if (!corpus || !corpus[lang] || !corpus[lang].includes(utterance)) {
        await lunaNLU.addTrainingExample(lang, utterance, intent);
        addedCount++;
      }
    }

    console.log(`  ${c('green', '✓')} Adicionados ${addedCount} exemplos (incluindo variações)`);
    console.log();
  }

  console.log(c('green', 'Auto-fix concluído! Modelo re-treinado e salvo.'));
  console.log(c('yellow', 'Execute novamente sem --fix para validar as correções.'));
}

// Gera variações simples de uma frase para reforçar o treinamento
function generateVariations(phrase) {
  const variations = [];
  const lower = phrase.toLowerCase();

  // Adiciona/Remove pontuação
  variations.push(phrase + '.');
  variations.push(phrase + '!');
  if (phrase.endsWith('.') || phrase.endsWith('!')) {
    variations.push(phrase.slice(0, -1));
  }

  // Capitaliza primeira letra
  variations.push(phrase.charAt(0).toUpperCase() + phrase.slice(1));

  // Algumas substituições comuns em PT
  const subs = [
    ['por favor', 'pfv'],
    ['pfv', 'por favor'],
    ['por favor', ''],
    ['pra', 'para'],
    ['para', 'pra'],
    ['pro', 'para o'],
    ['pro', 'pra'],
  ];

  for (const [from, to] of subs) {
    if (lower.includes(from)) {
      const replaced = phrase.replace(new RegExp(from, 'gi'), to).trim();
      if (replaced && replaced !== phrase) {
        variations.push(replaced);
      }
    }
  }

  return [...new Set(variations)].filter(v => v.length > 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// EXECUÇÃO
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  await validateAll();
  printReport();

  if (FIX_MODE && results.wrong > 0) {
    console.log();
    await autoFix();
  }

  console.log();
  console.log(c('cyan', '═════════════════════════════════════════════════════════════'));

  // Exit code: 0 se tudo perfeito, 1 se há erros
  process.exit(results.wrong > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(c('red', 'Erro fatal:'), e);
  process.exit(1);
});
