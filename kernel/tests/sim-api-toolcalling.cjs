/**
 * SIM-API-TOOLCALLING — Simula uma API de texto (sem tool calling nativo) alimentando
 * a Luna kernel com respostas em texto no protocolo dela, usando o parser E o ToolGuard
 * E as tools REAIS do kernel. A "modelo" aqui é um script com respostas pré-escritas
 * (como se uma API grátis de texto tivesse gerado).
 *
 * Uso: node tests/sim-api-toolcalling.cjs
 * Não modifica NADA do kernel — sandbox fica em tests/sim-sandbox/.
 */

const path = require('path');
const fs = require('fs');

const KERNEL = path.resolve(__dirname, '..', 'packages', 'kernel');
const SANDBOX = path.resolve(__dirname, 'sim-sandbox');
fs.mkdirSync(SANDBOX, { recursive: true });

// ── Módulos REAIS do kernel ──
const { parseTagResponse, parseKimiResponse } = require(path.join(KERNEL, 'luna-soul.cjs'));
const lunaTools = require(path.join(KERNEL, 'luna-tools.cjs'));
const { ToolGuard } = require(path.join(KERNEL, 'luna-tool-guard.cjs'));

const guard = new ToolGuard(SANDBOX);

// Dispatcher: params (do JSON do modelo) → args posicionais das tools
const DISPATCH = {
  writeFile: (p) => lunaTools.writeFile(p.path, p.content),
  readFile: (p) => lunaTools.readFile(p.path),
  appendFile: (p) => lunaTools.appendFile(p.path, p.content),
  deleteFile: (p) => lunaTools.deleteFile(p.path),
  listFiles: (p) => lunaTools.listFiles(p.pattern || SANDBOX),
  createDirectory: (p) => lunaTools.createDirectory(p.path),
  executeShell: (p) => lunaTools.executeShell(p.command, { cwd: SANDBOX }),
};

let pass = 0, fail = 0;
const results = [];

async function runModelTurn(label, modelText) {
  console.log(`\n┌─ TURNA: ${label}`);
  console.log(`│ modelo (texto puro) emitiu: ${modelText.slice(0, 90).replace(/\n/g, ' ')}...`);

  const parsed = parseTagResponse(modelText) || parseKimiResponse(modelText);
  if (!parsed) {
    fail++;
    results.push({ label, ok: false, detail: 'PARSER RETORNOU NULL — ação não detectada' });
    console.log('└─ ❌ PARSER NULL — tool calling NÃO detectado');
    return;
  }
  console.log(`│ parser detectou: mode=${parsed.mode} tool=${parsed.tool || '(várias)'}`);

  const steps = parsed.mode === 'PLAN' ? parsed.steps.map(s => ({ tool: s.tool, params: s.params }))
    : parsed.mode === 'ACTION' ? [{ tool: parsed.tool, params: parsed.params }]
    : [];

  if (!steps.length) {
    results.push({ label, ok: true, detail: `mode=${parsed.mode} (texto/sugestão, sem ação — correto)` });
    console.log(`└─ ✅ mode=${parsed.mode}, sem ação (OK se era a intenção)`);
    return;
  }

  for (const step of steps) {
    const toolFn = DISPATCH[step.tool];
    if (!toolFn) {
      fail++;
      results.push({ label, ok: false, detail: `tool desconhecida: ${step.tool}` });
      console.log(`└─ ❌ tool desconhecida: ${step.tool}`);
      continue;
    }
    try {
      const result = await guard.execute(step.tool, step.params, () => toolFn(step.params));
      const ok = !(result && typeof result === 'object' && result.success === false) && !String(result).match(/^error/i);
      ok ? pass++ : fail++;
      results.push({ label, ok, detail: `${step.tool} → ${JSON.stringify(result).slice(0, 120)}` });
      console.log(`${ok ? '└─ ✅' : '└─ ❌'} ${step.tool} executada (com ToolGuard) → ${JSON.stringify(result).slice(0, 120)}`);
    } catch (e) {
      fail++;
      results.push({ label, ok: false, detail: `${step.tool} BLOQUEADA/erro: ${e.message.slice(0, 140)}` });
      console.log(`└─ 🛡️ ${step.tool} BLOQUEADA pelo guard: ${e.message.slice(0, 140)}`);
    }
  }
}

(async () => {
  const A = (json) => `[[action]]${JSON.stringify(json)}[[/action]]`;

  console.log('═══ SIMULAÇÃO: API de texto → kernel Luna (parser + ToolGuard + tools reais) ═══');
  console.log(`Sandbox: ${SANDBOX}`);

  // Cenário feliz: o "modelo" emite protocolo [[action]] perfeito
  await runModelTurn('1. writeFile tarefas.md',
    A({ tool: 'writeFile', params: { path: path.join(SANDBOX, 'tarefas.md'), content: '# Tarefas\n- [ ] Ler kernel\n- [ ] Testar fusão\n- [ ] Escrever ADR\n' } }));
  await runModelTurn('2. writeFile ideias.md',
    A({ tool: 'writeFile', params: { path: path.join(SANDBOX, 'ideias.md'), content: '# Ideias\n- Dual brain\n- Fallback chain\n' } }));
  await runModelTurn('3. listFiles',
    A({ tool: 'listFiles', params: { pattern: SANDBOX } }));
  await runModelTurn('4. appendFile tarefas.md (tarefa extra)',
    A({ tool: 'appendFile', params: { path: path.join(SANDBOX, 'tarefas.md'), content: '- [ ] Comprar GPU\n' } }));
  await runModelTurn('5. deleteFile ideias.md',
    A({ tool: 'deleteFile', params: { path: path.join(SANDBOX, 'ideias.md') } }));

  // Cenário final: resposta em texto + lista
  const listFinal = await lunaTools.listFiles(SANDBOX);
  console.log(`\n┌─ TURNA 6. resposta final em [[response]] + listagem real`);
  const finalParsed = parseTagResponse(`[[response]]Pronto! Criei tarefas.md, adicionei 1 tarefa e deletei ideias.md. Arquivos agora: ${JSON.stringify(listFinal)}[[/response]]`);
  console.log(`└─ ${finalParsed?.mode === 'CHAT' || finalParsed?.response ? '✅ resposta parseada como texto' : '❌ falha no parse de resposta'}`);

  // Casos adversos — o que estava quebrando na detecção
  await runModelTurn('7. JSON MALFORMADO (aspas sem escapar — fallback regex)',
    '[[action]]\n{"tool": "writeFile", "params": {"path": "' + path.join(SANDBOX, 'mal.md') + '", "content": "ele disse "olá" sem escapar"}}\n[[/action]]');

  await runModelTurn('8. TENTATIVA DE FUGA DA PASTA (path traversal)',
    A({ tool: 'writeFile', params: { path: path.join(SANDBOX, '..', '..', 'FORA-SANDBOX.md'), content: 'escape!' } }));

  await runModelTurn('9. FORMATO DO AGENTS.md (<luna_tool_call> XML)',
    '<luna_tool_call>\n{"name": "writeFile", "arguments": { "path": "' + path.join(SANDBOX, 'xml.md') + '", "content": "x" }}\n</luna_tool_call>');

  await runModelTurn('10. JSON bloco puro sem tags (legacy)',
    '```json\n{"tool": "writeFile", "params": { "path": "' + path.join(SANDBOX, 'legacy.md') + '", "content": "legacy ok" }}\n```');

  await runModelTurn('11. executeShell dentro da sandbox',
    A({ tool: 'executeShell', params: { command: 'echo shell-funciona > shell-test.txt' } }));

  // ── Verificação no disco ──
  console.log('\n═══ VERIFICAÇÃO NO DISCO ═══');
  const files = fs.readdirSync(SANDBOX);
  const tarefas = fs.existsSync(path.join(SANDBOX, 'tarefas.md')) ? fs.readFileSync(path.join(SANDBOX, 'tarefas.md'), 'utf8') : '';
  const fora = fs.existsSync(path.resolve(SANDBOX, '..', '..', 'FORA-SANDBOX.md'));
  console.log(`arquivos na sandbox: ${files.join(', ') || '(vazia)'}`);
  console.log(`tarefas.md: ${tarefas.split('\n').filter(Boolean).length} linhas, contém "Comprar GPU": ${tarefas.includes('Comprar GPU')}`);
  console.log(`ideias.md deletado: ${!files.includes('ideias.md')}`);
  console.log(`FORA-SANDBOX.md (fuga): ${fora ? '❌ CRIADO — guard falhou' : 'não existe ✅'}`);

  console.log('\n═══ RESUMO ═══');
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.label} — ${r.detail}`);
  console.log(`\nTOTAL: ${pass} ok / ${fail} falhas`);
})();
