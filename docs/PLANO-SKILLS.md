# Plano de Skills do WhatsApp — camada de ação da Luna

**Data:** 2026-09-23 · **Status:** aprovado pelo owner (Abner) em conversa direta
**Princípio central (decreto do owner):** o cérebro (qualquer um: Kimi Work, Pi,
kimi-cli) nunca raciocina sobre a UI do WhatsApp Web. Ele chama **skills
nomeadas** com **dados mapeados**. Skill é o contrato; o motor é troca-peça.

---

## 1. Visão em camadas

```
┌─────────────────────────────────────────────────────────────┐
│ CÉREBROS (trocáveis)                                        │
│   Kimi Work (ponte) · Pi (NIM) · kimi-cli (quando voltar)   │
├─────────────────────────────────────────────────────────────┤
│ FILA / PONTE (Postgres: tasks, threads, pg_notify)          │
├─────────────────────────────────────────────────────────────┤
│ SKILL LAYER ← ESTE PLANO (apps/whatsplay/src/skills/)       │
│   primitivas nomeadas + documentadas + testadas             │
├─────────────────────────────────────────────────────────────┤
│ TRANSPORT (browser.ts — UI Playwright, escondida)           │
├─────────────────────────────────────────────────────────────┤
│ MAIN MESSAGE: grupo 🏆Production - 2026🙏🏻 (hub de recados) │
└─────────────────────────────────────────────────────────────┘
```

## 2. Catálogo de skills

Legenda de status: ✅ existe (em produção) · 🔧 existe, vira skill nomeada · 🆕 nova

### Núcleo de conversa

| Skill | Propósito | Entrada → Saída | Status |
|---|---|---|---|
| `chat.open` | Abrir chat por nome ou número | `target: string` → `boolean` | 🔧 (`openChat` privado) |
| `chat.send` | Enviar texto com confirmação real | `target, text` → `external_id` | 🔧 (`sendMessage`) |
| `chat.read` | Ler histórico recente do chat | `target, limit?` → `ConversationMessage[]` | 🔧 (`readConversation`) |
| `chat.unread` | Chats com não-lidas (entrada do loop) | — → `UnreadMessage[]` | 🔧 (`getUnread`) |
| `session.status` | Estado da sessão WA | — → `TransportStatus` | 🔧 (`getStatus`) |

### RESPONDER MENÇÕES (🆕 skill-âncora)

| Skill | Propósito | Entrada → Saída | Status |
|---|---|---|---|
| `mention.detect` | Detectar `@luna` na mensagem | `text` → `boolean` | ✅ (`extractMention`) |
| `mention.respond` | Responder a menção **na conversa certa, referenciando o contexto** | `conversation_id, mention_id, text` → `external_id` | 🆕 |
| `message.find` | Achar mensagem específica (via lupa) pra citar/responder | `target, query` → `message_ref` | 🆕 |

**Fluxo da skill-âncora:**
1. Watcher detecta mensagem com `mentioned_luna=true` no grupo → evento
   `whatsapp.message.received` (já existe, zero mudança)
2. Orquestrador roteia → resposta gerada pelo cérebro ativo
3. Entrega via `mention.respond`: abre o chat, **localiza a mensagem da menção**
   (v1: responde no chat com o contexto citado no texto; v2: reply com citação
   visual via hover → "Responder"), envia com confirmação real
4. Se a menção for antiga (não está mais no painel): `message.find` via lupa

### LUPA (busca dentro do chat) 🆕

| Skill | Passos de UI | Saída |
|---|---|---|
| `chat.search` (lupa) | 1. `chat.open(target)` → 2. clica ícone de busca no cabeçalho (`#main` search) → 3. digita query no campo da lupa → 4. aguarda resultados → 5. (opcional) clica resultado → pula pra mensagem | `found: boolean, message_ref?` |

Seletores vão pro selector memory (`.brain/luna/selectors/whatsapp.md`) assim
que validados na sessão real — regra do transport.

### Contatos (mapeamento 1x)

| Skill | Propósito | Status |
|---|---|---|
| `contact.find` | Resolver nome → número/chat via ContactMap | 🆕 |
| `contact.map` | Mapear contato 1x: abre chat, lê cabeçalho/info, grava número no `contacts.metadata` | 🆕 |

**ContactMap:** tabela `contacts` enriquecida com
`metadata.phone` / `metadata.jid` / `metadata.role`. Mapeado uma vez por
contato, reusado pra sempre. Fallback sem mapeamento: busca por nome (hoje).

### Voz (F6 — ponte de chamada)

| Skill | Propósito | Status |
|---|---|---|
| `call.start` | Iniciar chamada de voz no chat (pré-voo do Operador) | ✅ existe (voice.call job) |
| `call.say` | Falar na chamada ativa (digita no chat do Operador) | ✅ (CallConductor) |
| `call.read` | Ler transcrição da chamada | ✅ (CallConductor) |
| `call.end` | Encerrar | ✅ |

## 3. Plano de execução

- **Fase 1 (✅ 2026-09-23):** doc + skill layer (`skills.ts` + 8 testes) com as
  primitivas do núcleo + `mention.respond` v1 + `chat.search` (lupa) no
  transport (`browser.ts searchInChat`, seletores no selector memory) + testes
- **Fase 2 (🟡 em curso):** ContactMap — resolver `contact-map.ts` ✅ (lê
  `contacts.metadata->phone`, com `mapContactPhone` idempotente + testes).
  PENDENTE: os números em si — extração pelo cabeçalho do chat (exige Chrome
  parado) OU confirmação manual do owner (mais rápido)
- **Fase 3:** teste ponta a ponta — menção no grupo → `mention.respond`
- **Fase 4:** ponte Kimi Work (fila Postgres) consumindo as skills
- **Fase 5:** teste de voz — ligar pro Abner com contexto via ponte

## 4. Regras duras (valem pra toda skill)

- Nunca enviar sem confirmação real de que o campo esvaziou (já é decreto)
- Nunca deixar chat aberto após o ciclo (PanelGuard)
- Seletor novo vai pro selector memory, nunca hardcode sem registro
- Toda skill tem teste; toda skill é documentada neste catálogo
- Guardrails de produção (allowlist, send-safety) valem por cima das skills
