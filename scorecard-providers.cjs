// Scorecard: testa cada provider da roda DIRETO na API dele.
// Mede: latência, resposta, e capacidade de emitir tool no formato [[action]].
const fs = require('fs');
const env = {};
for (const l of fs.readFileSync('C:/Users/Abner/Documents/Luna cto/luna-agent/.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const cfg = JSON.parse(fs.readFileSync('C:/Users/Abner/Documents/Luna cto/luna-agent/config/providers.json', 'utf8'));

const TOOL_PROMPT = `Você é Luna, runtime de tools. Responda APENAS um bloco [[action]] com JSON válido.\nTarefa: listar o diretório atual.`;

async function testProvider(p) {
  const key = p.apiKeyEnv ? env[p.apiKeyEnv] : null;
  if (p.apiKeyEnv && !key) return { status: 'SEM KEY' };
  const t0 = Date.now();
  try {
    const r = await fetch(p.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key || 'dummy'}` },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: 'user', content: TOOL_PROMPT }],
        temperature: 0, stream: false, max_tokens: 600,
      }),
    });
    const lat = Date.now() - t0;
    const txt = await r.text();
    if (!r.ok) return { status: `HTTP ${r.status}`, lat, detalhe: txt.slice(0, 140) };
    let content = '';
    try { content = JSON.parse(txt).choices?.[0]?.message?.content || ''; } catch { return { status: 'JSON INVÁLIDO', lat, detalhe: txt.slice(0, 100) }; }
    if (!content.trim()) return { status: 'VAZIO', lat };
    const temAction = content.includes('[[action]]') || /"tool"\s*:/.test(content);
    return { status: temAction ? 'TOOL OK' : 'RESPONDEU (sem tool)', lat, detalhe: content.replace(/\s+/g, ' ').slice(0, 110) };
  } catch (e) {
    return { status: 'ERRO', lat: Date.now() - t0, detalhe: String(e.message || e).slice(0, 120) };
  }
}

(async () => {
  const roda = cfg.providers
    .filter((p) => p.enabled && p.transport === 'openai' && p.baseUrl && p.model)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  console.log('provider | modelo | status | latência | detalhe');
  console.log('-'.repeat(90));
  for (const p of roda) {
    const r = await testProvider(p);
    console.log(`${p.id} | ${p.model} | ${r.status} | ${r.lat ?? '-'}ms | ${r.detalhe || ''}`);
  }
})();
