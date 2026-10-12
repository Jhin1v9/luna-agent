const path = require('path');
const { IntentParser } = require(path.join(__dirname, 'agents/core/IntentParser'));

async function test() {
  const parser = new IntentParser({
    ollamaIntentModel: 'gemma2:2b',
    ollamaChatModel: 'qwen3:1.7b'
  });

  console.log('Ollama client:', parser.ollama ? 'OK' : 'NOT LOADED');
  if (parser.ollama) {
    console.log('Ollama status:', JSON.stringify(parser.ollama.getStatus(), null, 2));
  }

  // Test 1: Regex fast path (should work immediately)
  console.log('\n--- Test 1: Regex fast path ---');
  const r1 = await parser.parse('criar tarefa para Abner: consertar o login');
  console.log('Result:', JSON.stringify(r1, null, 2));

  // Test 2: Ollama offline path (complex query)
  console.log('\n--- Test 2: Ollama offline path ---');
  try {
    const r2 = await parser.parse('quais são as tarefas pendentes do projeto Santafe?');
    console.log('Result:', JSON.stringify(r2, null, 2));
  } catch (err) {
    console.error('Test 2 failed:', err.message);
  }

  // Test 3: Email send (new regex)
  console.log('\n--- Test 3: Send email (new regex) ---');
  const r3 = await parser.parse('enviar email para cliente sobre o orçamento');
  console.log('Result:', JSON.stringify(r3, null, 2));

  // Test 4: Reply email (new regex)
  console.log('\n--- Test 4: Reply email (new regex) ---');
  const r4 = await parser.parse('responder ao email do Juan sobre o TPV');
  console.log('Result:', JSON.stringify(r4, null, 2));
}

test().catch(err => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
