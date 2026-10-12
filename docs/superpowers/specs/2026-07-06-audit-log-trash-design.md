# Audit Log / Lixeira do Dashboard — Design Spec

**Data:** 2026-07-06  
**Status:** Aprovado para implementação  
**Escopo:** Todas as entidades do dashboard (tarefas, leads, despesas, ideias, cotações, links, votações, etc.)

---

## 1. Objetivo

Permitir que o usuário desfaça ou restaure alterações feitas pela Luna no Telegram (ou manualmente no dashboard) por até **30 dias**. O foco é proteger contra exclusões ou atualizações erradas, especialmente quando a Luna executa uma tool no lugar errado.

---

## 2. Requisitos

- Registrar **deleções e atualizações** de todas as entidades do dashboard.
- Guardar **snapshot completo** do estado anterior (`before`) e, quando aplicável, do novo estado (`after`).
- Retenção de **30 dias** por padrão.
- Acesso **pelo Telegram** via comandos naturais.
- Cada usuário só pode desfazer/restaurar as próprias ações (isolado por `actorId`).
- Coexistir com o `UndoService` rápido de 30s já existente.

---

## 3. Arquitetura

### 3.1 Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                      Telegram / Dashboard                    │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  dashboardListRecentChanges                                 │
│  dashboardUndoLastChange                                    │
│  dashboardRestoreItem                                       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Rotas API                                                  │
│  GET    /api/audit-log                                      │
│  POST   /api/audit-log/restore                              │
│  POST   /api/audit-log/undo-last                            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  AuditLogService                                            │
│  - record(event)                                            │
│  - list(filters)                                            │
│  - restore(entryId)                                         │
│  - undoLast(filters)                                        │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Persistência                                               │
│  data/audit-log.json  ou  datastore-pg                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Estrutura da entrada de audit log

```json
{
  "id": "audit_1783300000000_abc123",
  "timestamp": "2026-07-06T01:00:00.000Z",
  "expiresAt": "2026-08-05T01:00:00.000Z",
  "actorId": "telegram-123456789",
  "action": "delete",
  "entityType": "task",
  "entityId": "1783296621047",
  "description": "Tarefa 'comprar pão' apagada",
  "before": { /* snapshot completo da entidade */ },
  "after": null
}
```

- `action`: `create`, `update`, `delete`
- `entityType`: `task`, `lead`, `expense`, `idea`, `quote`, `voting`, `link`, `payment`, `cash`, `client`, `project`, `roadmap`
- `actorId`: identificador do usuário (`telegram-<chat_id>` ou `dashboard-<username>`)
- `before`: snapshot do estado anterior (null para creates)
- `after`: snapshot do novo estado (null para deletes)

### 3.3 Métodos do AuditLogService

| Método | Descrição |
|--------|-----------|
| `record(event)` | Registra uma alteração. Chamado pelas rotas de API antes de persistir a mudança. |
| `list({ entityType, action, actorId, limit, offset })` | Lista entradas do audit log, filtráveis. |
| `restore(entryId)` | Restaura o estado `before` da entrada informada. |
| `undoLast({ actorId, entityType })` | Desfaz a última ação do ator (opcionalmente filtrada por tipo de entidade). |
| `cleanupExpired()` | Remove entradas com mais de 30 dias. |

### 3.4 Lógica de restauração

- **Delete:** recria a entidade usando o snapshot `before`. Preserva o `id` original quando possível.
- **Update:** substitui a entidade atual pelo snapshot `before`.
- **Create:** remove a entidade criada (usa `after.entityId`).

Se a entidade já foi restaurada ou não existe mais, retorna erro informativo.

---

## 4. Integração com as rotas da API

Todas as rotas de `DELETE`, `PUT`, `PATCH` e `POST` que criam/atualizam/apagam entidades devem registrar no audit log **antes** de persistir.

Exemplo para `DELETE /api/tasks/:id`:

```javascript
app.delete('/api/tasks/:id', async (req, res) => {
  const tasks = await dataStore.getTasks();
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });

  auditLogService.record({
    actorId: resolveActorId(req),
    action: 'delete',
    entityType: 'task',
    entityId: task.id,
    description: `Tarefa '${task.title}' apagada`,
    before: task,
    after: null,
  });

  await dataStore.deleteTask(req.params.id);
  res.json({ ok: true });
});
```

### 4.1 Entidades cobertas na primeira versão

1. Tarefas (`task`)
2. Leads (`lead`)
3. Despesas (`expense`)
4. Ideias (`idea`)
5. Cotações (`quote`)
6. Links (`link`)
7. Sessões de votação (`voting`)

Entidades adicionais (pagamentos, caixa, clientes, projetos, roadmaps) podem ser adicionadas seguindo o mesmo padrão.

---

## 5. Tools do Telegram

### 5.1 `dashboardListRecentChanges`

Lista as alterações recentes do usuário no Telegram.

**Parâmetros opcionais:**
- `entityType`: filtrar por tipo (ex: `task`)
- `action`: filtrar por ação (`create`, `update`, `delete`)
- `limit`: padrão 10

**Resposta:**
```
🕒 Últimas alterações:

1. ❌ Tarefa 'comprar pão' apagada (02:13)
2. ✏️ Tarefa 'revisar landing page' atualizada (02:10)
3. ✅ Tarefa 'ligar cliente' criada (02:05)
```

### 5.2 `dashboardUndoLastChange`

Desfaz a última alteração do usuário.

**Parâmetros opcionais:**
- `entityType`: desfaz só de um tipo de entidade

**Exemplos de uso:**
- "Luna, desfaz"
- "Luna, volta a última tarefa"

**Resposta:**
```
✅ Desfeito: Tarefa 'comprar pão' restaurada.
```

### 5.3 `dashboardRestoreItem`

Restaura um item específico apagado, buscando por título ou ID.

**Parâmetros:**
- `entityType`: tipo da entidade
- `id` ou `title`: identificador ou título

**Exemplos de uso:**
- "Luna, restaura a tarefa comprar pão"
- "Luna, recupera o lead João"

**Resposta:**
```
✅ Tarefa 'comprar pão' restaurada com sucesso.
```

---

## 6. Fluxos de exemplo

### 6.1 Apagar e desfazer

1. Usuário: *"Luna, apaga a tarefa comprar pão"*
2. `dashboardDeleteTask` registra no audit log e deleta.
3. Usuário: *"Luna, desfaz"*
4. `dashboardUndoLastChange` restaura a tarefa do audit log.

### 6.2 Atualizar errado e desfazer

1. Usuário: *"Luna, marca a tarefa X como concluída"*
2. `dashboardUpdateTask` registra o `before` (status antigo) e atualiza.
3. Usuário: *"Luna, desfaz"*
4. `dashboardUndoLastChange` volta o status anterior.

### 6.3 Restaurar item antigo

1. Usuário: *"Luna, mostra o que foi apagado recentemente"*
2. `dashboardListRecentChanges` lista as deleções.
3. Usuário: *"Luna, restaura a tarefa comprar pão"*
4. `dashboardRestoreItem` busca no audit log e recria.

---

## 7. Segurança e limitações

- Cada usuário só vê/desfaz suas próprias ações (`actorId` isolado).
- O audit log não armazena dados sensíveis como senhas ou tokens.
- Retenção de 30 dias: entradas expiradas são removidas automaticamente.
- Restauração de itens com referências quebradas (ex: tarefa vinculada a projeto apagado) deve retornar aviso, mas ainda recriar o item.

---

## 8. Arquivos a alterar / criar

### Novos
- `apps/dashboard/services/audit-log-service.js`

### Alterados
- `apps/dashboard/server.js` — rotas de API e integração nas rotas de delete/update/create
- `packages/kernel/luna-tools.cjs` — tools `dashboardListRecentChanges`, `dashboardUndoLastChange`, `dashboardRestoreItem`
- `packages/kernel/dashboard-tool-registry.cjs` — registro das novas tools
- `packages/kernel/luna-soul.cjs` — pipeline do Telegram reconhece intenções de desfazer/restaurar

---

## 9. Métricas de sucesso

- Usuário consegue desfazer uma alteração feita pela Luna no Telegram.
- Usuário consegue listar alterações recentes.
- Usuário consegue restaurar um item apagado por título ou ID.
- Audit log persiste por 30 dias.
- `UndoService` rápido continua funcionando normalmente.

---

## 10. Notas

- A primeira versão foca em deleções e atualizações. Criações podem ser incluídas se necessário, mas têm menor prioridade.
- A persistência inicial será em arquivo JSON (`data/audit-log.json`). Futuramente pode migrar para PostgreSQL via `datastore-pg`.
- O `actorId` no Telegram será derivado do `userId` do adapter (`telegram-<chat_id>`).
