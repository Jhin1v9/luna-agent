// one-shot: grava NVIDIA keys nos .env (gitignored) e testa. Auto-deleta ao final.
const fs = require('fs');
const keys = [
  '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',
  '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',
];
const appendEnv = (path) => {
  let cur = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  cur = cur.split('\n').filter(l => !l.startsWith('NVIDIA_API_KEY')).join('\n');
  fs.writeFileSync(path, cur.trimEnd() + `\nNVIDIA_API_KEY=${keys[0]}\nNVIDIA_API_KEY_2=${keys[1]}\n`);
  console.log('env atualizado:', path);
};
appendEnv('C:/Users/Abner/Documents/luna-kernel/.env');
appendEnv('C:/Users/Abner/Documents/Luna cto/luna-agent/.env');

(async () => {
  for (const [i, key] of keys.entries()) {
    for (const model of ['moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4.1-flash']) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responda apenas: ok' }], max_tokens: 8, temperature: 0 }),
        });
        const txt = await res.text();
        const j = JSON.parse(txt);
        const content = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.message?.reasoning_content ?? '';
        console.log(`key${i + 1} @ ${model} → HTTP ${res.status} | resposta: "${String(content).slice(0, 40)}" | usage: ${JSON.stringify(j.usage || {})}`);
      } catch (e) {
        console.log(`key${i + 1} @ ${model} → ERRO: ${e.message.slice(0, 100)}`);
      }
    }
  }
  fs.unlinkSync(__filename);
  console.log('(script temporário apagado)');
})();
