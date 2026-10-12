# LUNA INVESTIGAÇÃO — Diagnóstico de Performance & Travamentos

> Data: 2026-08-15  
> Investigador: Luna AI  
> Status: EM ANDAMENTO — achados preliminares identificados

---

## RESUMO EXECUTIVO

O usuário reporta que a Luna **detecta a tool rapidamente** e **executa no frontend**, mas há uma **demora significativa** entre a conclusão da execução e o envio do resultado de volta para o chat da Kimi. Além disso, a Luna **para de responder do nada** após algumas interações.

**Hipótese principal:** A flag `session.processing` pode estar ficando presa em `true`, bloqueando novos envios.

---

## FLUXO IDENTIFICADO

```
Kimi responde com Tool
        ↓
Luna detecta rapidamente ✅
        ↓
Tool aparece/executa no frontend da Luna ✅
        ↓
       [DEMORA ❌] ← GARGALO AQUI
        ↓
Resultado finalmente volta para o chat da Kimi
```

---

## 1. ENCONTRADO: Mecanismo de Lock `session.processing`

**Arquivo:** `kimi-bridge.cjs`

### 1.1 O que é

A variável `session.processing` é uma **flag de busy/lock** que controla se uma sessão está processando uma mensagem. Ela é usada em múltiplos lugares:

| Linha | Contexto |
|-------|----------|
| 3574-3582 | `sendMessage()` — check + set |
| 3744-3752 | `sendImage()` — check + set |
| 4596-4604 | `sendFile()` — check + set |
| 4858-4865 | `sendMessageStream()` — check + set |
| 8439 | `sendMessageStream()` — clear no finally |
| 8447 | `sendMessageStream()` — set true |
| 8681 | Comentário: "session.processing would stay true and brick every future message" |
| 9702 | `sendMessageStream()` — clear no catch |
| 9764 | `cancelStream()` — clear (soft cancel) |
| 9796-9801 | `cancelStream()` — drain loop com timeout 3s |

### 1.2 Problema Potencial #1: `while (session.processing)` SEM timeout

Em `sendMessage()` (linha ~3574), `sendImage()` (linha ~3744), e `sendFile()` (linha ~4596):

```javascript
if (session.processing) {
  log.warn(`User ${hashUserId(userId)} already processing — queueing file upload`);
  // v8.4: NO TIMEOUT — wait forever for previous message to finish.
  while (session.processing) {
    await new Promise(r => setTimeout(r, 500));
  }
}
```

⚠️ **ISSO É PERIGOSO:** Se `session.processing` nunca for limpa (por exemplo, se uma exceção ocorrer e o `finally` não rodar), esse loop **espera para sempre**. Isso explicaria perfeitamente a Luna "parar de responder do nada".

### 1.3 Problema Potencial #2: `sendMessageStream()` tem timeout de 60s

Em `sendMessageStream()` (linha ~8430):

```javascript
const PROCESSING_DRAIN_TIMEOUT_MS = 60_000;
if (session?.processing) {
  const drainDeadline = Date.now() + PROCESSING_DRAIN_TIMEOUT_MS;
  while (session?.processing) {
    if (Date.now() > drainDeadline) {
      log.warn(`[sendMessageStream] Processing drain timeout (60000ms)... force-clearing processing flag`);
      session.processing = false;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
```

✅ **Bom:** Tem timeout de 60s para forçar limpeza.  
❌ **Ruim:** Se o usuário está usando `sendMessage()` (não stream), NÃO há timeout — espera para sempre.

### 1.4 Problema Potencial #3: `cancelStream()` — hard cancel

Em `cancelStream()` (linha ~9796):

```javascript
// Wait for stream to drain (max 3s)
const drainStart = Date.now();
while (session.processing && Date.now() - drainStart < 3000) {
  await new Promise(r => setTimeout(r, 200));
}
if (session.processing) {
  log.warn(`[cancelStream] Stream did not drain in 3s — forcing processing=false`);
  session.processing = false;
}
```

✅ **Bom:** Tem fallback de 3s.  
❓ **Mas:** E se o `cancelStream()` nunca for chamado? A flag fica presa.

---

## 2. ENCONTRADO: Loop de Detecção de Assistant (120s timeout)

**Arquivo:** `kimi-bridge.cjs` — linha ~8660-8700

```javascript
const NEW_ASSISTANT_TIMEOUT_MS = 120_000;
const newAssistantDeadline = Date.now() + NEW_ASSISTANT_TIMEOUT_MS;

if (resolvedProvider === 'kimi') {
  while (true) {
    if (stopConsuming) throw new Error('STREAM_CANCELLED');
    if (Date.now() > newAssistantDeadline) {
      throw new Error('NO_ASSISTANT_DETECTED: selector broke or send failed (no .segment-assistant within 120s)');
    }
    // ... detecta assistant no DOM
  }
}
```

⚠️ **Observação:** Timeout de 120s é alto. Se o selector `.segment-assistant` quebrar, a Luna fica 2 minutos presa nesse loop antes de falhar. Durante esse tempo, `session.processing = true` e nenhuma nova mensagem pode ser enviada.

---

## 3. ENCONTRADO: `pendingTools` no `luna-soul.cjs`

**Arquivo:** `luna-soul.cjs` — linha ~1746-1763

```javascript
this.turns = new Map(); // sessionId → { turnId, pendingTools: Set(), results: [], completed: boolean }

// Quando uma tool é detectada:
if (turn) turn.pendingTools.add(toolId);

// Quando a tool termina:
turn.pendingTools.delete(toolId);
if (turn.pendingTools.size === 0 && !turn.completed) {
  // ... turn completo
}
```

✅ **Parece OK:** Usa Set para rastrear tools pendentes. Não parece ser o gargalo.

---

## 4. ENCONTRADO: `pendingConfirmations` — pode travar turno

**Arquivo:** `luna-soul.cjs` — linha ~1795

```javascript
this.pendingConfirmations = new Map(); // sessionId -> Map(confirmationId -> { resolve, reject, tool, params, timeout })
```

E linha ~3115-3121:

```javascript
// v12.4-fix: if a destructive-operation confirmation is still pending, the turn
// is NOT dead — Kimi may have stopped generating because it is waiting for the
// confirmation response.
if (this.pendingConfirmations.has(sessionId)) {
  log.warn(`[LunaSoul] Stream ended with empty response but confirmation is still pending for ${sessionId} — waiting for user`);
  return; // NÃO continua o loop — espera confirmação do usuário
}
```

⚠️ **Isso pode explicar "parar de responder":** Se uma confirmação fica pendente e o usuário não responde, o turno fica travado.

---

## 5. ENCONTRADO: `sendMessage()` vs `sendMessageStream()` — caminhos diferentes

### `sendMessage()` (linha ~3574)
- Usado para envio de mensagens comuns
- **NÃO tem timeout** no `while (session.processing)`
- Se `processing` fica preso, trava para sempre

### `sendMessageStream()` (linha ~8430)
- Usado para streaming de respostas
- **Tem timeout de 60s** no drain
- Mas se o stream quebra sem chamar `finally`, `processing` pode ficar preso

---

## 6. HIPÓTESES DE CAUSA RAIZ

### Hipótese A: `session.processing` fica preso após exceção
**Probabilidade: ALTA**

Se uma exceção ocorre em `sendMessage()` e o `finally` não executa `session.processing = false`, a flag fica presa. Próxima chamada entra no `while (session.processing)` e espera para sempre.

**Evidência:**
- `sendMessage()` NÃO tem timeout no drain loop
- `sendImage()` e `sendFile()` também não têm timeout
- Apenas `sendMessageStream()` tem timeout de 60s

### Hipótese B: Loop de detecção de assistant (120s)
**Probabilidade: MÉDIA**

Se o selector `.segment-assistant` não é encontrado (porque a página mudou ou o DOM é diferente), a Luna fica 120s nesse loop. Durante esse tempo, `processing = true`.

**Evidência:**
- Timeout de 120s é muito alto
- Comentário no código admite: "selector broke or send failed"

### Hipótese C: `pendingConfirmations` bloqueia
**Probabilidade: MÉDIA**

Se uma confirmação de operação destrutiva fica pendente, o código retorna cedo e não continua o loop.

**Evidência:**
- Código explicitamente retorna se confirmação está pendente
- Comentário: "Kimi may have stopped generating because it is waiting for the confirmation"

### Hipótese D: Demora no envio do resultado é por `page.evaluate()` lento
**Probabilidade: BAIXA**

O envio do resultado para Kimi usa `page.evaluate()` para preencher o textarea e disparar Enter. Se o CDP/Playwright está lento, isso pode causar delay.

**Evidência:**
- Múltiplos `page.evaluate()` no `kimi-bridge.cjs`
- Mas o usuário diz que a tool executa rápido no frontend — o delay é depois

---

## 7. PRÓXIMOS PASSOS RECOMENDADOS

### 7.1 Adicionar timeout em TODOS os `while (session.processing)`

Atualmente apenas `sendMessageStream()` tem timeout. `sendMessage()`, `sendImage()`, e `sendFile()` precisam de timeout também.

### 7.2 Adicionar logs com timestamps

Inserir `console.log(Date.now())` em pontos críticos:
1. Quando `session.processing = true`
2. Quando `session.processing = false`
3. Quando entra no `while (session.processing)`
4. Quando sai do `while (session.processing)`
5. Quando `_submitWithVerification` é chamado
6. Quando o resultado é enviado para Kimi

### 7.3 Verificar se `finally` sempre executa

Garantir que TODAS as funções que setam `session.processing = true` tenham um `finally` ou `try/catch` que limpa a flag.

### 7.4 Reduzir timeout de detecção de assistant

De 120s para algo mais razoável (30s? 60s?)

---

## 8. CÓDIGO SUSPEITO — PARA REVISÃO DETALHADA

### 8.1 `kimi-bridge.cjs` linhas ~3574-3582 (sendMessage)
```javascript
if (session.processing) {
  while (session.processing) {  // ⚠️ SEM TIMEOUT
    await new Promise(r => setTimeout(r, 500));
  }
}
session.processing = true;
// ... código ...
// session.processing = false está no finally?
```

### 8.2 `kimi-bridge.cjs` linhas ~8660-8700 (assistant detection)
```javascript
while (true) {
  if (Date.now() > newAssistantDeadline) {  // 120s timeout
    throw new Error('NO_ASSISTANT_DETECTED...');
  }
  // ... detecta assistant ...
}
```

### 8.3 `luna-soul.cjs` linhas ~3115-3121 (pending confirmation)
```javascript
if (this.pendingConfirmations.has(sessionId)) {
  log.warn(`...confirmation is still pending...`);
  return;  // ⚠️ Retorna cedo, não continua
}
```

---

## 9. NOTAS

- Investigação iniciada com grep em `luna-soul.cjs` e `kimi-bridge.cjs`
- A extensão Chrome (`luna-extension/`) ainda precisa ser investigada
- O `kimi-dom-observer.js` pode ter lógica de polling que contribui
- Falta investigar o fluxo exato: "resultado pronto → serialização → envio para aba Kimi"

---

*Última atualização: 2026-08-15 10:15*  
*Próxima ação: Investigar o fluxo de envio do resultado (linhas ~9600+ de kimi-bridge.cjs)*
