// ============================================================
// LUNA SEMANTIC NLU v1.0 — Semantic Embedding Engine
// Fase 1 do Luna Brain v2.0 Architecture
// 
// Substitui classificação Bayesiana por embeddings vetoriais.
// Cada frase é convertida em vetor de 384 dimensões e comparada
// por similaridade de cosseno com o corpus inteiro.
// ============================================================

module.paths.unshift(require('path').resolve(__dirname, '../../node_modules'));

const { pipeline } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');

const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const INDEX_PATH = path.join(__dirname, '..', 'data', 'luna-semantic-index.json');

let embedder = null;
let semanticIndex = null;

// ── UTILITÁRIOS ──
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function log(level, ...args) {
  const prefix = `[SemanticNLU ${new Date().toISOString().slice(11,19)}]`;
  if (level === 'error') console.error(prefix, '❌', ...args);
  else if (level === 'warn') console.warn(prefix, '⚠️', ...args);
  else console.log(prefix, '✅', ...args);
}

// ── MODELO ──
async function getEmbedder() {
  if (embedder) return embedder;
  log('info', 'Carregando modelo de embedding...', MODEL_NAME);
  embedder = await pipeline('feature-extraction', MODEL_NAME);
  log('info', 'Modelo carregado');
  return embedder;
}

async function generateEmbedding(text) {
  const model = await getEmbedder();
  const result = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

// ── ÍNDICE SEMÂNTICO ──
async function buildSemanticIndex(corpus) {
  log('info', 'Construindo índice semântico...');
  const entries = [];
  const intents = Object.keys(corpus).filter(k => k !== 'None');
  
  for (const intent of intents) {
    const ex = corpus[intent];
    const texts = [
      ...(ex.pt || []),
      ...(ex.es || []),
      ...(ex.ca || []),
    ];
    
    for (const text of texts) {
      const vector = await generateEmbedding(text);
      entries.push({
        intent,
        text,
        lang: ex.pt?.includes(text) ? 'pt' : ex.es?.includes(text) ? 'es' : 'ca',
        vector,
      });
    }
  }
  
  const index = {
    version: '1.0',
    model: MODEL_NAME,
    dimensions: 384,
    createdAt: new Date().toISOString(),
    entries,
  };
  
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  log('info', `Índice salvo: ${entries.length} vetores em ${INDEX_PATH}`);
  return index;
}

function loadSemanticIndex() {
  if (semanticIndex) return semanticIndex;
  if (!fs.existsSync(INDEX_PATH)) return null;
  
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    semanticIndex = JSON.parse(raw);
    log('info', `Índice carregado: ${semanticIndex.entries.length} vetores`);
    return semanticIndex;
  } catch (e) {
    log('error', 'Falha ao carregar índice:', e.message);
    return null;
  }
}

// ── BUSCA SEMÂNTICA ──
function semanticSearch(queryVector, topK = 5) {
  const index = loadSemanticIndex();
  if (!index || !index.entries.length) return [];
  
  const scores = index.entries.map(entry => ({
    intent: entry.intent,
    text: entry.text,
    lang: entry.lang,
    score: cosineSimilarity(queryVector, entry.vector),
  }));
  
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

// ── CLASSIFICAÇÃO SEMÂNTICA ──
async function classify(text, context = {}) {
  if (!text || !text.trim()) {
    return { intent: 'None', domain: null, score: 0, action: null, entities: [] };
  }
  
  const index = loadSemanticIndex();
  if (!index) {
    log('warn', 'Índice semântico não encontrado. Execute buildSemanticIndex primeiro.');
    return { intent: 'None', domain: null, score: 0, action: null, entities: [] };
  }
  
  const queryVector = await generateEmbedding(text);
  const results = semanticSearch(queryVector, 5);
  
  if (!results.length) {
    return { intent: 'None', domain: null, score: 0, action: null, entities: [] };
  }
  
  const top = results[0];
  const domain = top.intent.split('.')[0];
  
  // Calibrar confiança: similaridade > 0.85 = alta confiança
  // Abaixo de 0.50 = baixa confiança (pode ser intent desconhecido)
  let confidence = top.score;
  if (confidence > 0.95) confidence = Math.min(1.0, confidence * 1.02);
  
  // Extrair entidades simples via regex (MVP)
  const entities = extractEntities(text);
  
  return {
    intent: top.intent,
    domain,
    score: confidence,
    action: mapIntentToAction(top.intent),
    entities,
    semanticMatches: results, // top-5 para debug
    source: 'semantic',
  };
}

// ── EXTRAÇÃO DE ENTIDADES (MVP) ──
function extractEntities(text) {
  const entities = [];
  
  // Valor monetário: 300, 300.50, 300,50
  const moneyRegex = /(?:€|EUR|euros?|\$|USD)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|EUR|euros?|\$|USD)?/gi;
  let m;
  while ((m = moneyRegex.exec(text)) !== null) {
    entities.push({ entity: 'valor', value: parseFloat(m[1].replace(',', '.')), sourceText: m[0] });
  }
  
  // Pessoas conhecidas do sistema (hardcoded MVP, depois virá do ERP)
  const people = ['abner', 'nonoke', 'enoque', 'elias', 'paulo', 'juan', 'santafe', 'tropicale'];
  const lower = text.toLowerCase();
  for (const person of people) {
    const idx = lower.indexOf(person);
    if (idx !== -1) {
      entities.push({ entity: 'pessoa', value: person, sourceText: text.slice(idx, idx + person.length) });
    }
  }
  
  // Prioridade
  if (/\bP0\b|urgente|cr[ií]tica|emerg[eê]ncia/im.test(text)) {
    entities.push({ entity: 'prioridade', value: 'P0' });
  } else if (/\bP1\b|importante|alta/im.test(text)) {
    entities.push({ entity: 'prioridade', value: 'P1' });
  } else if (/\bP2\b|normal|m[eé]dia/im.test(text)) {
    entities.push({ entity: 'prioridade', value: 'P2' });
  }
  
  return entities;
}

// ── MAPEAMENTO INTENT → ACTION ──
function mapIntentToAction(intent) {
  const map = {
    'tarefa.criar': 'criar_tarefa',
    'tarefa.concluir': 'concluir_tarefa',
    'tarefa.listar': 'listar_tarefas',
    'financeiro.adicionar_receita': 'registrar_pagamento',
    'financeiro.adicionar_despesa': 'registrar_despesa',
    'financeiro.consultar_caixa': 'consultar_caixa',
    'financeiro.projecao': 'projetar_caixa',
    'lead.criar': 'criar_lead',
    'lead.listar': 'listar_leads',
    'email.criar_rascunho': 'criar_rascunho',
    'email.enviar': 'enviar_email',
    'sistema.status': 'consultar_status',
    'ideia.criar': 'salvar_ideia',
    'link.adicionar': 'salvar_link',
  };
  return map[intent] || 'review';
}

// ── BATCH ADD (para active learning) ──
async function addTrainingExample(lang, utterance, intent) {
  const index = loadSemanticIndex();
  if (!index) return false;
  
  const vector = await generateEmbedding(utterance);
  index.entries.push({
    intent,
    text: utterance,
    lang,
    vector,
  });
  
  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  log('info', `Exemplo adicionado ao índice semântico: ${intent} "${utterance}"`);
  return true;
}

// ── EXPORTS ──
module.exports = {
  buildSemanticIndex,
  loadSemanticIndex,
  generateEmbedding,
  semanticSearch,
  classify: classify,
  addTrainingExample,
  cosineSimilarity,
};
