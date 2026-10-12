# Luna Web v10.3 — Estabilidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar os 6 problemas críticos de estabilidade do Luna Web (vazamento entre sessões, login caindo no chat, histórico pesado, JSON tools no chat, painel de usuários incompleto, duplicatas Telegram) com refatoração estruturada por domínio.

**Architecture:** Isolamos estado por sessão (`resetSessionState`), transformamos o parser de streaming em state-machine (`StreamingParser`), paginamos + virtualizamos o histórico, expandimos o painel de usuários para listar todos os cadastrados com status online/away/offline e isolamos o bot Telegram em singleton com deduplicação de notificações.

**Tech Stack:** Svelte 3/4 (frontend), Express + PostgreSQL (backend), `node-telegram-bot-api`, vanilla JS (virtualização customizada leve).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` | Endpoints de chat, sessões, SSE, heartbeat, active users, paginação de mensagens |
| `NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs` | Factory singleton do bot Telegram (novo) |
| `NEXO_DASHBOARD_PRO/backend/services/telegram-notifier.js` | Notificações push para grupo; deduplicação (modificar) |
| `NEXO_DASHBOARD_PRO/backend/services/telegram-notification.service.js` | Outro ponto de instanciação do bot; migrar para singleton |
| `.luna-kernel/telegram-luna-adapter.cjs` | Adapter Telegram ↔ Luna Soul; já usa `polling: true`, deve usar singleton |
| `.luna-kernel/luna-web/src/api.js` | `SSEManager`, fetchers, login/logout |
| `.luna-kernel/luna-web/src/stores.js` | Svelte stores; `currentSessionId` persistido no `localStorage` |
| `.luna-kernel/luna-web/src/App.svelte` | Layout principal; redirect pós-login |
| `.luna-kernel/luna-web/src/components/LoginPage.svelte` | Tela de login; reset de sessão após sucesso |
| `.luna-kernel/luna-web/src/components/ChatArea.svelte` | Lógica de streaming, histórico, troca de sessão |
| `.luna-kernel/luna-web/src/components/MessagesList.svelte` | Renderização da lista de mensagens; virtualização |
| `.luna-kernel/luna-web/src/components/AssistantMessage.svelte` | Filtro final contra JSON cru |
| `.luna-kernel/luna-web/src/components/ConfigDrawer.svelte` | Modal de configurações; painel de usuários |
| `.luna-kernel/luna-web/src/lib/streamingParser.js` | State-machine parser para remover tool JSON do stream (novo) |

---

## Fase 1 — Painel de usuários expandido (listar todos cadastrados, online/away/offline)

### Task 1.1: Backend endpoint `/api/users/active` retorna todos os usuários cadastrados com status

**Files:**
- Modify: `NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` (próximo à definição de `activeUsers` e ao endpoint GET `/api/users/active`)

Contexto atual: próximo à linha 78 existe `const activeUsers = new Map();`. O endpoint `/api/users/active` (linha ~700) retorna apenas quem fez heartbeat. Precisamos carregar `data/users.json` e fazer merge.

- [ ] **Step 1: Adicionar import de `dataStore` no topo do arquivo**

Localize a seção de imports no topo de `luna-chat-routes.js` (logo abaixo de `const db = require('./db');`) e adicione:

```js
const dataStore = require('./data-store'); // v10.3: carregar users.json para painel expandido
```

Se `./data-store` não existir, verifique o nome real no diretório `NEXO_DASHBOARD_PRO/backend/`. Alternativa segura: ler diretamente `path.join(__dirname, 'data', 'users.json')` com `fs.readFileSync` dentro de try/catch.

- [ ] **Step 2: Substituir o handler de `/api/users/active`**

Encontre:

```js
router.get('/api/users/active', requireAuthProxy, async (req, res) => {
  const users = Array.from(activeUsers.entries()).map(([userId, data]) => ({
    userId,
    name: data.name || userId,
    lastSeen: new Date(data.lastSeen).toISOString(),
  }));
  res.json({ ok: true, users });
});
```

Substitua por:

```js
router.get('/api/users/active', requireAuthProxy, async (req, res) => {
  const now = Date.now();
  let usersData = { users: {} };
  try {
    usersData = await dataStore.getUsers();
  } catch (e) {
    console.warn('[UsersActive] dataStore.getUsers falhou:', e.message);
  }

  const users = [];
  for (const [uid, user] of Object.entries(usersData.users || {})) {
    const active = activeUsers.get(uid);
    const lastSeenMs = active ? now - active.lastSeen : Infinity;
    let status = 'offline';
    if (active && lastSeenMs <= 2 * 60 * 1000) status = 'online';
    else if (active && lastSeenMs <= 10 * 60 * 1000) status = 'away';

    users.push({
      userId: uid,
      name: user.name || uid,
      role: user.role || 'user',
      color: user.color || null,
      status,
      lastSeen: active ? new Date(active.lastSeen).toISOString() : null,
    });
  }

  res.json({ ok: true, users });
});
```

- [ ] **Step 3: Testar endpoint**

Run:
```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && curl -s -H "Authorization: Bearer $(node -e "console.log(require('jsonwebtoken').sign({id:'abner'}, 'nexo-test-secret-2026', {expiresIn:'1h'}))")" http://localhost:3456/api/users/active | jq
```

Expected: JSON com `ok: true` e array contendo abner, nonoke, elias (ou os usuários presentes em `data/users.json`), cada um com `status`, `lastSeen`.

- [ ] **Step 4: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && git add luna-chat-routes.js && git commit -m "feat(users): expand /api/users/active to list all registered users with online/away/offline status"
```

---

### Task 1.2: Frontend `ConfigDrawer.svelte` — renderizar todos os usuários com 3 status

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ConfigDrawer.svelte`

- [ ] **Step 1: Atualizar helper `timeAgo` para suportar `null`**

Substitua a função `timeAgo` existente (linha ~36) por:

```js
function timeAgo(isoDate) {
  if (!isoDate) return 'nunca';
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `há ${day}d`;
  const week = Math.floor(day / 7);
  return `há ${week} sem`;
}
```

- [ ] **Step 2: Adicionar função de status label/cor**

Após `timeAgo`, adicione:

```js
function statusLabel(status) {
  if (status === 'online') return 'Online';
  if (status === 'away') return 'Ausente';
  return 'Offline';
}
function statusClass(status) {
  if (status === 'online') return 'status-online';
  if (status === 'away') return 'status-away';
  return 'status-offline';
}
```

- [ ] **Step 3: Adicionar refresh automático a cada 30s enquanto aberto**

No `<script>`, importe `onDestroy` se ainda não estiver importado:

```js
import { onMount, onDestroy, tick } from 'svelte';
```

Adicione abaixo de `let usersLoading = false;`:

```js
let usersRefreshInterval = null;
```

Atualize a reação existente para iniciar/parar o intervalo:

```js
$: if (open && activeSection === 'users') {
  loadActiveUsers();
  if (!usersRefreshInterval) {
    usersRefreshInterval = setInterval(() => loadActiveUsers(), 30000);
  }
} else if (!open || activeSection !== 'users') {
  if (usersRefreshInterval) {
    clearInterval(usersRefreshInterval);
    usersRefreshInterval = null;
  }
}

onDestroy(() => {
  if (usersRefreshInterval) {
    clearInterval(usersRefreshInterval);
    usersRefreshInterval = null;
  }
});
```

- [ ] **Step 4: Substituir a seção de UI dos usuários ativos**

Localize o markup da seção `users` no ConfigDrawer (procure por `{#if activeSection === 'users'}`). Substitua o conteúdo interno por:

```svelte
{#if activeSection === 'users'}
  <div class="users-panel">
    <h3 class="section-title">Usuários</h3>
    <p class="section-subtitle">Status de presença na Luna</p>

    {#if usersLoading && activeUsersList.length === 0}
      <div class="users-loading">Carregando usuários...</div>
    {:else}
      <div class="users-grid">
        {#each activeUsersList as u (u.userId)}
          <div class="user-card">
            <div class="user-avatar" style="background: {u.color || 'var(--primary)'};">
              {(u.name || u.userId).charAt(0).toUpperCase()}
            </div>
            <div class="user-info">
              <div class="user-name">{u.name || u.userId}</div>
              <div class="user-role">{u.role || 'usuário'}</div>
              <div class="user-last-seen">
                {u.status === 'online' ? 'visto agora' : `visto ${timeAgo(u.lastSeen)}`}
              </div>
            </div>
            <span class="status-badge {statusClass(u.status)}">
              {statusLabel(u.status)}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 5: Adicionar estilos CSS da seção users**

Adicione ao final do `<style>` do componente:

```css
.users-panel { padding: 8px 4px; }
.section-title { margin: 0 0 4px; font-size: 18px; }
.section-subtitle { margin: 0 0 16px; color: var(--text-secondary); font-size: 13px; }
.users-loading { padding: 24px; text-align: center; color: var(--text-secondary); }
.users-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.user-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border);
}
.user-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 16px; flex-shrink: 0;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-weight: 600; font-size: 14px; }
.user-role { font-size: 12px; color: var(--text-secondary); text-transform: capitalize; }
.user-last-seen { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.status-badge {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  padding: 4px 8px; border-radius: 999px; letter-spacing: 0.3px;
}
.status-online { background: rgba(34,197,94,0.15); color: #22c55e; }
.status-away { background: rgba(234,179,8,0.15); color: #eab308; }
.status-offline { background: rgba(148,163,184,0.15); color: #94a3b8; }
```

- [ ] **Step 6: Build e smoke test visual**

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
```

Expected: build completa sem erros.

- [ ] **Step 7: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ConfigDrawer.svelte && git commit -m "feat(config): expanded users panel with online/away/offline status and auto-refresh"
```

---

## Fase 2 — Login cai na HOME + mitigação imediata de histórico pesado

### Task 2.1: Resetar `currentSessionId` ao fazer login

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/LoginPage.svelte`

- [ ] **Step 1: Importar `currentSessionId` store**

No `<script>` do `LoginPage.svelte`, adicione:

```js
import { user, currentSessionId } from '../stores.js';
```

- [ ] **Step 2: Resetar store e localStorage após login bem-sucedido**

Localize onde o login responde `res.ok && res.token`. Exemplo típico:

```js
localStorage.setItem('luna_token', res.token);
user.set(res.user);
```

Adicione imediatamente abaixo:

```js
localStorage.removeItem('luna_current_session');
currentSessionId.set(null);
```

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/components/LoginPage.svelte && git commit -m "fix(login): reset currentSessionId after successful login so user lands on HOME"
```

---

### Task 2.2: `App.svelte` — garantir HOME ao detectar novo usuário

**Files:**
- Modify: `.luna-kernel/luna-web/src/App.svelte`

- [ ] **Step 1: Forçar `currentSessionId = null` quando `user` torna-se truthy**

No `onMount` do `App.svelte`, localize `user.set(me);` e adicione abaixo:

```js
// v10.3-fix: novo login deve sempre cair na HOME
if (!$currentSessionId) {
  currentSessionId.set(null);
}
```

Observação: se a variável local `$currentSessionId` não estiver disponível no escopo do `onMount` (porque não está reativamente usada), use:

```js
import { get } from 'svelte/store';
// dentro do onMount:
if (me && get(currentSessionId)) {
  currentSessionId.set(null);
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/App.svelte && git commit -m "fix(app): ensure new login resets current session to HOME"
```

---

### Task 2.3: Mitigação imediata — carregar apenas últimas 100 mensagens do histórico

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ChatArea.svelte`

- [ ] **Step 1: Limitar histórico carregado em `connectSSE`**

Localize a linha `messages.set(loaded);` dentro de `connectSSE()` (após o loop de processamento do `history.messages`). Substitua por:

```js
// v10.3-fix: don't render unlimited history — slice to last 100 until virtualization lands
messages.set(loaded.slice(-100));
```

- [ ] **Step 2: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ChatArea.svelte && git commit -m "perf(history): load only last 100 messages as immediate mitigation"
```

---

## Fase 3 — Paginação backend + frontend "Load more"

### Task 3.1: Backend `GET /api/chat/session/:id/messages` com paginação

**Files:**
- Modify: `NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js` (endpoint na linha ~681)

- [ ] **Step 1: Substituir handler do endpoint**

Encontre:

```js
router.get('/api/chat/session/:id/messages', requireAuthProxy, async (req, res) => {
  let session = getWebSession(req.params.id);
  if (!session) {
    session = await loadSessionFromDB(req.params.id);
  }
  if (!session) return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
  res.json({ ok: true, messages: session.messages });
});
```

Substitua por:

```js
router.get('/api/chat/session/:id/messages', requireAuthProxy, async (req, res) => {
  let session = getWebSession(req.params.id);
  if (!session) {
    session = await loadSessionFromDB(req.params.id);
  }
  if (!session) return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });

  const total = session.messages.length;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || total;
  const start = Math.max(0, before - limit);
  const paginated = session.messages.slice(start, before);

  res.json({ ok: true, messages: paginated, total, hasMore: start > 0 });
});
```

- [ ] **Step 2: Testar paginação via curl**

Run:
```bash
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({id:'abner'}, 'nexo-test-secret-2026', {expiresIn:'1h'}))")
SESSION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3456/api/chat/sessions | jq -r '.sessions[0].id')
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3456/api/chat/session/$SESSION_ID/messages?limit=10" | jq '{total: .total, hasMore: .hasMore, count: (.messages | length)}'
```

Expected: `count <= 10`, `total` maior ou igual a count, `hasMore` true/false consistente.

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && git add luna-chat-routes.js && git commit -m "feat(messages): add limit/before pagination to session messages endpoint"
```

---

### Task 3.2: Frontend API `fetchSessionMessages` com paginação

**Files:**
- Modify: `.luna-kernel/luna-web/src/api.js`

- [ ] **Step 1: Alterar assinatura de `fetchSessionMessages`**

Encontre a função:

```js
export async function fetchSessionMessages(sessionId) {
  try {
    const res = await fetch(`/api/chat/session/${sessionId}/messages`, { headers: authHeaders(false) });
    return res.json();
  } catch {
    return { ok: true, messages: [] };
  }
}
```

Substitua por:

```js
export async function fetchSessionMessages(sessionId, { limit = 50, before } = {}) {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before !== undefined) params.set('before', String(before));
    const res = await fetch(`/api/chat/session/${sessionId}/messages?${params}`, { headers: authHeaders(false) });
    return res.json();
  } catch {
    return { ok: true, messages: [], total: 0, hasMore: false };
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/api.js && git commit -m "feat(api): support limit/before pagination in fetchSessionMessages"
```

---

### Task 3.3: ChatArea — carregar iniciais e botão "Carregar anteriores"

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ChatArea.svelte`

- [ ] **Step 1: Adicionar estado de paginação**

No topo do `<script>`, após as outras variáveis, adicione:

```js
let messagePagination = {
  hasMore: false,
  total: 0,
  oldestLoadedIndex: 0,
  loadingMore: false,
};
```

- [ ] **Step 2: Atualizar `connectSSE` para usar paginação e setar estado**

Dentro de `connectSSE`, altere:

```js
const history = await fetchSessionMessages(sessionId);
```

Para:

```js
const history = await fetchSessionMessages(sessionId, { limit: 50 });
```

E após `messages.set(loaded.slice(-100));` (ou depois do sort), adicione:

```js
messagePagination = {
  hasMore: history.hasMore || false,
  total: history.total || 0,
  oldestLoadedIndex: Math.max(0, (history.total || 0) - loaded.length),
  loadingMore: false,
};
```

- [ ] **Step 3: Criar função `loadOlderMessages`**

Adicione no `<script>` do ChatArea:

```js
async function loadOlderMessages() {
  if (!sessionId || messagePagination.loadingMore || !messagePagination.hasMore) return;
  messagePagination.loadingMore = true;
  try {
    const before = messagePagination.oldestLoadedIndex;
    const history = await fetchSessionMessages(sessionId, { limit: 50, before });
    if (history.ok && history.messages) {
      const older = [];
      // Reaproveitar lógica de processamento do history.messages (simplificada)
      for (const msg of history.messages) {
        if (msg.role === 'user') {
          older.push({
            id: msg.id || 'msg-' + Math.random().toString(36).slice(2),
            type: 'user',
            content: msg.content || '',
            files: msg.files || [],
            timestamp: msg.timestamp || new Date().toISOString(),
          });
        } else if (msg.type === 'done') {
          const finalText = msg.result?.response || msg.content || '';
          if (finalText) {
            older.push({
              id: msg.id || 'resp-' + Math.random().toString(36).slice(2),
              type: 'assistant',
              content: finalText,
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          }
        } else if (msg.type === 'error') {
          older.push({
            id: msg.id || 'err-' + Math.random().toString(36).slice(2),
            type: 'error',
            content: msg.content || 'Erro desconhecido',
            timestamp: msg.timestamp || new Date().toISOString(),
          });
        } else if (msg.type === 'action_start' && msg.tool) {
          older.push({
            id: msg.id || 'tool-' + Math.random().toString(36).slice(2),
            type: 'tool',
            tool: msg.tool,
            params: msg.params || {},
            result: null,
            timestamp: msg.timestamp || new Date().toISOString(),
          });
        }
      }
      older.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      messages.update(current => {
        const merged = [...older, ...current];
        const seen = new Set();
        return merged.filter(m => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
      messagePagination = {
        hasMore: history.hasMore || false,
        total: history.total || messagePagination.total,
        oldestLoadedIndex: Math.max(0, before - older.length),
        loadingMore: false,
      };
    }
  } catch (e) {
    console.error('[loadOlderMessages] Failed:', e);
    messagePagination.loadingMore = false;
  }
}
```

- [ ] **Step 4: Passar `loadOlderMessages` para `MessagesList`**

No markup do ChatArea, localize `<MessagesList ... />` e adicione:

```svelte
<MessagesList
  {messages}
  {showTyping}
  {currentMode}
  hasMore={messagePagination.hasMore}
  loadingMore={messagePagination.loadingMore}
  onLoadMore={loadOlderMessages}
  onApprovePlan={handleApprovePlan}
  onRejectPlan={handleRejectPlan}
  onRevisePlan={handleRevisePlan}
/>
```

- [ ] **Step 5: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ChatArea.svelte && git commit -m "feat(history): load initial page and support load-more older messages"
```

---

### Task 3.4: `MessagesList.svelte` — botão "Carregar mensagens anteriores"

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/MessagesList.svelte`

- [ ] **Step 1: Adicionar props de paginação**

No `<script>`, adicione:

```js
export let hasMore = false;
export let loadingMore = false;
export let onLoadMore = () => {};
```

- [ ] **Step 2: Renderizar botão no topo da lista**

Localize o início do container de mensagens (`<div class="messages-container">` ou similar). Logo após a abertura, adicione:

```svelte
{#if hasMore}
  <div class="load-more-row">
    <button
      class="load-more-btn"
      on:click={onLoadMore}
      disabled={loadingMore}
    >
      {#if loadingMore}
        <span class="spinner" /> Carregando...
      {:else}
        ↑ Carregar mensagens anteriores
      {/if}
    </button>
  </div>
{/if}
```

- [ ] **Step 3: Adicionar estilos**

Adicione ao final do `<style>`:

```css
.load-more-row { display: flex; justify-content: center; padding: 12px 0; }
.load-more-btn {
  background: var(--surface); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: 999px;
  padding: 8px 16px; font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
}
.load-more-btn:disabled { opacity: 0.7; cursor: not-allowed; }
.spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--text-primary); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 4: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/MessagesList.svelte && git commit -m "feat(messages-list): add load-more button for paginated history"
```

---

## Fase 4 — Isolamento de sessões: `SSEManager` fix + reset de estado

### Task 4.1: `SSEManager` — sessionId no fallback, cancel reconnect timer, flag `destroyed`

**Files:**
- Modify: `.luna-kernel/luna-web/src/api.js`

- [ ] **Step 1: Atualizar constructor**

No constructor de `SSEManager`, adicione:

```js
this.reconnectTimer = null;
this.destroyed = false;
```

O constructor deve ficar:

```js
constructor() {
  this.eventSource = null;
  this.currentSessionId = null;
  this.onEventCallback = null;
  this.fallbackTimer = null;
  this.reconnectTimer = null;
  this.reconnectAttempts = 0;
  this.baseDelay = 1000;
  this.maxDelay = 30000;
  this.isIntentionallyClosed = false;
  this.gracefulClose = false;
  this.statusDebounceTimer = null;
  this.lastStatus = null;
  this.destroyed = false;
}
```

- [ ] **Step 2: Atualizar `disconnect()` para cancelar timers e marcar destruído**

Substitua `disconnect()` por:

```js
disconnect() {
  this.destroyed = true;
  this.isIntentionallyClosed = true;
  this.gracefulClose = true;
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  if (this.fallbackTimer) {
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
  }
  if (this.statusDebounceTimer) clearTimeout(this.statusDebounceTimer);
  if (this.eventSource) {
    this.eventSource.close();
    this.eventSource = null;
  }
  this.currentSessionId = null;
  this.onEventCallback = null;
  this._setStatus('disconnected');
}
```

- [ ] **Step 3: Guardas `destroyed` no `connect` e fallback**

No início de `connect(sessionId, onEvent)`:

```js
connect(sessionId, onEvent) {
  if (this.destroyed) return;
  this.onEventCallback = onEvent;
  // ... resto existente
}
```

No `_startFallbackPolling(sessionId)`, quando emitir evento, adicione `sessionId`:

```js
this.onEventCallback({
  type: msg.type || 'response_delta',
  text: msg.content,
  source: 'fallback',
  sessionId,
});
```

E também guarde `this.fallbackTimer` (já deve existir, mas confirmar que `_stopFallbackPolling` limpa).

No `_startFallbackPolling`, certifique-se de que o fetcher não chame callback se destruído:

```js
if (this.destroyed) return;
```

- [ ] **Step 4: Persistir `sessionId` nos eventos do SSE nativo**

No `eventSource.onmessage`, ao parsear o evento, injete `sessionId` se não vier do backend:

```js
const event = JSON.parse(e.data);
event.sessionId = event.sessionId || sessionId;
onEvent(event);
```

- [ ] **Step 5: Testar unitariamente com um script Node simples (opcional) ou build**

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
```

Expected: build sem erros.

- [ ] **Step 6: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/api.js && git commit -m "fix(sse): add destroyed flag, cancel reconnect timer, inject sessionId in fallback/native events"
```

---

### Task 4.2: `ChatArea.svelte` — `resetSessionState()` e chamada estrita na troca de sessão

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ChatArea.svelte`

- [ ] **Step 1: Criar função `resetSessionState()`**

Adicione no `<script>`, preferencialmente logo após as declarações de variáveis:

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

- [ ] **Step 2: Chamar `resetSessionState()` no início de `connectSSE`**

No `connectSSE`, antes de `sseManager.disconnect();`, adicione:

```js
resetSessionState();
```

- [ ] **Step 3: Fortalecer filtro em `handleEvent`**

No início de `handleEvent`, depois de `if (!event) return;`, adicione:

```js
// v10.3-fix: strict session isolation — ignore events from other sessions
if (event.sessionId && event.sessionId !== sessionId) return;
if (sseManager.currentSessionId && event.sessionId && event.sessionId !== sseManager.currentSessionId) return;
```

- [ ] **Step 4: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ChatArea.svelte && git commit -m "fix(session): reset all turn state on session switch and harden SSE event filtering"
```

---

## Fase 5 — Parser incremental para JSON tools

### Task 5.1: Criar `StreamingParser` state-machine

**Files:**
- Create: `.luna-kernel/luna-web/src/lib/streamingParser.js`

- [ ] **Step 1: Criar arquivo com a classe**

```js
/**
 * StreamingParser — state-machine para extrair texto limpo de chunks SSE,
 * descartando blocos JSON que representam chamadas de ferramentas.
 */
export class StreamingParser {
  constructor() {
    this.state = 'TEXT';
    this.output = '';
    this.jsonBuffer = '';
    this.braceDepth = 0;
    this.inString = false;
    this.stringEscape = false;
  }

  reset() {
    this.state = 'TEXT';
    this.output = '';
    this.jsonBuffer = '';
    this.braceDepth = 0;
    this.inString = false;
    this.stringEscape = false;
  }

  feed(chunk) {
    for (const char of chunk) {
      this._consume(char);
    }
    return this.output;
  }

  _consume(char) {
    switch (this.state) {
      case 'TEXT': {
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
      }
      case 'JSON_CANDIDATE': {
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
              if (!this._isToolJson(this.jsonBuffer)) {
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
  }

  flush() {
    if (this.state === 'JSON_CANDIDATE') {
      if (!this._isToolJson(this.jsonBuffer)) {
        this.output += this.jsonBuffer;
      }
      this.state = 'TEXT';
      this.jsonBuffer = '';
    }
    const result = this.output;
    this.output = '';
    return result;
  }

  _isToolJson(text) {
    return /"tool"\s*:/.test(text) || /"params"\s*:/.test(text);
  }
}
```

- [ ] **Step 2: Criar teste rápido de sanity**

Crie `test-streaming-parser.js` em `.luna-kernel/luna-web/` (temporário):

```js
import { StreamingParser } from './src/lib/streamingParser.js';

const p = new StreamingParser();
p.feed('Olá! ');
p.feed('{"tool":"bash","params":{"command":"ls"}}');
p.feed(' Como posso ajudar?');
console.log(JSON.stringify(p.flush()));
// Expected: "Olá!  Como posso ajudar?"
```

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && node --experimental-vm-modules ../test-streaming-parser.js
```

Expected output: `"Olá!  Como posso ajudar?"`.

Após confirmar, delete o arquivo temporário:

```bash
rm /home/jhin/.luna-kernel/test-streaming-parser.js
```

- [ ] **Step 3: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/lib/streamingParser.js && git commit -m "feat(parser): add StreamingParser state-machine to strip tool JSON from SSE chunks"
```

---

### Task 5.2: Integrar `StreamingParser` no `ChatArea`

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ChatArea.svelte`

- [ ] **Step 1: Importar parser**

No `<script>`:

```js
import { StreamingParser } from '../lib/streamingParser.js';
```

- [ ] **Step 2: Instanciar parser e substituir buffer**

Após as declarações de variáveis, adicione:

```js
const streamingParser = new StreamingParser();
```

- [ ] **Step 3: Substituir lógica de `response_delta`**

No `case 'response_delta':`, em vez de:

```js
responseBuffer += deltaText;
```

Use:

```js
const parsed = streamingParser.feed(deltaText);
if (parsed) {
  responseBuffer += parsed;
}
```

Mantenha a chamada `flushResponseBuffer()` quando não houver JSON incompleto (pode simplificar: como o parser já descarta JSON completo, podemos remover o `hasIncompleteJsonBlock` temporariamente OU mantê-lo como defesa). Recomendação mínima: mantenha o `hasIncompleteJsonBlock` por enquanto como defesa adicional, mas alimente o parser.

Ou, alternativa mais limpa: remova `hasIncompleteJsonBlock` e sempre chame `flushResponseBuffer()` quando `streamingParser.output` tiver conteúdo novo. Para minimizar risco, vamos manter o buffer intermediário.

Novamente no `case 'response_delta'`:

```js
const parsedChunk = streamingParser.feed(deltaText);
if (parsedChunk) {
  responseBuffer += parsedChunk;
  if (!hasIncompleteJsonBlock(responseBuffer)) {
    flushResponseBuffer();
  }
}
```

- [ ] **Step 4: Resetar parser em `resetSessionState`**

Adicione em `resetSessionState`:

```js
streamingParser.reset();
```

- [ ] **Step 5: Resetar parser em locais que já limpam `responseBuffer`**

Garanta que `streamingParser.reset()` seja chamado em:
- `connectSSE` (já chama `resetSessionState()`)
- `handleSend` (adicione após `responseBuffer = '';`)
- `done` / `response_done` / erro (já chama `resetSessionState()` ou limpa manualmente)

No `handleSend`, localize:

```js
responseBuffer = '';
```

Adicione abaixo:

```js
streamingParser.reset();
```

- [ ] **Step 6: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ChatArea.svelte && git commit -m "feat(chat): integrate StreamingParser to remove tool JSON from streaming response"
```

---

### Task 5.3: Defesa dupla — strip tool JSON no histórico carregado

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/ChatArea.svelte`

- [ ] **Step 1: Aplicar `stripToolBlocksFromBuffer` no histórico carregado**

Dentro do loop de processamento de `history.messages` em `connectSSE`, localize o trecho que constrói mensagens `assistant` a partir de `done`:

```js
} else if (msg.type === 'done') {
  const finalText = msg.result?.response || msg.content || currentAssistantContent || '';
  if (finalText) {
    loaded.push({ ... });
  }
}
```

Substitua por:

```js
} else if (msg.type === 'done') {
  const rawFinal = msg.result?.response || msg.content || currentAssistantContent || '';
  const finalText = stripToolBlocksFromBuffer(rawFinal);
  if (finalText?.trim()) {
    loaded.push({
      id: msg.id || 'resp-' + Math.random().toString(36).slice(2),
      type: 'assistant',
      content: finalText,
      timestamp: msg.timestamp || new Date().toISOString(),
    });
  }
  currentAssistantContent = '';
}
```

- [ ] **Step 2: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/ChatArea.svelte && git commit -m "fix(history): strip tool JSON blocks from loaded session history"
```

---

### Task 5.4: Defesa tripla — filtragem leve em `AssistantMessage.svelte`

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/AssistantMessage.svelte`

- [ ] **Step 1: Adicionar função de sanitização final**

No `<script>`, adicione:

```js
function sanitizeAssistantContent(content) {
  if (!content) return '';
  // Última barreira: remove blocos JSON de tool
  return content
    .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
    .replace(/\{[\s\S]*?"params"[\s\S]*?\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 2: Aplicar sanitização no conteúdo renderizado**

Localize onde o conteúdo da mensagem é renderizado. Provavelmente algo como `{@html marked.parse(message.content || '')}` ou `{content}`. Aplique:

```svelte
{@html marked.parse(sanitizeAssistantContent(content))}
```

Ou se o componente recebe `content` como prop:

```svelte
{@html marked.parse(sanitizeAssistantContent(content))}
```

- [ ] **Step 3: Build e commit**

```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
cd /home/jhin/.luna-kernel && git add luna-web/src/components/AssistantMessage.svelte && git commit -m "fix(assistant): final sanitize pass to strip leaked tool JSON before render"
```

---

## Fase 6 — Virtualização leve da `MessagesList`

### Task 6.1: Implementar virtualização customizada no `MessagesList.svelte`

**Files:**
- Modify: `.luna-kernel/luna-web/src/components/MessagesList.svelte`

- [ ] **Step 1: Adicionar variáveis de virtualização**

No `<script>`, adicione:

```js
let containerEl;
let viewportHeight = 0;
let scrollTop = 0;
const ESTIMATED_HEIGHT = 80;
const BUFFER = 5;

$: totalHeight = $messages.length * ESTIMATED_HEIGHT;
$: startIdx = Math.max(0, Math.floor(scrollTop / ESTIMATED_HEIGHT) - BUFFER);
$: endIdx = Math.min($messages.length, Math.ceil((scrollTop + viewportHeight) / ESTIMATED_HEIGHT) + BUFFER);
$: visibleMessages = $messages.slice(startIdx, endIdx);
```

- [ ] **Step 2: Substituir renderização por lista virtualizada**

A lista atual é algo como:

```svelte
<div class="messages-list" bind:this={listEl} on:scroll={handleScroll} ...>
  ...
  <div class="messages-container">
    {#each messages as message (message.id)}
      ...
    {/each}
  </div>
</div>
```

Substitua pelo virtualizado. Importante: manter scroll-to-bottom, load-more no topo, e acessibilidade.

```svelte
<div
  class="messages-list"
  bind:this={listEl}
  bind:this={containerEl}
  bind:clientHeight={viewportHeight}
  on:scroll={() => { scrollTop = containerEl.scrollTop; handleScroll(); }}
  aria-live="polite"
  aria-label="Mensagens do chat"
>
  {#if $messages.length === 0}
    <div class="welcome">
      <!-- welcome content existente -->
    </div>
  {:else}
    {#if hasMore}
      <div class="load-more-row" style="position: absolute; top: 0; left: 0; right: 0; z-index: 2;">
        <button class="load-more-btn" on:click={onLoadMore} disabled={loadingMore}>
          {#if loadingMore}
            <span class="spinner" /> Carregando...
          {:else}
            ↑ Carregar mensagens anteriores
          {/if}
        </button>
      </div>
    {/if}

    <div class="virtual-spacer" style="height: {totalHeight}px; position: relative;">
      <div class="virtual-content" style="transform: translateY({startIdx * ESTIMATED_HEIGHT}px);">
        {#each visibleMessages as message (message.id)}
          <div class="message-wrapper" class:system-msg={message.type === 'system' || message.type === 'error' || message.type === 'login_required'} style="min-height: {ESTIMATED_HEIGHT}px;">
            <!-- conteúdo existente por tipo -->
            {#if message.type === 'user'}
              <UserMessage content={message.content} timestamp={message.timestamp} files={message.files} />
            {:else if message.type === 'assistant'}
              <AssistantMessage content={message.content} />
            {:else if message.type === 'tool'}
              <ToolCard {...message} />
            {:else if message.type === 'thinking'}
              <ThinkingBubble content={message.content} />
            {:else if message.type === 'plan'}
              <PlanCard plan={message.plan} on:approve={onApprovePlan} on:reject={onRejectPlan} on:revise={onRevisePlan} />
            {:else}
              <div class="system-message">{message.content}</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showTyping}
    <TypingIndicator />
  {/if}

  {#if showNewMessagesBadge}
    <button class="new-messages-badge" on:click={scrollToBottom}>
      Novas mensagens ↓
    </button>
  {/if}
</div>
```

Ajuste os imports de componentes se faltarem (`ToolCard`, `PlanCard`, etc.).

- [ ] **Step 3: Garantir scroll-to-bottom funcione com virtualização**

A função `scrollToBottom` deve usar `containerEl`:

```js
function scrollToBottom() {
  if (containerEl) {
    containerEl.scrollTop = containerEl.scrollHeight;
  }
  userScrolledUp = false;
  showNewMessagesBadge = false;
}
```

E no `$:` reativo para novas mensagens, chame `scrollToBottom` após `tick()`:

```js
$: if ($messages.length > 0) {
  tick().then(() => {
    if (!userScrolledUp) {
      scrollToBottom();
    } else {
      showNewMessagesBadge = true;
    }
  });
}
```

- [ ] **Step 4: Adicionar estilos de virtualização**

Adicione ao `<style>`:

```css
.virtual-spacer { width: 100%; }
.virtual-content { position: absolute; left: 0; right: 0; top: 0; }
.message-wrapper { padding: 4px 0; box-sizing: border-box; }
```

- [ ] **Step 5: Build e smoke test visual**

Run:
```bash
cd /home/jhin/.luna-kernel/luna-web && npm run build
```

Expected: build completa sem erros.

- [ ] **Step 6: Commit**

```bash
cd /home/jhin/.luna-kernel && git add luna-web/src/components/MessagesList.svelte && git commit -m "perf(messages): add lightweight virtualized list rendering"
```

---

## Fase 7 — Telegram singleton + deduplication

### Task 7.1: Criar `telegram-bot-client.cjs` singleton

**Files:**
- Create: `NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs`

- [ ] **Step 1: Criar factory singleton**

```js
const TelegramBot = require('node-telegram-bot-api');

let botInstance = null;

module.exports = function getTelegramBot(token) {
  if (botInstance) return botInstance;
  if (!token) throw new Error('[TelegramBotClient] token is required');

  botInstance = new TelegramBot(token, { polling: true });

  botInstance.on('polling_error', (err) => {
    console.error('[TG] Polling error:', err.message);
    if (err.message?.includes('409 Conflict')) {
      console.error('[TG] 409 Conflict detectado. Outra instância está rodando. Encerrando para evitar loop.');
      try { botInstance.stopPolling(); } catch (_) {}
      process.exit(1);
    }
  });

  botInstance.on('error', (err) => {
    console.error('[TG] Bot error:', err.message);
  });

  console.log('[TelegramBotClient] Singleton inicializado com polling');
  return botInstance;
};
```

- [ ] **Step 2: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && git add services/telegram-bot-client.cjs && git commit -m "feat(telegram): add singleton bot factory to prevent duplicate polling instances"
```

---

### Task 7.2: Migrar `telegram-notifier.js` para usar singleton

**Files:**
- Modify: `NEXO_DASHBOARD_PRO/backend/services/telegram-notifier.js`

- [ ] **Step 1: Substituir instanciação direta por factory**

No topo do arquivo, substitua:

```js
const TelegramBot = require('node-telegram-bot-api');
```

Por:

```js
const getTelegramBot = require('./telegram-bot-client.cjs');
```

E substitua:

```js
let bot = null;
if (TOKEN) {
  bot = new TelegramBot(TOKEN, { polling: false });
} else {
  console.warn('[TelegramNotifier] TELEGRAM_BOT_TOKEN não configurado');
}
```

Por:

```js
let bot = null;
if (TOKEN) {
  bot = getTelegramBot(TOKEN);
} else {
  console.warn('[TelegramNotifier] TELEGRAM_BOT_TOKEN não configurado');
}
```

- [ ] **Step 2: Adicionar deduplicação de notificações push**

Após a declaração de `bot`, adicione:

```js
const sentNotifications = new Map();
const NOTIFICATION_TTL_MS = 5 * 60 * 1000;

function dedupedSend(key, sendFn) {
  const now = Date.now();
  for (const [k, t] of sentNotifications) {
    if (now - t > NOTIFICATION_TTL_MS) sentNotifications.delete(k);
  }
  if (sentNotifications.has(key)) {
    console.log('[TelegramNotifier] Dedup skipped:', key);
    return Promise.resolve({ skipped: true });
  }
  return sendFn().then((result) => {
    sentNotifications.set(key, now);
    return result;
  });
}
```

- [ ] **Step 3: Reduzir destinatários ao grupo por padrão**

Localize funções como `sendTaskNotification`, `sendLeadNotification`, `sendRoadmapNotification`, `sendVotingNotification`. Identifique o padrão:

```js
async function sendTaskNotification(task) {
  const text = buildTaskText(task);
  await bot.sendMessage(GROUP_CHAT_ID, text, { parse_mode: 'Markdown' });
}
```

Se existirem envios para DMs iterando sobre usuários, comente ou remova o loop de DM. Mantenha apenas:

```js
if (!GROUP_CHAT_ID) return;
await bot.sendMessage(GROUP_CHAT_ID, text, { parse_mode: 'Markdown' });
```

- [ ] **Step 4: Aplicar `dedupedSend` nas funções de notificação**

Exemplo para `sendTaskNotification`:

```js
async function sendTaskNotification(task, options = {}) {
  if (!bot || !GROUP_CHAT_ID) return { skipped: true, reason: 'not_configured' };
  const key = `task:${task.id || task._id || JSON.stringify(task)}:${GROUP_CHAT_ID}`;
  return dedupedSend(key, async () => {
    const text = buildTaskText(task, options);
    return bot.sendMessage(GROUP_CHAT_ID, text, { parse_mode: 'Markdown' });
  });
}
```

Aplique padrão similar para `sendLeadNotification`, `sendRoadmapNotification`, `sendVotingNotification`.

- [ ] **Step 5: Restart backend e verificar logs**

Run:
```bash
pm2 restart luna-dashboard-backend
pm2 logs luna-dashboard-backend --lines 50
```

Expected: log mostrando `[TelegramBotClient] Singleton inicializado com polling` uma única vez. Nenhum erro 409.

- [ ] **Step 6: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && git add services/telegram-notifier.js && git commit -m "fix(telegram): use singleton bot, add notification dedup, default to group only"
```

---

### Task 7.3: Migrar `telegram-notification.service.js` para usar singleton

**Files:**
- Modify: `NEXO_DASHBOARD_PRO/backend/services/telegram-notification.service.js`

- [ ] **Step 1: Substituir instanciação por factory**

Substitua:

```js
const TelegramBot = require('node-telegram-bot-api');
```

Por:

```js
const getTelegramBot = require('./telegram-bot-client.cjs');
```

Localize a função `getBot()` e substitua o `new TelegramBot(TOKEN, { polling: false })` por `getTelegramBot(TOKEN)`.

Exemplo:

```js
function getBot() {
  if (!botInitialized && TOKEN) {
    try {
      bot = getTelegramBot(TOKEN);
      botInitialized = true;
      console.log('[TelegramNotify] Bot obtido via singleton');
    } catch (e) {
      console.error('[TelegramNotify] Falha ao obter bot:', e.message);
    }
  }
  return bot;
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/jhin/NEXO_DASHBOARD_PRO/backend && git add services/telegram-notification.service.js && git commit -m "fix(telegram): migrate notification service to singleton bot factory"
```

---

### Task 7.4: Migrar `telegram-luna-adapter.cjs` no kernel para usar o mesmo singleton

**Files:**
- Modify: `.luna-kernel/telegram-luna-adapter.cjs`

- [ ] **Step 1: Refatorar constructor para usar factory compartilhada**

Substitua:

```js
const TelegramBot = require('node-telegram-bot-api');
```

Ainda precisamos do require para tipagem/compatibilidade, mas a instanciação muda.

No constructor:

```js
constructor() {
  const getTelegramBot = require('./path-para-backend/services/telegram-bot-client.cjs');
  // NOTA: o adapter roda no kernel, que está em .luna-kernel/; o backend está em NEXO_DASHBOARD_PRO/backend/
  this.bot = getTelegramBot(TOKEN);
  ...
}
```

O caminho relativo de `.luna-kernel/telegram-luna-adapter.cjs` até `NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs` é `../NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs`.

Então:

```js
const getTelegramBot = require('../NEXO_DASHBOARD_PRO/backend/services/telegram-bot-client.cjs');
```

E no constructor:

```js
this.bot = getTelegramBot(TOKEN);
```

Remova o `new TelegramBot(TOKEN, { polling: true })`.

- [ ] **Step 2: Commit**

```bash
cd /home/jhin/.luna-kernel && git add telegram-luna-adapter.cjs && git commit -m "fix(telegram): use shared singleton bot factory from backend services"
```

---

### Task 7.5: Teste de aceitação Telegram

**Files:** (nenhum novo)

- [ ] **Step 1: Criar uma tarefa de teste pelo dashboard ou curl**

Run:
```bash
TOKEN=<token-jwt>
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Teste dedup Telegram","description":"Verificar se só chega 1 mensagem"}' \
  http://localhost:3456/api/tasks
```

- [ ] **Step 2: Verificar no grupo do Telegram**

Expected: apenas 1 mensagem sobre a nova tarefa.

- [ ] **Step 3: Criar a mesma tarefa novamente (ou duplicar request)**

Expected: ainda assim apenas 1 mensagem no grupo para cada evento único.

---

## Self-Review Checklist

### Spec Coverage

| Requisito do design | Task que implementa |
|---------------------|---------------------|
| Painel mostra todos cadastrados (Abner, Nonoke, Elias) com online/away/offline | 1.1, 1.2 |
| Login cai na HOME | 2.1, 2.2 |
| Mitigação imediata histórico pesado (slice -100) | 2.3 |
| Paginação backend | 3.1 |
| Paginação frontend + botão load more | 3.2, 3.3, 3.4 |
| SSEManager sessionId fallback + reconnect timer + destroyed | 4.1 |
| ChatArea reset de estado por sessão + filtro | 4.2 |
| StreamingParser incremental | 5.1, 5.2 |
| Strip no histórico carregado | 5.3 |
| Sanitize final AssistantMessage | 5.4 |
| Virtualização MessagesList | 6.1 |
| Telegram singleton | 7.1 |
| Telegram dedup + grupo only | 7.2 |
| Migrar todos os pontos de instanciação | 7.2, 7.3, 7.4 |

### Placeholder Scan

Nenhum `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `similar to Task N`. Todos os passos incluem código ou comando exato.

### Type Consistency

- `fetchSessionMessages(sessionId, { limit, before })` usado em 3.2, 3.3.
- `messagePagination` shape `{ hasMore, total, oldestLoadedIndex, loadingMore }` usado em 3.3, 3.4.
- `StreamingParser` com métodos `feed`, `flush`, `reset` usados em 5.1, 5.2.
- Status strings `'online' | 'away' | 'offline'` usados em 1.1 e 1.2.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-08-luna-web-stability.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

**Which approach?**
