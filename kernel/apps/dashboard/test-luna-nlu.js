const lunaNLU = require('./services/luna-nlu');

(async () => {
  console.log('Iniciando treinamento...');
  await lunaNLU.train();
  console.log('Treinamento concluído!\n');

  const tests = [
    { text: 'responde esse email', lang: 'pt' },
    { text: 'resume essa conversa', lang: 'pt' },
    { text: 'cria uma tarefa', lang: 'pt' },
    { text: 'quanto temos no caixa', lang: 'pt' },
    { text: 'responde este email', lang: 'es' },
    { text: 'crea una tarea', lang: 'es' },
    { text: 'respon aquest email', lang: 'ca' },
    { text: 'ajuda', lang: 'pt' },
    { text: 'manda mensagem no whatsapp', lang: 'pt' },
    { text: 'cria orçamento', lang: 'pt' },
    { text: 'arquiva esse email', lang: 'pt' },
    { text: 'manda pra lixeira', lang: 'pt' },
    { text: 'sincroniza emails', lang: 'pt' },
    { text: 'analisa esse email', lang: 'pt' },
    { text: 'como está o sistema', lang: 'pt' },
    { text: 'manda orçamento pro cliente', lang: 'pt' },
    { text: 'marca como concluída', lang: 'pt' },
    { text: 'atribui tarefa pro Abner', lang: 'pt' },
    { text: 'adiciona despesa', lang: 'pt' },
    { text: 'responde no whatsapp', lang: 'pt' },
  ];

  for (const t of tests) {
    const r = await lunaNLU.process(t.text, t.lang);
    const flag = r.action === 'execute' ? '✅' : r.action === 'confirm' ? '⚠️' : r.action === 'suggest' ? '❓' : '❌';
    console.log(`${flag} [${t.lang}] "${t.text}" → intent=${r.intent} score=${r.score.toFixed(3)} action=${r.action}`);
  }

  console.log('\n--- Teste de fallback (frase sem sentido) ---');
  const fallback = await lunaNLU.process('batata frita no espaço', 'pt');
  console.log(`[${fallback.language}] "batata frita no espaço" → intent=${fallback.intent} score=${fallback.score.toFixed(3)} action=${fallback.action}`);

  console.log('\n--- Intents disponíveis ---');
  const intents = lunaNLU.getIntents();
  console.log(`Total: ${intents.length} intents em ${new Set(intents.map(i => i.domain)).size} domínios`);
})();
