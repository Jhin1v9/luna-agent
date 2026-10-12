# Luna Web v10.3 — Plano de Estabilidade

**Data:** 2026-06-08  
**Escopo:** correção de 6 problemas críticos de UX/arquitetura no Luna Web + aprimoramento do painel de usuários.

---

## 1. Resumo dos problemas investigados

| # | Problema | Causa raiz identificada | Severidade |
|---|----------|------------------------|------------|
| 1 | Telegram duplica/triplica mensagens quando Luna executa ações | 3 bots Telegram com `polling: true` usando o mesmo token → 409 Conflict + reconexões; sem deduplication; notificações push enviadas para grupo + 3 DMs | Alta |
| 2 | Resposta de outra sessão aparece no chat atual ao trocar de conversa | `SSEManager` fallback emite eventos sem `sessionId`; timer de reconnect não é cancelado; variáveis de turno não são limpas na troca de sessão | Alta |
| 3 | Login cai direto dentro do chat em vez da HOME | `currentSessionId` persistido no `localStorage` da sessão anterior não é resetado no login | Média |
| 4 | Carregar histórico trava o PC | Nenhuma paginação/virtualização: backend retorna até 500 mensagens, frontend renderiza tudo no DOM de uma vez | Alta |
| 5 | JSON tools aparece no chat | Buffer+regex reativo é frágil; histórico carregado não passa pelo strip; detector de JSON incompleto é ingênuo | Média |
| 6 | Painel de usuários só mostra quem está online | Backend só retorna quem fez heartbeat; não lista usuários cadastrados | Média |

---

## 2. Abordagens consideradas

### Opção A: "Fixes pontuais mínimos"
Apenas tapar os buracos: adicionar `sessionId` no fallback, limpar mais variáveis, resetar store no login, paginar backend, aplicar strip no histórico.

**Prós:** rápido, baixo risco de regressão.  
**Contras:** não resolve a arquitetura frágil do streaming; problemas podem voltar em novos edge cases.

### Opção B: "Refatoração estruturada por domínio" (Recomendada)
Isolar responsabilidades:
- Criar `SessionState` para variáveis de turno por sessão.
- Criar `StreamingParser` state-machine para processar chunks de resposta.
- Centralizar bot Telegram em singleton com deduplication.
- Adicionar virtualização + paginação.
- Remodelar painel de usuários para listar todos os cadastrados.

**Prós:** resolve causas raiz, facilita manutenção, previne regressões.  
**Contras:** mais linhas de código, requer testes mais cuidadosos.

### Opção C: "Reescrever ChatArea do zero"
Reescrever o componente com arquitetura limpa.

**Prós:** resultado mais limpo a longo prazo.  
**Contras:** alto risco de quebrar funcionalidades existentes; fora de escopo para este ciclo.

**Escolha:** Opção B. Vamos fazer refatoração estruturada mantendo o comportamento existente, com checkpoints de teste.

---

## 3. Design detalhado

### 3.1 Telegram — eliminar duplicatas

#### 3.1.1 Singleton do bot Telegram
Criar `NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs`:

```js
const TelegramBot = require('node-telegram-bot-api');
let botInstance = null;

module.exports = function getTelegramBot(token) {
  if (botInstance) return botInstance;
  botInstance = new TelegramBot(token, { polling: true });
  botInstance.on('polling_error', (err) => {
    if (err.message?.includes('409 Conflict')) {
      console.error('[TG] 409 Conflict detectado. Encerrando para evitar loop.');
      botInstance.stopPolling();
      process.exit(1);
    }
  });
  return botInstance;
};
```

Todos os módulos (`telegram-notifier.js`, `telegram-notification.service.js`, adapters, agent) devem usar essa factory. Nunca instanciar `new TelegramBot(...)` diretamente.

#### 3.1.2 Deduplication de notificações push
Adicionar em `telegram-notifier.js`:

```js
const sentNotifications = new Map(); // key: `${type}:${id}:${chatId}`
const NOTIFICATION_TTL_MS = 5 * 60 * 1000;

async function dedupedSend(key, sendFn) {
  const now = Date.now();
  // cleanup expirados
  for (const [k, t] of sentNotifications) {
    if (now - t > NOTIFICATION_TTL_MS) sentNotifications.delete(k);
  }
  if (sentNotifications.has(key)) return { skipped: true };
  const result = await sendFn();
  sentNotifications.set(key, now);
  return result;
}
```

Aplicar em `sendTaskNotification`, `sendLeadNotification`, `sendRoadmapNotification`, `sendVotingNotification`.

#### 3.1.3 Reduzir multi-destinatários (UX)
Enviar notificações **apenas para o grupo** por padrão. DMs só se `GROUP_CHAT_ID` não estiver configurado ou se explicitamente solicitado.

#### 3.1.4 Garantir uma única instância ativa
- `luna-local-mode.sh` e `luna-nexo.sh` não devem iniciar adapters/agents separadamente.
- O bot com polling deve ser iniciado apenas pelo `luna-server.js` (que já roda via PM2) ou por um único script dedicado.

---

### 3.2 Isolamento de sessões — eliminar vazamento

#### 3.2.1 `SSEManager` (`api.js`)
1. Adicionar `sessionId` aos eventos de fallback.
2. Cancelar timer de reconnect no `disconnect()`.
3. Adicionar flag `destroyed` para invalidar callbacks de managers descartados.

```js
class SSEManager {
  constructor() {
    this.eventSource = null;
    this.currentSessionId = null;
    this.onEventCallback = null;
    this.fallbackTimer = null;
    this.reconnectTimer = null;
    this.destroyed = false;
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.currentSessionId = null;
  }

  connect(sessionId, onEvent) {
    if (this.destroyed) return;
    // ... resto
  }
}
```

#### 3.2.2 `ChatArea.svelte`
Criar função `resetSessionState()` que limpa **todas** as variáveis de turno:

```js
function resetSessionState() {
  currentAssistantId = null;
  thinkingId = null;
  currentMessageId = null;
  responseBuffer = '';
  processedEventIds.clear();
  flushedContentHashes.clear();
  pendingToolCount = 0;
  for (const { intervalId } of runningToolTimers.values()) clearInterval(intervalId);
  runningToolTimers.clear();
  progressBuffers.clear();
  toolInstanceMap.clear();
  toolStartTimes.clear();
  for (const t of toolTimeoutTimers.values()) clearTimeout(t);
  toolTimeoutTimers.clear();
  userMessageAdded = false;
  showTyping = false;
  expectingResponse = false;
}
```

Chamar `resetSessionState()` **antes** de `sseManager.disconnect()` em `connectSSE()`, ou garantir que o manager antigo seja destruído primeiro.

Fortalecer filtro em `handleEvent`:

```js
function handleEvent(event) {
  if (!event) return;
  if (event.sessionId && event.sessionId !== sessionId) return;
  if (sseManager.currentSessionId && event.sessionId && event.sessionId !== sseManager.currentSessionId) return;
  // ... resto
}
```

#### 3.2.3 Backend
Opcional: ao receber nova conexão SSE para uma sessão, fechar conexões antigas da mesma sessão em vez de mantê-las indefinidamente.

---

### 3.3 Fluxo de login → HOME

#### 3.3.1 Resetar sessão no login
Em `LoginPage.svelte`, após login bem-sucedido:

```js
localStorage.setItem('luna_token', res.token);
localStorage.removeItem('luna_current_session');
user.set(res.user);
currentSessionId.set(null);
```

Ou fazer isso no `App.svelte` quando `$user` muda de `null` para truthy.

#### 3.3.2 Comportamento esperado
- Usuário faz login → vê `WelcomeScreen` (home) com sessões recentes e botão "Nova Conversa".
- Clicar em uma sessão recente abre o chat.
- Clicar em "Nova Conversa" cria e abre uma nova sessão.

---

### 3.4 Performance do histórico — paginação + virtualização

#### 3.4.1 Backend
Alterar `GET /api/chat/session/:id/messages`:

```js
router.get('/api/chat/session/:id/messages', requireAuthProxy, async (req, res) => {
  let session = getWebSession(req.params.id);
  if (!session) session = await loadSessionFromDB(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || session.messages.length;
  const start = Math.max(0, before - limit);
  const paginated = session.messages.slice(start, before);

  res.json({
    ok: true,
    messages: paginated,
    total: session.messages.length,
    hasMore: start > 0
  });
});
```

#### 3.4.2 Frontend — API
```js
export async function fetchSessionMessages(sessionId, { limit = 50, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set('before', String(before));
  const res = await fetch(`/api/chat/session/${sessionId}/messages?${params}`, {
    headers: authHeaders()
  });
  return res.json();
}
```

#### 3.4.3 Frontend — ChatArea
1. Carregar as **últimas 50 mensagens** inicialmente.
2. Se `hasMore`, mostrar botão "Carregar mensagens anteriores" no topo da lista.
3. Ao clicar, carregar mais 50 anteriores e prepend no store.

#### 3.4.4 Frontend — MessagesList
Implementar virtualização customizada leve:

```svelte
<script>
  let container;
  let viewportHeight = 0;
  let scrollTop = 0;
  const ESTIMATED_HEIGHT = 80;
  const BUFFER = 5;

  $: totalHeight = messages.length * ESTIMATED_HEIGHT;
  $: startIdx = Math.max(0, Math.floor(scrollTop / ESTIMATED_HEIGHT) - BUFFER);
  $: endIdx = Math.min(messages.length, Math.ceil((scrollTop + viewportHeight) / ESTIMATED_HEIGHT) + BUFFER);
  $: visibleMessages = messages.slice(startIdx, endIdx);
</script>

<div bind:this={container} bind:clientHeight={viewportHeight} on:scroll={() => scrollTop = container.scrollTop}>
  <div style="height: {totalHeight}px; position: relative;">
    <div style="transform: translateY({startIdx * ESTIMATED_HEIGHT}px);">
      {#each visibleMessages as message (message.id)}
        <MessageItem {message} />
      {/each}
    </div>
  </div>
</div>
```

Isso mantém no máximo ~15-20 nós no DOM, independentemente do histórico ter 500 mensagens.

#### 3.4.5 Mitigação imediata (fallback)
Enquanto a virtualização não está pronta, carregar apenas as últimas 100 mensagens no `connectSSE`:

```js
messages.set(loaded.slice(-100));
```

---

### 3.5 JSON tools — parser incremental + defesa em profundidade

#### 3.5.1 Problema atual
- Buffer acumulador + regex no flush é frágil.
- Histórico carregado não passa pelo `stripToolBlocksFromBuffer`.
- Detector de JSON incompleto (`hasIncompleteJsonBlock`) é ingênuo.

#### 3.5.2 Solução: `StreamingParser` state-machine
Criar `luna-web/src/lib/streamingParser.js`:

```js
export class StreamingParser {
  constructor() {
    this.state = 'TEXT';
    this.output = '';
    this.jsonBuffer = '';
    this.braceDepth = 0;
    this.inString = false;
    this.stringEscape = false;
  }

  feed(chunk) {
    for (const char of chunk) {
      switch (this.state) {
        case 'TEXT':
          if (char === '{') {
            this.state = 'JSON_CANDIDATE';
            this.jsonBuffer = '{';
            this.braceDepth = 1;
            this.inString = false;
            this.stringEscape = false;
          } else {
            this.output += char;
          }
          break;

        case 'JSON_CANDIDATE':
          this.jsonBuffer += char;
          if (this.stringEscape) {
            this.stringEscape = false;
          } else if (char === '\\') {
            this.stringEscape = true;
          } else if (this.inString) {
            if (char === '"') this.inString = false;
          } else {
            if (char === '"') this.inString = true;
            else if (char === '{') this.braceDepth++;
            else if (char === '}') {
              this.braceDepth--;
              if (this.braceDepth === 0) {
                if (this.isToolJson(this.jsonBuffer)) {
                  // descarta — opcionalmente pode emitir tool event
                } else {
                  this.output += this.jsonBuffer;
                }
                this.state = 'TEXT';
                this.jsonBuffer = '';
              }
            }
          }
          break;
      }
    }
    return this.output;
  }

  flush() {
    // Se sobrar conteúdo em JSON_CANDIDATE, decidir o que fazer
    if (this.state === 'JSON_CANDIDATE') {
      if (this.isToolJson(this.jsonBuffer)) {
        // descarta
      } else {
        this.output += this.jsonBuffer;
      }
      this.state = 'TEXT';
      this.jsonBuffer = '';
    }
    const result = this.output;
    this.output = '';
    return result;
  }

  isToolJson(text) {
    return /"tool"\s*:/.test(text) || /"params"\s*:/.test(text);
  }
}
```

Substituir o uso de `responseBuffer` + `stripToolBlocksFromBuffer` pelo `StreamingParser`.

#### 3.5.3 Defesa dupla no histórico
No `connectSSE`, ao processar mensagens carregadas:

```js
const finalText = msg.result?.response || msg.content || currentAssistantContent || '';
const cleanText = stripToolBlocksFromBuffer(finalText);
if (cleanText?.trim()) {
  loaded.push({ ...msg, content: cleanText, type: 'assistant' });
}
```

#### 3.5.4 Defesa tripla em `AssistantMessage.svelte`
Adicionar filtragem leve no render:

```js
function sanitize(content) {
  if (!content) return '';
  // Remove blocos JSON de tool como última barreira
  return content.replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '');
}
```

---

### 3.6 Painel de usuários ativos — listar TODOS os usuários cadastrados

#### 3.6.1 Backend
Atualmente o endpoint `/api/users/active` só retorna quem fez heartbeat. Vamos mudar para listar **todos os usuários cadastrados** com status derivado do `activeUsers` Map:

```js
router.get('/api/users/active', requireAuthProxy, async (req, res) => {
  const now = Date.now();
  const usersData = await dataStore.getUsers(); // ou ler users.json
  const users = [];

  for (const [uid, user] of Object.entries(usersData.users || {})) {
    const active = activeUsers.get(uid);
    const lastSeenMs = active ? now - active.lastSeen : Infinity;
    let status = 'offline';
    if (active && lastSeenMs <= 120000) status = 'online';
    else if (active && lastSeenMs <= 10 * 60 * 1000) status = 'away';

    users.push({
      userId: uid,
      name: user.name || uid,
      status,
      lastSeen: active ? new Date(active.lastSeen).toISOString() : null,
    });
  }

  res.json({ ok: true, users });
});
```

#### 3.6.2 Frontend — ConfigDrawer
1. Mostrar **todos** os usuários (Abner, Nonoke, Elias), não só online.
2. Status com 3 estados:
   - `online` → badge verde
   - `away` → badge amarelo/laranja
   - `offline` → badge cinza
3. `lastSeen`:
   - online: "agora"
   - away: "há X min" / "há Xh"
   - offline: "há Xd" / "há X semanas" / "nunca" se `lastSeen === null`
4. Adicionar indicador de "Visto por último na Luna" abaixo do nome.
5. Estética: cards separados, badge bem visível, cores consistentes com o tema Luna.

#### 3.6.3 Refresh automático
Atualizar a lista a cada 30s enquanto o modal estiver aberto (usar `setInterval` + cleanup no `onDestroy`).

---

## 4. Ordem de implementação recomendada

| Fase | Tarefa | Justificativa |
|------|--------|---------------|
| 1 | Painel de usuários expandido | Baixo risco, alto valor visual imediato |
| 2 | Login → HOME + slice(-100) do histórico | Quick wins de UX e performance |
| 3 | Paginação backend + frontend "Load more" | Resolve travamento de forma estrutural |
| 4 | `SSEManager` fix + reset de estado por sessão | Resolve vazamento entre chats |
| 5 | Parser incremental para JSON tools | Melhora qualidade do streaming |
| 6 | Virtualização MessagesList | Performance definitiva |
| 7 | Telegram singleton + deduplication | Requer testes com bot real, deixar por último |

---

## 5. Testes de aceitação

### 5.1 Painel de usuários
- [ ] Abrir Configurações → Usuários Ativos mostra Abner, Nonoke, Elias.
- [ ] Usuário logado aparece como Online (verde).
- [ ] Usuários sem heartbeat aparecem como Offline (cinza) ou com último tempo visto.

### 5.2 Login
- [ ] Fazer login após ter fechado uma sessão → cai na WelcomeScreen, não no chat.
- [ ] Clicar em "Nova Conversa" cria e abre sessão.

### 5.3 Histórico
- [ ] Sessão com 300+ mensagens abre sem travar.
- [ ] Scroll para cima mostra "Carregar anteriores" e carrega mais mensagens.
- [ ] DOM Inspector mostra no máximo ~30 elementos de mensagem no viewport.

### 5.4 Troca de sessão
- [ ] Abrir sessão A, enviar mensagem, enquanto streaming abrir sessão B.
- [ ] Nenhuma mensagem da sessão A aparece na sessão B.
- [ ] Voltar para A mostra o streaming correto/resposta completa.

### 5.5 JSON tools
- [ ] Enviar mensagem que gera tool call → nenhum JSON cru aparece no chat.
- [ ] Recarregar página com histórico que tem JSON salvo → JSON não aparece.

### 5.6 Telegram
- [ ] Criar tarefa → apenas 1 mensagem no grupo.
- [ ] Criar lead → apenas 1 mensagem no grupo.
- [ ] Nenhum erro 409 Conflict no log.

---

## 6. Notas de regressão a evitar

1. **Não quebrar o modo plano (/plan)** — o `ChatArea` é usado tanto para chat normal quanto para plan mode. Qualquer mudança no `handleEvent` deve testar ambos.
2. **Não perder eventos SSE** — o fix do `SSEManager` não pode descartar eventos válidos da sessão atual.
3. **Não quebrar tool cards** — quando um JSON tool é detectado, ele ainda deve ser renderizado como card de ferramenta (via `action_start` / `action_end`), não como texto.
4. **Preservar lazy connect do Chrome** — o `luna-server.js` não deve iniciar Chrome no boot; só na primeira mensagem.
5. **Preservar build do `dist/` no git** — continuar incluindo `dist/` para deploy estático.
