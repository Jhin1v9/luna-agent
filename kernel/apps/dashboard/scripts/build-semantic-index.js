#!/usr/bin/env node
// ============================================================
// BUILD SEMANTIC INDEX
// Gera vetores de embedding para todo o corpus Luna
// ============================================================

const { buildSemanticIndex } = require('../services/luna-semantic-nlu');
const { TRAINING_CORPUS } = require('../services/luna-nlu');

console.log('🔥 LUNA SEMANTIC INDEX BUILDER');
console.log('================================');
console.log(`Corpus: ${Object.keys(TRAINING_CORPUS).length} intents`);

const totalExamples = Object.values(TRAINING_CORPUS).reduce((sum, ex) => {
  return sum + (ex.pt?.length || 0) + (ex.es?.length || 0) + (ex.ca?.length || 0);
}, 0);
console.log(`Total exemplos: ${totalExamples}`);
console.log('Modelo: Xenova/paraphrase-multilingual-MiniLM-L12-v2');
console.log('Dimensões: 384\n');

const start = Date.now();
buildSemanticIndex(TRAINING_CORPUS)
  .then(index => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ Índice construído em ${elapsed}s`);
    console.log(`   ${index.entries.length} vetores de ${index.dimensions} dimensões`);
    console.log(`   Arquivo: backend/data/luna-semantic-index.json`);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Erro:', err);
    process.exit(1);
  });
