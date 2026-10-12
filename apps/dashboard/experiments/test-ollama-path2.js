const path = require('path');
const { IntentParser } = require(path.join(__dirname, 'agents/core/IntentParser'));

async function test() {
  const parser = new IntentParser({
    ollamaIntentModel: 'gemma2:2b',
    ollamaChatModel: 'qwen3:1.7b'
  });

  // Frase que definitivamente não cai em regex nenhum
  console.log('--- Test: Ollama LLM path (truly no regex match) ---');
  const r = await parser.parse('qual a previsão do tempo para amanhã em barcelona');
  console.log('Result:', JSON.stringify(r, null, 2));
}

test().catch(err => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
});
