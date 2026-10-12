const path = require('path');
const { IntentParser } = require(path.join(__dirname, 'agents/core/IntentParser'));

async function test() {
  const parser = new IntentParser({
    ollamaIntentModel: 'gemma2:2b',
    ollamaChatModel: 'qwen3:1.7b'
  });

  // Frase complexa que não cai em regex nenhum
  console.log('--- Test: Ollama LLM path (no regex match) ---');
  const r = await parser.parse('me mostra o status financeiro do último trimestre incluindo projeções');
  console.log('Result:', JSON.stringify(r, null, 2));
}

test().catch(err => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
});
