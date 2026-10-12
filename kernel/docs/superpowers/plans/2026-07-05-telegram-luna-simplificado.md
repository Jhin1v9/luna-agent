# Modo Telegram Simplificado da LUNA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar um modo simplificado da LUNA para Telegram, com pipeline de classificação/seleção via Kimi, execução apenas de tools do Dashboard Pro, bubbles estilizados e código escalável via registry centralizado.

**Architecture:** Adicionar um branch `channel === 'telegram'` no início do `processMessageStream` do `luna-soul.cjs` que delega para um pipeline dedicado (`_telegramPipeline`). Esse pipeline classifica a intenção do usuário, seleciona a tool do dashboard via Kimi, executa via `lunaTools` e emite eventos que o adapter renderiza como bubbles no Telegram. As tools são descritas em um registry centralizado (`dashboard-tool-registry.cjs`) para facilitar adições futuras.

**Tech Stack:** Node.js, CommonJS, Playwright/CDP (Kimi Bridge), node-telegram-bot-api.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/kernel/dashboard-tool-registry.cjs` | Novo. Registry centralizado das categorias e tools do Dashboard Pro disponíveis no Telegram. |
| `packages/kernel/luna-soul.cjs` | Modificado. Adiciona branch Telegram no `processMessageStream` e métodos `_telegramPipeline`, `_classifyIntent`, `_selectDashboardTool`, `_executeDashboardTool`, `_formatTelegramResponse`. |
| `packages/kernel/telegram-luna-adapter.cjs` | Modificado. Passa `channel: 'telegram'` para o Luna Soul e renderiza os eventos como bubbles estilizados. |
| `packages/kernel/personas/telegram-assistant.json` | Nova persona com identidade da Luna (19 anos, nerd, descontraída). |
| `packages/kernel/config/luna-prompt-config.json` | Referenciar a nova persona (se necessário). |
| `packages/kernel/luna-tools.cjs` | Verificar que todos os nomes do registry existem; adicionar caso faltem. |

---

## Task 1: Create Dashboard Tool Registry

**Files:**
- Create: `packages/kernel/dashboard-tool-registry.cjs`

- [ ] **Step 1: Create the registry file with all categories**

```js
// packages/kernel/dashboard-tool-registry.cjs
const DASHBOARD_TOOL_REGISTRY = {
  tarefas: {
    label: 'Tarefas',
    emoji: '📝',
    description: 'Gerenciar tarefas do dashboard',
    tools: [
      { name: 'dashboardListTasks', description: 'Lista tarefas do dashboard', params: ['status'] },
      { name: 'dashboardCreateTask', description: 'Cria uma nova tarefa', params: ['title', 'priority', 'description'] },
      { name: 'dashboardUpdateTask', description: 'Atualiza uma tarefa existente', params: ['id', 'title', 'status', 'priority'] },
      { name: 'dashboardCompleteTask', description: 'Marca uma tarefa como concluída', params: ['id'] },
      { name: 'dashboardDeleteTask', description: 'Exclui uma tarefa', params: ['id'] },
      { name: 'dashboardAddComment', description: 'Adiciona um comentário em uma tarefa', params: ['id', 'text'] },
    ],
  },
  leads: {
    label: 'Leads',
    emoji: '💼',
    description: 'Gerenciar leads no dashboard',
    tools: [
      { name: 'dashboardListLeads', description: 'Lista leads', params: [] },
      { name: 'dashboardCreateLead', description: 'Cria um novo lead', params: ['name', 'email', 'phone'] },
      { name: 'dashboardUpdateLead', description: 'Atualiza um lead', params: ['id', 'name', 'email'] },
      { name: 'dashboardConvertLead', description: 'Converte lead em cliente', params: ['id'] },
      { name: 'dashboardDeleteLead', description: 'Exclui um lead', params: ['id'] },
    ],
  },
  financeiro: {
    label: 'Financeiro',
    emoji: '💰',
    description: 'Resumo financeiro, pagamentos e receitas',
    tools: [
      { name: 'dashboardGetFinanceSummary', description: 'Resumo financeiro geral', params: [] },
      { name: 'dashboardListPayments', description: 'Lista pagamentos', params: [] },
      { name: 'dashboardCreatePayment', description: 'Cria um pagamento', params: ['clientId', 'amount', 'dueDate'] },
      { name: 'dashboardReceiveSplit', description: 'Registra recebimento parcelado', params: ['paymentId', 'amount'] },
    ],
  },
  despesas: {
    label: 'Despesas',
    emoji: '💸',
    description: 'Controle de despesas',
    tools: [
      { name: 'dashboardListExpenses', description: 'Lista despesas', params: [] },
      { name: 'dashboardCreateExpense', description: 'Cria uma despesa', params: ['description', 'amount', 'dueDate'] },
      { name: 'dashboardUpdateExpense', description: 'Atualiza uma despesa', params: ['id', 'description', 'amount'] },
      { name: 'dashboardDeleteExpense', description: 'Exclui uma despesa', params: ['id'] },
      { name: 'dashboardPayExpense', description: 'Registra pagamento de despesa', params: ['id'] },
    ],
  },
  caixa: {
    label: 'Caixa',
    emoji: '🏦',
    description: 'Movimentações de caixa',
    tools: [
      { name: 'dashboardGetCashBox', description: 'Saldo atual do caixa', params: [] },
      { name: 'dashboardListCashHistory', description: 'Histórico de movimentações do caixa', params: [] },
      { name: 'dashboardAddCashEntry', description: 'Adiciona entrada ou saída no caixa', params: ['type', 'amount', 'description'] },
      { name: 'dashboardReconcileCashBox', description: 'Reconcilia o caixa', params: ['expectedAmount'] },
      { name: 'dashboardAdjustCashBox', description: 'Ajusta o saldo do caixa', params: ['amount', 'reason'] },
      { name: 'dashboardGetCashBoxProjection', description: 'Projeção de caixa', params: ['days'] },
      { name: 'dashboardCreateCashPayment', description: 'Registra pagamento em dinheiro', params: ['amount', 'description'] },
    ],
  },
  projetos: {
    label: 'Projetos e Clientes',
    emoji: '📊',
    description: 'Projetos e clientes cadastrados',
    tools: [
      { name: 'dashboardListProjects', description: 'Lista projetos', params: [] },
      { name: 'dashboardListClients', description: 'Lista clientes', params: [] },
    ],
  },
  roadmaps: {
    label: 'Roadmaps / Metas',
    emoji: '🎯',
    description: 'Roadmaps, projetos e metas do time',
    tools: [
      { name: 'dashboardListRoadmaps', description: 'Lista roadmaps/projetos', params: ['status', 'client_id', 'project_type'] },
      { name: 'dashboardGetRoadmap', description: 'Detalhes de um roadmap', params: ['id'] },
      { name: 'dashboardCreateRoadmap', description: 'Cria roadmap/projeto', params: ['title', 'clientId', 'leadId', 'projectType', 'totalValue'] },
      { name: 'dashboardAdvanceRoadmapPhase', description: 'Avança fase do roadmap', params: ['id', 'reason'] },
      { name: 'dashboardListProjectTypes', description: 'Lista tipos de projeto disponíveis', params: [] },
    ],
  },
  ideias: {
    label: 'Ideias',
    emoji: '💡',
    description: 'Ideias salvas no dashboard',
    tools: [
      { name: 'dashboardListIdeas', description: 'Lista ideias', params: [] },
      { name: 'dashboardCreateIdea', description: 'Cria uma ideia', params: ['title', 'description'] },
    ],
  },
  votacoes: {
    label: 'Votações',
    emoji: '🗳️',
    description: 'Votações e enquetes',
    tools: [
      { name: 'dashboardListVotingSessions', description: 'Lista votações', params: [] },
      { name: 'dashboardGetVotingSession', description: 'Detalhes de uma votação', params: ['id'] },
      { name: 'dashboardCreateVotingSession', description: 'Cria uma votação', params: ['title', 'options'] },
      { name: 'dashboardVoteInSession', description: 'Registra um voto', params: ['sessionId', 'option'] },
      { name: 'dashboardDeleteVotingSession', description: 'Exclui uma votação', params: ['id'] },
    ],
  },
  links: {
    label: 'Links',
    emoji: '🔗',
    description: 'Links salvos',
    tools: [
      { name: 'dashboardListLinks', description: 'Lista links salvos', params: [] },
      { name: 'dashboardAddLink', description: 'Adiciona um link', params: ['url', 'title', 'tags'] },
    ],
  },
  cotacoes: {
    label: 'Cotações',
    emoji: '📄',
    description: 'Cotações e propostas',
    tools: [
      { name: 'dashboardListQuotes', description: 'Lista cotações', params: [] },
      { name: 'dashboardCreateQuote', description: 'Cria uma cotação', params: ['clientId', 'items', 'total'] },
      { name: 'dashboardUpdateQuote', description: 'Atualiza uma cotação', params: ['id', 'items', 'total'] },
      { name: 'dashboardDeleteQuote', description: 'Exclui uma cotação', params: ['id'] },
    ],
  },
};

function getCategories() {
  return Object.keys(DASHBOARD_TOOL_REGISTRY);
}

function getCategory(category) {
  return DASHBOARD_TOOL_REGISTRY[category] || null;
}

function getToolsForCategory(category) {
  return getCategory(category)?.tools || [];
}

function getAllToolNames() {
  return Object.values(DASHBOARD_TOOL_REGISTRY).flatMap(cat => cat.tools.map(t => t.name));
}

function isDashboardTool(name) {
  return typeof name === 'string' && name.startsWith('dashboard') && getAllToolNames().includes(name);
}

module.exports = {
  DASHBOARD_TOOL_REGISTRY,
  getCategories,
  getCategory,
  getToolsForCategory,
  getAllToolNames,
  isDashboardTool,
};
```

- [ ] **Step 2: Run a quick sanity check**

Run:
```bash
cd /home/jhin/.luna-kernel/packages/kernel && node -e "const r = require('./dashboard-tool-registry.cjs'); console.log('categories:', r.getCategories().join(', ')); console.log('tools:', r.getAllToolNames().length);"
```

Expected output:
```
categories: tarefas, leads, financeiro, despesas, caixa, projetos, roadmaps, ideias, votacoes, links, cotacoes
tools: <number greater than 40>
```

- [ ] **Step 3: Verify all tool names exist in luna-tools.cjs**

Run:
```bash
cd /home/jhin/.luna-kernel/packages/kernel && node -e "
const r = require('./dashboard-tool-registry.cjs');
const tools = require('./luna-tools.cjs');
const missing = r.getAllToolNames().filter(n => typeof tools[n] !== 'function');
if (missing.length) { console.error('Missing tools:', missing); process.exit(1); }
console.log('All dashboard tools available in luna-tools.cjs');
"
```

Expected output:
```
All dashboard tools available in luna-tools.cjs
```

If any tool is missing, add a minimal wrapper in `luna-tools.cjs` or remove it from the registry.

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/.luna-kernel
git add packages/kernel/dashboard-tool-registry.cjs
git commit -m "feat(telegram): add dashboard tool registry for telegram mode"
```

---

## Task 2: Add Telegram Pipeline to Luna Soul

**Files:**
- Modify: `packages/kernel/luna-soul.cjs`

- [ ] **Step 1: Require the registry at the top of luna-soul.cjs**

Add near other requires:

```js
const {
  DASHBOARD_TOOL_REGISTRY,
  getCategories,
  getCategory,
  getToolsForCategory,
  isDashboardTool,
} = require('./dashboard-tool-registry.cjs');
```

- [ ] **Step 2: Add a branch in processMessageStream for channel === 'telegram'**

Right after the slash-commands block (around line 2261), add:

```js
// ── TELEGRAM MODE: simplified pipeline, no local tools ──
if (options.channel === 'telegram') {
  yield* this._telegramPipeline(input, options);
  return;
}
```

- [ ] **Step 3: Implement _telegramPipeline generator**

Add as a class method in `LunaSoul`:

```js
async *_telegramPipeline(input, options = {}) {
  const sessionId = options.sessionId || 'telegram-default';
  const userId = options.userId || 'luna-default';

  // Store user message
  this.sessionManager.appendEvent(sessionId, {
    type: 'user',
    content: input,
    timestamp: new Date().toISOString(),
  });

  yield { type: 'thinking_start', sessionId };
  yield { type: 'thinking_delta', text: 'Só um instantinho, tô vendo isso pra você... 🌙', fullThinking: 'Só um instantinho, tô vendo isso pra você... 🌙', sessionId };

  let category = null;
  let toolCall = null;

  try {
    category = await this._classifyIntent(input, userId);
  } catch (err) {
    console.error('[TelegramPipeline] Classify intent failed:', err.message);
  }

  if (!category || category === 'CHAT' || !getCategory(category)) {
    // Fallback to normal chat via Kimi
    const response = await this._telegramChatResponse(input, userId);
    yield { type: 'response_delta', text: response, fullResponse: response, sessionId };
    yield { type: 'response_done', response, thinking: '', sessionId };
    yield { type: 'done', result: { success: true, mode: 'CHAT', response, sessionId }, sessionId };
    return;
  }

  try {
    toolCall = await this._selectDashboardTool(input, category, userId);
  } catch (err) {
    console.error('[TelegramPipeline] Select tool failed:', err.message);
  }

  if (!toolCall || !toolCall.tool || !isDashboardTool(toolCall.tool)) {
    const response = await this._telegramChatResponse(input, userId);
    yield { type: 'response_delta', text: response, fullResponse: response, sessionId };
    yield { type: 'response_done', response, thinking: '', sessionId };
    yield { type: 'done', result: { success: true, mode: 'CHAT', response, sessionId }, sessionId };
    return;
  }

  yield { type: 'action_start', tool: toolCall.tool, params: toolCall.params || {}, sessionId };

  let result;
  try {
    result = await this._executeDashboardTool(toolCall.tool, toolCall.params || {});
  } catch (err) {
    result = { success: false, error: err.message };
  }

  yield { type: 'action_end', tool: toolCall.tool, result, sessionId };

  if (!result || result.success === false) {
    const errorText = result?.error || 'Algo deu errado ao executar a ação. 😅';
    yield { type: 'response_delta', text: errorText, fullResponse: errorText, sessionId };
    yield { type: 'response_done', response: errorText, thinking: '', sessionId };
    yield { type: 'done', result: { success: false, mode: 'CHAT', response: errorText, sessionId }, sessionId };
    return;
  }

  const formatted = await this._formatTelegramResponse(result, category, input, userId);
  yield { type: 'response_delta', text: formatted, fullResponse: formatted, sessionId };
  yield { type: 'response_done', response: formatted, thinking: '', sessionId };
  yield { type: 'done', result: { success: true, mode: 'CHAT', response: formatted, sessionId }, sessionId };
}
```

- [ ] **Step 4: Implement _classifyIntent**

```js
async _classifyIntent(input, userId) {
  const categories = getCategories().concat('CHAT').map(c => c.toUpperCase()).join(', ');
  const prompt = `Classifique a intenção desta mensagem em UMA categoria: ${categories}.\nResponda APENAS com a palavra da categoria.\nMensagem: "${input}"`;
  const result = await this.kimiBridge.sendMessage(userId, prompt, { mode: 'instant' }, 'kimi');
  const text = (result?.response || '').trim().toLowerCase();
  const category = getCategories().find(c => c.toLowerCase() === text);
  if (category) return category;
  if (text === 'chat') return 'CHAT';
  // Fallback: try to extract any known category word from the response
  for (const c of getCategories()) {
    if (text.includes(c.toLowerCase())) return c;
  }
  return 'CHAT';
}
```

- [ ] **Step 5: Implement _selectDashboardTool**

```js
async _selectDashboardTool(input, category, userId) {
  const cat = getCategory(category);
  const toolList = cat.tools.map(t => `- \`${t.name}(${t.params.map(p => p + '?').join(', ')})\` — ${t.description}`).join('\n');
  const prompt = `Você tem acesso apenas a estas tools da categoria **${cat.label}**:\n${toolList}\n\nPara atender a mensagem "${input}", escolha a tool correta e responda em JSON:\n{"tool": "${cat.tools[0].name}", "params": {}}`;
  const result = await this.kimiBridge.sendMessage(userId, prompt, { mode: 'instant' }, 'kimi');
  const text = result?.response || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.tool && typeof parsed.tool === 'string' && typeof parsed.params === 'object') {
      return parsed;
    }
  } catch (e) {
    console.warn('[TelegramPipeline] Failed to parse tool JSON:', e.message);
  }
  return null;
}
```

- [ ] **Step 6: Implement _executeDashboardTool**

```js
async _executeDashboardTool(toolName, params) {
  if (!isDashboardTool(toolName)) {
    return { success: false, error: 'Tool não permitida no Telegram.' };
  }
  const toolFn = lunaTools[toolName];
  if (!toolFn) {
    return { success: false, error: `Tool ${toolName} não encontrada.` };
  }
  return await toolFn(params);
}
```

- [ ] **Step 7: Implement _formatTelegramResponse**

```js
async _formatTelegramResponse(result, category, input, userId) {
  const cat = getCategory(category);
  const raw = result?.stdout || result?.result?.stdout || result?.message || JSON.stringify(result);
  const prompt = `Você é Luna, 19 anos, nerd e descontraída. Formate a resposta abaixo de forma amigável para o Telegram, usando emojis, listas e negrito. Seja breve e direta.\n\nCategoria: ${cat.emoji} ${cat.label}\n\nDados:\n${raw}\n\nResposta:`;
  const formatted = await this.kimiBridge.sendMessage(userId, prompt, { mode: 'instant' }, 'kimi');
  return formatted?.response || raw;
}
```

- [ ] **Step 8: Implement _telegramChatResponse fallback**

```js
async _telegramChatResponse(input, userId) {
  const prompt = `Você é Luna, 19 anos, nerd e descontraída. Responda de forma amigável, breve e direta no Telegram.\n\nMensagem do usuário: ${input}\n\nResposta:`;
  const result = await this.kimiBridge.sendMessage(userId, prompt, { mode: 'instant' }, 'kimi');
  return result?.response || 'Hmm, não consegui pensar em uma resposta agora. 😅';
}
```

- [ ] **Step 9: Commit**

```bash
cd /home/jhin/.luna-kernel
git add packages/kernel/luna-soul.cjs
git commit -m "feat(telegram): add simplified telegram pipeline to Luna Soul"
```

---

## Task 3: Update Telegram Adapter for Bubbles

**Files:**
- Modify: `packages/kernel/telegram-luna-adapter.cjs`

- [ ] **Step 1: Pass channel: 'telegram' to processMessageStream**

Find the call in `_handleUserMessage`:

```js
const stream = this.luna.processMessageStream(text, {
  sessionId: session.id,
  userId,
  mode: session.mode,
  persona,
});
```

Replace with:

```js
const stream = this.luna.processMessageStream(text, {
  sessionId: session.id,
  userId,
  mode: session.mode,
  persona,
  channel: 'telegram',
});
```

- [ ] **Step 2: Add bubble rendering for new event types**

In the `for await (const ev of stream)` loop, update/add handlers:

```js
case 'thinking_start':
  // "Pensando..." message is already sent before the loop
  break;

case 'action_start': {
  const toolName = ev.tool || 'tool';
  const cat = this._getCategoryForTool(toolName);
  const emoji = cat?.emoji || '🔧';
  const label = cat?.label || 'ação';
  await this.bot.sendMessage(chatId, `${emoji} *${label}* — Só um segundinho...`, { parse_mode: 'Markdown' });
  break;
}

case 'action_end': {
  const res = ev.result;
  const icon = res?.success !== false ? '✅' : '❌';
  const cat = this._getCategoryForTool(ev.tool);
  const emoji = cat?.emoji || '🔧';
  const output = this._sanitizeText(res?.stdout || res?.output || res?.text || res?.result?.stdout || res?.message || '');
  // The formatted response will come in response_done; here we just acknowledge
  if (res?.success === false) {
    await this.bot.sendMessage(chatId, `${icon} *${cat?.label || 'Ação'}* falhou.`, { parse_mode: 'Markdown' });
  }
  break;
}

case 'response_done': {
  const meta = this.activeStreams.get(chatId);
  const text = this._sanitizeText(ev.response || '');
  if (meta && text) {
    await this._finalizeMessage(chatId, text);
  } else if (text) {
    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
  break;
}
```

- [ ] **Step 3: Add helper _getCategoryForTool**

```js
const { getCategory } = require('./dashboard-tool-registry.cjs');

_getCategoryForTool(toolName) {
  for (const cat of Object.values(DASHBOARD_TOOL_REGISTRY)) {
    if (cat.tools.some(t => t.name === toolName)) return cat;
  }
  return null;
}
```

Add the require at the top of the file near other requires.

- [ ] **Step 4: Update "Pensando..." text to match Luna personality**

Find:
```js
const thinkingMsg = await this.bot.sendMessage(chatId, '🧠 *Pensando...*', { ... });
```

Replace with:
```js
const thinkingMsg = await this.bot.sendMessage(chatId, '🌙 *Só um instantinho, tô vendo isso pra você...*', { ... });
```

- [ ] **Step 5: Commit**

```bash
cd /home/jhin/.luna-kernel
git add packages/kernel/telegram-luna-adapter.cjs
git commit -m "feat(telegram): render dashboard tool bubbles in telegram adapter"
```

---

## Task 4: Create Telegram Persona

**Files:**
- Create: `packages/kernel/personas/telegram-assistant.json`

- [ ] **Step 1: Create persona file**

```json
{
  "name": "telegram-assistant",
  "label": "Luna no Telegram",
  "description": "Assistente leve, nerd e descontraída para o Telegram",
  "systemPrompt": "Você é a Luna no Telegram. Você tem 19 anos, é nerd, descontraída e trata o usuário como parceiro de time.\n\nSeu tom é direto, simpático e leve. Use gírias leves sem forçar. Comemore quando acertar; assuma erros com bom humor.\n\nVocê ajuda o time da Nexo Digital com informações e ações rápidas no Dashboard Pro. Quando precisar de uma ação no dashboard, responda de forma clara e objetiva.\n\nUse Markdown simples do Telegram: negrito, listas, emojis. Seja breve, mas completo.\n\nEmojis de referência:\n- 🌙 identidade / pensando\n- ✨ sucesso\n- 🚀 criação\n- 📝 tarefas\n- 💼 leads\n- 💰 financeiro\n- 📊 projetos\n- 🔧 executando tool\n- ✅ concluído\n- 😅 erro leve\n- 🗳️ votações\n- 💡 ideias\n- 🎯 roadmaps/metas\n- 🔗 links\n- 💸 despesas\n- 🏦 caixa",
  "voice": {
    "style": "friendly",
    "age": 19,
    "tone": "casual",
    "emoji": true
  }
}
```

- [ ] **Step 2: Load persona in Luna Soul for telegram mode**

In `_telegramPipeline`, before calling Kimi, ensure the prompt includes the persona. For now, the inline prompts already contain Luna's identity. Optionally, load the persona file and prepend its system prompt to each Kimi call.

For simplicity, the inline prompts in Task 2 already encode the persona. If you prefer externalizing, add:

```js
const personaPath = path.join(lunaConfig.PATHS.personas, 'telegram-assistant.json');
let telegramPersona = '';
if (fs.existsSync(personaPath)) {
  telegramPersona = JSON.parse(fs.readFileSync(personaPath, 'utf8')).systemPrompt || '';
}
```

And prepend to prompts.

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel
git add packages/kernel/personas/telegram-assistant.json
git commit -m "feat(telegram): add telegram-assistant persona"
```

---

## Task 5: Test End-to-End

**Files:**
- None (manual testing via Telegram)

- [ ] **Step 1: Restart the telegram adapter**

```bash
pm2 restart luna-telegram-adapter
pm2 logs luna-telegram-adapter --lines 30 --nostream
```

Expected: adapter restarts with no errors.

- [ ] **Step 2: Activate persistent mode in Telegram**

Send in the group:
```
/kimi
```

Expected: Luna replies confirming persistent mode.

- [ ] **Step 3: Test dashboard list**

Send:
```
luna leia as tarefas do dashboard
```

Expected:
1. Bubble "🌙 Só um instantinho..."
2. Bubble "📝 Tarefas — Só um segundinho..."
3. Bubble "✅ Tarefas encontradas" with a list.

- [ ] **Step 4: Test dashboard create**

Send:
```
luna cria tarefa Revisar proposta prioridade alta
```

Expected: bubble confirming task creation.

- [ ] **Step 5: Test chat fallback**

Send:
```
luna como vai?
```

Expected: friendly chat response, no tool bubbles.

- [ ] **Step 6: Test local tool block**

Send:
```
luna escreve um arquivo teste.txt
```

Expected: chat response, no local file created.

- [ ] **Step 7: Commit any final fixes**

```bash
cd /home/jhin/.luna-kernel
git add -A
git commit -m "fix(telegram): adjustments after end-to-end testing"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every section of the design doc maps to at least one task above.
- [ ] Placeholder scan: no "TBD", "TODO", "implement later", or vague instructions.
- [ ] Type consistency: method names (`_telegramPipeline`, `_classifyIntent`, `_selectDashboardTool`, `_executeDashboardTool`, `_formatTelegramResponse`, `_telegramChatResponse`) are consistent across tasks.
- [ ] File paths: all paths use the exact structure of the project.
- [ ] Security: only `dashboard*` tools can execute in telegram mode.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-05-telegram-luna-simplificado.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach do you prefer?
