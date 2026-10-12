# SCHEMA AUDIT — NEXO Dashboard Pro
## Fase 0.1 · Reverse Schema Engineering

> **Metodologia:** Cada entidade foi auditada extraindo DIRETAMENTE do `backend/server.js` (linhas 1–8796) as chamadas `readJSON`/`writeJSON`, os objetos criados em `req.body`, e os campos acessados nas rotas. Cross-referenciado com `backend/datastore-pg.js` e o schema PostgreSQL real (obtido via `information_schema.columns`).

---

## 📋 Tabela Resumo — Mismatches Críticos

| Entidade | PG Status | Mismatch | Impacto |
|----------|-----------|----------|---------|
| `users` | ⚠️ Parcial | `created_at` existe no PG mas datastore não o retorna; `discordId` não existe no PG | `createdAt` sempre `undefined` em `/api/users` |
| `tasks` | ✅ OK | Zero mismatch — nomes 1:1 com snake_case ↔ camelCase | Nenhum |
| `company_tasks` | ✅ OK | Zero mismatch — mesma estrutura de `tasks` | Nenhum |
| `payments` | 🔴 CRÍTICO | `paymentId`, `totalAmount`, `paymentTerms`, `transactions`, `revenueSplit`, `companySharePercent`, `links` **não existem no PG**. PG tem `name`, `amount`, `installments` que o server NÃO usa. | **Dados corrompidos no restore** |
| `expenses` | ✅ OK | Zero mismatch — snake_case ↔ camelCase perfeito | Nenhum |
| `cash_box` | ⚠️ Parcial | `alerts`, `settings`, `auditLog` **não existem no PG** | Perda de configurações no restore |
| `quotes` | 🔴 CRÍTICO | `quoteId` usado como PK no server; PG usa `id`. `totalAmount`, `monthlyFee`, `year1Investment`, `discountUpfront` são objetos aninhados no server; PG tem `_value`/`_currency` separados. | **Dados corrompidos no restore** |
| `leads` | 🔴 CRÍTICO | Server usa `displayName`, `pipelineStatus`, `estimatedValue`, `type`, `convertedAt`; PG tem `name`, `email`, `phone`, `company`, `source`, `status`, `notes`, `metadata` | **Schema completamente diferente** |
| `members` | ✅ OK | Zero mismatch — snake_case ↔ camelCase perfeito | Nenhum |
| `transactions` | ⚠️ Parcial | Server cria `currency`, `createdBy`; PG não tem essas colunas. PG tem `balance_after`, `recorded_by`, `recorded_at`, `is_active`, `deleted_at`, `deleted_by`, `metadata` que o server NÃO seta no POST. | Dados incompletos no restore |
| `links` | ✅ OK | Zero mismatch — nomes 1:1 | Nenhum |
| `notifications` | ✅ OK | Zero mismatch — nomes 1:1 | Nenhum |
| `security_logs` | 🔴 CRÍTICO | Server armazena `events` array com campos `type`, `severity`, `ip`, `location`, `risk`, `device`, `attemptedUser`, `message`, `notified`, `cameraPhoto`, `screenshot`, `intruderData`. PG tem `event_type`, `user_id`, `ip`, `location`, `user_agent`, `success`, `details` — **estrutura totalmente diferente** | **Dados corrompidos no restore** |
| `changelog` | 🔴 CRÍTICO | Server lê de `backend/changelog.json` (fora de `data/`), estrutura `{ version, lastUpdated, entries[] }`. PG tem `id`, `version`, `title`, `description`, `category`, `emoji`, `author`, `tier`, `date`, `tags`, `read_by` — sem `lastUpdated`, sem `entries` wrapper. | **Arquivo diferente + schema diferente** |
| `ideas` | 🔴 CRÍTICO | Server usa `backend/data/ideas-registry.json` com estrutura `{ ideas: { [id]: {...} }, _meta, templates, categories }`. PG tem `id`, `title`, `summary`, `status`, `category`, `priority`, `author`, `tags`, `blocks`, `metadata` — **estrutura completamente diferente** | **Dados corrompidos no restore** |
| `workspace_clients` | 🔴 CRÍTICO | Server usa `backend/data/workspace-index.json` com `{ versao, ultimaAtualizacao, clientes: [...] }` onde cada cliente tem `nome`, `caminho`, `responsavel`, `orcamentoTotal`, `moeda`, `anotacoes`. PG tem `name`, `path`, `status`, `color`, `responsavel`, `tipo`, `data_inicio`, `orcamento_total`, `moeda`, `tags`, `anotacoes`, `metadata` — **nomes diferentes e estrutura diferente** | **Dados corrompidos no restore** |
| `whatsapp_history` | 🔴 CRÍTICO | Server usa array de mensagens com `text`, `body`, `author`, `authorName`, `chat`, `timestamp`, `classification`, `reviewed`, `correctedCategory`, `notes`, `sentViaDashboard`, `direction`, `responded`, `resolvedAuthor`. PG tem `chat_id`, `chat_name`, `sender`, `message`, `timestamp`, `type`, `metadata` — **campos completamente diferentes** | **Dados corrompidos no restore** |
| `luna_threads` | 🔴 CRÍTICO | Server usa `{ version, lastUpdated, threads: { [id]: {...} } }` com `messages[]`, `participants[]`, `messageCount`. PG tem `id`, `user_id`, `title`, `messages`, `context`, `created_at`, `updated_at` — **estrutura diferente** | **Dados corrompidos no restore** |
| `luna_buffer` | 🔴 CRÍTICO | Server usa `{ newMessages, newTasks, newIdeas, newLinks, newLeads, newFinance, ignoredMessages, newMentions, sentiment, lastBufferUpdate }`. PG tem `id`, `data`, `updated_at` — **coluna única `data` JSONB vs múltiplos campos** | **Dados corrompidos no restore** |

---

## 1. USERS

### Schema REAL do server.js
```json
{
  "users": {
    "[id:string]": {
      "name": "string",
      "role": "string",
      "color": "string",
      "password": "string (bcrypt hash)",
      "discordId?": "string"
    }
  },
  "active": "string"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| role | text | NO |
| color | text | YES |
| password | text | NO |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH
- `discordId` não existe no PG (mas existe no JSON real)
- `created_at` existe no PG mas `datastore-pg.js` NÃO o retorna (`getUsers()` só seleciona `id, name, role, color, password`)
- `active` é hardcoded como `'abner'` no datastore — nunca lido da tabela `settings`

### Exemplo real (PG)
```json
{ "id": "abner", "name": "Abner", "role": "Admin", "color": "#3742fa", "password": "$2b$10$...", "created_at": "2026-05-18T20:15:59.504Z", "updated_at": "2026-05-18T20:15:59.504Z" }
```

### Rotas
- `GET /api/state`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/sync`
- `POST /api/auth/change-password`
- `POST /api/users/switch`
- `GET /api/users`
- `GET /api/luna/threads`
- `POST /api/luna/threads/:id/messages`

---

## 2. TASKS

### Schema REAL do server.js
```json
[
  {
    "id": "string (Date.now())",
    "title": "string",
    "description": "string",
    "status": "string (pending|in_progress|completed)",
    "priority": "string (low|medium|high)",
    "taskType": "string (one_time|...)",
    "dueDate": "ISO string | null",
    "addedBy": "string",
    "assignedTo": "string | null",
    "source": "string",
    "comments": [
      {
        "id": "string",
        "text": "string",
        "author": "string",
        "mentions": "string[]",
        "createdAt": "ISO string"
      }
    ],
    "createdAt": "ISO string",
    "updatedAt": "ISO string",
    "startedAt": "ISO string | null",
    "completedAt": "ISO string | null"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| title | text | NO |
| description | text | YES |
| status | text | NO |
| priority | text | YES |
| task_type | text | YES |
| due_date | timestamptz | YES |
| added_by | text | YES |
| assigned_to | text | YES |
| source | text | YES |
| comments | jsonb | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |
| started_at | timestamptz | YES |
| completed_at | timestamptz | YES |

### MISMATCH
✅ **Zero mismatch.** O datastore-pg.js faz tradução snake_case ↔ camelCase perfeitamente.

### Exemplo real (PG)
```json
{ "id": "1778571811124", "title": "tarefa", "description": "tarefa", "status": "pending", "priority": "low", "task_type": "one_time", "due_date": null, "added_by": "abner", "assigned_to": null, "source": "luna", "comments": [], "created_at": "2026-05-12T07:43:31.124Z", "updated_at": "2026-05-12T07:43:31.124Z", "started_at": null, "completed_at": null }
```

### Rotas
- `GET /api/state`
- `GET /api/tasks` (com filtros: status, assignedTo, priority, taskType, overdue)
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/complete-by-title`
- `POST /api/tasks/:id/comments`

---

## 3. COMPANY_TASKS

### Schema REAL do server.js
Mesma estrutura de `tasks`, mas com `priority` podendo ser `"Alta"` e `task_type` podendo ser `"monthly"`, `"one_time_quarterly"`, etc.

### Schema atual do PostgreSQL
Identical a `tasks`.

### MISMATCH
✅ **Zero mismatch.**

### Exemplo real (PG)
```json
{ "id": "OP-001", "title": "Documentar arquitetura de projetos", "description": "Criar/manter README técnico...", "status": "pending", "priority": "Alta", "task_type": "monthly", "due_date": null, "added_by": "Abner", "assigned_to": "Abner", "source": "manual", "comments": ["Atualizar README..."], "created_at": "2026-05-01T00:00:00.000Z", "updated_at": null, "started_at": null, "completed_at": null }
```

### Rotas
- `GET /api/company-tasks`
- `POST /api/company-tasks`
- `PUT /api/company-tasks/:id`
- `DELETE /api/company-tasks/:id`

---

## 4. PAYMENTS 🔴 CRÍTICO

### Schema REAL do server.js
```json
[
  {
    "paymentId": "string (pay-{ts}-{rand})",
    "id": "string (mesmo que paymentId)",
    "clientId": "string | null",
    "clientName": "string",
    "clientShortName": "string",
    "projectName": "string",
    "projectId": "string",
    "description": "string",
    "totalAmount": { "value": "number", "currency": "string" },
    "equivalentEUR": { "value": "number", "currency": "string" } | null,
    "status": "string (pending|partial|paid)",
    "paymentTerms": { "type": "string (full|split)", "splits": [
      { "dueDate": "YYYY-MM-DD", "status": "string", "percent": "number", "label": "string" }
    ]},
    "methodPreferred": "string | null",
    "methodAccepted": "string[]",
    "revenueSplit": [
      { "personId": "string", "type": "string", "percent": "number", "received": "boolean" }
    ],
    "transactions": [
      { "id": "string", "date": "YYYY-MM-DD", "amount": { "value": "number", "currency": "string" }, "method": "string", "methodLabel": "string", "paidBy": "string", "phase": "number", "notes": "string", "proofOfPayment": "string | null", "recordedBy": "string", "recordedAt": "ISO string" }
    ],
    "notes": "string",
    "links": "object",
    "companySharePercent": "number (default 25)",
    "createdAt": "ISO string",
    "updatedAt": "ISO string"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| client_id | text | YES |
| client_name | text | YES |
| project_id | text | YES |
| project_name | text | YES |
| amount_value | numeric | YES |
| amount_currency | text | YES |
| status | text | YES |
| due_date | date | YES |
| paid_date | date | YES |
| installments | jsonb | YES |
| notes | text | YES |
| created_by | text | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
| Campo no server.js | Campo no PG | Status |
|--------------------|-------------|--------|
| `paymentId` | `id` | ⚠️ Nome diferente, mas mapeável |
| `totalAmount` | `amount_value` + `amount_currency` | ❌ Nome diferente — server NUNCA escreve `amount` |
| `paymentTerms.splits` | `installments` | ❌ Nome diferente, estrutura diferente |
| `transactions` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `revenueSplit` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `companySharePercent` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `clientShortName` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `description` | `name` | ❌ Nome diferente |
| `equivalentEUR` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `methodPreferred` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `methodAccepted` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `links` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `due_date` (PG) | `paymentTerms.splits[].dueDate` | ❌ PG espera scalar, server usa array |
| `paid_date` (PG) | **NÃO USADO** | 🔴 PG coluna órfã |

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/payments`
- `GET /api/payments/:id`
- `POST /api/payments`
- `PUT /api/payments/:id`
- `POST /api/payments/:id/transactions`
- `GET /api/payments/:id/split`
- `POST /api/payments/:id/split/:personId/receive`

---

## 5. EXPENSES

### Schema REAL do server.js
```json
[
  {
    "id": "string (exp-{ts}-{rand})",
    "name": "string",
    "description": "string",
    "amount": { "value": "number", "currency": "string" },
    "costPerPerson": { "value": "number", "currency": "string" },
    "type": "string (one_time|recurring)",
    "period": "string | null (monthly|quarterly|annual)",
    "periodLabel": "string",
    "startDate": "YYYY-MM-DD | null",
    "renewDate": "YYYY-MM-DD | null",
    "endDate": "YYYY-MM-DD | null",
    "category": "string",
    "categoryLabel": "string",
    "splitAmong": "string[]",
    "paidBy": { "[personId]": { "paid": "boolean", "amount": "number", "paidAt": "ISO | null", "method": "string | null" } },
    "fullyPaid": "boolean",
    "autoDeductFromCashBox": "boolean",
    "notes": "string",
    "attachments": "array",
    "createdBy": "string",
    "createdAt": "ISO string",
    "updatedAt": "ISO string"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| description | text | YES |
| amount_value | numeric | YES |
| amount_currency | text | YES |
| cost_per_person_value | numeric | YES |
| cost_per_person_currency | text | YES |
| type | text | YES |
| period | text | YES |
| period_label | text | YES |
| start_date | date | YES |
| renew_date | date | YES |
| end_date | date | YES |
| category | text | YES |
| category_label | text | YES |
| split_among | jsonb | YES |
| paid_by | jsonb | YES |
| fully_paid | boolean | YES |
| auto_deduct_from_cash_box | boolean | YES |
| notes | text | YES |
| attachments | jsonb | YES |
| created_by | text | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH
✅ **Zero mismatch.** snake_case ↔ camelCase perfeito.

### Exemplo real (PG)
```json
{ "id": "exp-1778317687557-l1nq", "name": "Kimi", "description": "", "amount_value": "34.43", "amount_currency": "EUR", "cost_per_person_value": "34.43", "cost_per_person_currency": "EUR", "type": "one_time", "period": null, "period_label": "Único", "start_date": "2026-05-08T22:00:00.000Z", "renew_date": null, "end_date": null, "category": "ai_tools", "category_label": "IA / Tools", "split_among": [], "paid_by": {}, "fully_paid": true, "auto_deduct_from_cash_box": true, "notes": "", "attachments": [], "created_by": "system", "created_at": "2026-05-09T09:08:07.557Z", "updated_at": "2026-05-09T09:08:07.557Z" }
```

### Rotas
- `GET /api/expenses`
- `POST /api/expenses`
- `PUT /api/expenses/:id`
- `DELETE /api/expenses/:id`
- `POST /api/expenses/:id/pay`
- `GET /api/expenses/templates`
- `POST /api/expenses/templates`
- `GET /api/expenses/search`
- `POST /api/expenses/quick`

---

## 6. CASH_BOX ⚠️ PARCIAL

### Schema REAL do server.js
```json
{
  "balance": { "value": "number", "currency": "string" },
  "monthlyIncome": { "value": "number", "currency": "string" },
  "monthlyExpenses": { "value": "number", "currency": "string" },
  "projectedBalance": { "value": "number", "currency": "string" },
  "projectionMonths": "number (default 3)",
  "incomingPayments": [
    { "expectedDate": "YYYY-MM-DD", "amount": "number", "probability": "number" }
  ],
  "outgoingExpenses": [
    { "expenseId": "string", "name": "string", "amount": "number", "frequency": "string", "equivalentMonthly": "number", "note": "string" }
  ],
  "history": [
    { "id": "string", "date": "YYYY-MM-DD", "type": "string", "amount": "number", "source?": "string", "description?": "string", "category?": "string", "balanceAfter": "number", "recordedBy": "string", "recordedAt": "ISO string", "note?": "string", "isActive?": "boolean", "deletedAt?": "ISO string", "deletedBy?": "string", "parentPaymentId?": "string", "recipientId?": "string", "distribution?": "object" }
  ],
  "lastUpdated": "ISO string",
  "alerts": "array (NÃO SINCRONIZADO COM PG)",
  "settings": "object (NÃO SINCRONIZADO COM PG)",
  "auditLog": "array (NÃO SINCRONIZADO COM PG)"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | integer | NO |
| balance_value | numeric | YES |
| balance_currency | text | YES |
| monthly_income_value | numeric | YES |
| monthly_income_currency | text | YES |
| monthly_expenses_value | numeric | YES |
| monthly_expenses_currency | text | YES |
| projected_balance_value | numeric | YES |
| projected_balance_currency | text | YES |
| projection_months | integer | YES |
| incoming_payments | jsonb | YES |
| outgoing_expenses | jsonb | YES |
| history | jsonb | YES |
| last_updated | timestamptz | YES |

### MISMATCH ⚠️
- `alerts`, `settings`, `auditLog` **não existem no PG** — perdidos no restore
- O restante é 1:1 com snake_case ↔ camelCase

### Exemplo real (PG)
```json
{ "id": 1, "balance_value": "0.00", "balance_currency": "EUR", "monthly_income_value": "0.00", "monthly_income_currency": "EUR", "monthly_expenses_value": "0.00", "monthly_expenses_currency": "EUR", "projected_balance_value": "0.00", "projected_balance_currency": "EUR", "projection_months": 3, "incoming_payments": [], "outgoing_expenses": [], "history": [{ "id": "etx-1779218374987-6n2c", "date": "76543-08-08", "note": "", "type": "income", "amount": 100, "source": "manual-entry", "category": "jordan", "isActive": false, "deletedAt": "2026-05-19T19:20:04.566Z", "deletedBy": "system", "recordedAt": "2026-05-19T19:19:34.987Z", "recordedBy": "luna", "description": "cerveja", "balanceAfter": 100 }], "last_updated": "2026-05-19T19:20:04.566Z" }
```

### Rotas
- `GET /api/cash-box`
- `PUT /api/cash-box`
- `GET /api/cash-box/projection`
- `POST /api/cash-box/adjust`
- `GET /api/cash-box/history`
- `GET /api/cash-box/statement`
- `POST /api/cash-box/entries`
- `GET /api/cash-box/entries/:id`
- `PUT /api/cash-box/entries/:id`
- `DELETE /api/cash-box/entries/:id`
- `POST /api/cash-box/reconcile`
- `POST /api/cash-box/payments`
- `POST /api/cash-box/payments/:id/apply-distribution`
- `GET /api/cash-box/payments/:id`

---

## 7. QUOTES 🔴 CRÍTICO

### Schema REAL do server.js
```json
[
  {
    "quoteId": "string (quote-{client}-{n})",
    "projectId": "string",
    "projectName": "string",
    "clientName": "string",
    "clientId": "string",
    "status": "string (draft|sent|accepted|rejected|expired)",
    "statusLabel": "string",
    "totalAmount": { "value": "number", "currency": "string" },
    "monthlyFee": { "value": "number", "currency": "string" },
    "year1Investment": { "value": "number", "currency": "string" },
    "discountUpfront": { "percent": "number", "amount": "number", "currency": "string" },
    "items": [
      { "id": "string", "description": "string", "category": "string", "quantity": "number", "unitPrice": "number", "total": "number", "details": "string[]" }
    ],
    "githubUrl": "string | null",
    "createdAt": "ISO string",
    "sentAt": "ISO string | null",
    "validUntil": "ISO string | null",
    "updatedAt": "ISO string | null"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| project_id | text | YES |
| project_name | text | YES |
| client_name | text | YES |
| client_id | text | YES |
| status | text | YES |
| status_label | text | YES |
| total_amount_value | numeric | YES |
| total_amount_currency | text | YES |
| monthly_fee_value | numeric | YES |
| monthly_fee_currency | text | YES |
| year1_investment_value | numeric | YES |
| year1_investment_currency | text | YES |
| discount_percent | numeric | YES |
| discount_amount | numeric | YES |
| discount_currency | text | YES |
| created_at | timestamptz | YES |
| sent_at | timestamptz | YES |
| valid_until | date | YES |
| github_url | text | YES |
| items | jsonb | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
- `quoteId` usado como PK no server.js; PG usa `id` — **lookup quebra**
- `totalAmount`, `monthlyFee`, `year1Investment`, `discountUpfront` são objetos aninhados no server; PG tem `_value`/`_currency` separados

### Exemplo real (PG)
```json
{ "id": "quote-tropicale-001", "project_id": "proj-tropicale-001", "project_name": "TPV Sorveteria Tropicale", "client_name": "Juan - Sorveteria Tropicale", "client_id": "juan-tropicale", "status": "sent", "status_label": "Orçamento Enviado - Aguardando Resposta", "total_amount_value": "5500.00", "total_amount_currency": "EUR", "monthly_fee_value": "199.00", "monthly_fee_currency": "EUR", "year1_investment_value": "7888.00", "year1_investment_currency": "EUR", "discount_percent": "5.00", "discount_amount": "5225.00", "discount_currency": "EUR", "created_at": "2026-04-26T00:00:00.000Z", "sent_at": "2026-04-26T00:00:00.000Z", "valid_until": "2026-05-25T22:00:00.000Z", "github_url": "https://github.com/Jhin1v9/tpv-orcamento-sorveteria/tree/main/pressuposto", "items": [{ "id": "item-001", "total": 1200, "details": ["Tela de login..."], "category": "Desenvolvimento Frontend", "quantity": 1, "unitPrice": 1200, "description": "Interface do TPV..." }, ...], "updated_at": null }
```

### Rotas
- `GET /api/quotes`
- `GET /api/quotes/:id`
- `POST /api/quotes`
- `PUT /api/quotes/:id`
- `DELETE /api/quotes/:id`

---

## 8. LEADS 🔴 CRÍTICO

### Schema REAL do server.js
```json
[
  {
    "id": "string (lead-{ts}-{rand})",
    "displayName": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "source": "string (default 'manual')",
    "type": "string (default 'lead')",
    "status": "string (default 'potencial')",
    "pipelineStatus": "string (default 'novo')",
    "estimatedValue": "number (default 0)",
    "currency": "string (default 'EUR')",
    "notes": "string",
    "assignedTo": "string | null",
    "tags": "string[]",
    "createdAt": "ISO string",
    "lastContact": "null",
    "convertedAt?": "ISO string"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| email | text | YES |
| phone | text | YES |
| company | text | YES |
| source | text | YES |
| status | text | YES |
| notes | text | YES |
| metadata | jsonb | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
| Campo no server.js | Campo no PG | Status |
|--------------------|-------------|--------|
| `displayName` | `name` | ❌ Nome diferente |
| `pipelineStatus` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `estimatedValue` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `type` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `lastContact` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `convertedAt` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `company` (PG) | **NÃO USADO** | 🔴 PG coluna órfã |
| `metadata` (PG) | **NÃO USADO** | 🔴 PG coluna órfã |

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/leads`
- `GET /api/leads/:id`
- `POST /api/leads`
- `PUT /api/leads/:id`
- `POST /api/leads/:id/convert`
- `DELETE /api/leads/:id`

---

## 9. MEMBERS

### Schema REAL do server.js
```json
[
  {
    "id": "string",
    "name": "string",
    "role": "string",
    "skills": "string[]",
    "sharePercent": "number",
    "status": "string",
    "projects": "string[]",
    "email": "string",
    "phone": "string",
    "country": "string",
    "joinedAt": "ISO string | null",
    "note": "string",
    "createdAt?": "ISO string",
    "updatedAt": "ISO string"
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| role | text | YES |
| skills | jsonb | YES |
| share_percent | numeric | YES |
| status | text | YES |
| projects | jsonb | YES |
| email | text | YES |
| phone | text | YES |
| country | text | YES |
| joined_at | date | YES |
| note | text | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH
✅ **Zero mismatch.** snake_case ↔ camelCase perfeito.

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/members`
- `PUT /api/members/:id`

---

## 10. TRANSACTIONS ⚠️ PARCIAL

### Schema REAL do server.js (POST cria)
```json
{
  "id": "string (tx-{ts})",
  "type": "string (income|expense)",
  "amount": "number",
  "currency": "string (default 'EUR')",
  "description": "string",
  "category": "string (default 'outros')",
  "date": "YYYY-MM-DD (default today)",
  "source": "string (default 'manual')",
  "notes": "string",
  "createdAt": "ISO string",
  "createdBy": "string (default 'abner')"
}
```

### Schema REAL do server.js (PG layer salva)
```json
{
  "balanceAfter": "number",
  "recordedBy": "string",
  "recordedAt": "ISO string",
  "note": "string",
  "isActive": "boolean (default true)",
  "deletedAt": "ISO string | null",
  "deletedBy": "string | null",
  "metadata": "object (default {})",
  "updatedAt": "ISO string"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| date | date | YES |
| type | text | YES |
| amount | numeric | YES |
| description | text | YES |
| category | text | YES |
| balance_after | numeric | YES |
| recorded_by | text | YES |
| recorded_at | timestamptz | YES |
| note | text | YES |
| source | text | YES |
| is_active | boolean | YES |
| deleted_at | timestamptz | YES |
| deleted_by | text | YES |
| metadata | jsonb | YES |

### MISMATCH ⚠️
- `currency` criado pelo server mas **NÃO EXISTE no PG**
- `createdBy` criado pelo server mas **NÃO EXISTE no PG**
- `notes` (server POST) vs `note` (PG) — **nome diferente**
- `balance_after`, `recorded_by`, `recorded_at`, `is_active`, `deleted_at`, `deleted_by`, `metadata` existem no PG mas o server **NÃO os seta no POST** (só no cash-box history)

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/transactions`
- `GET /api/transactions/:id`
- `POST /api/transactions`
- `PUT /api/transactions/:id`
- `DELETE /api/transactions/:id`

---

## 11. LINKS

### Schema REAL do server.js
```json
{
  "links": [
    {
      "id": "string",
      "url": "string",
      "author": "string",
      "timestamp": "ISO string",
      "chat": "string",
      "notes": "string",
      "manual": "boolean",
      "preview": {
        "url": "string", "originalUrl": "string", "title": "string", "description": "string",
        "image": "string | null", "favicon": "string", "siteName": "string", "type": "string",
        "status": "number", "isError": "boolean", "isBroken": "boolean", "fetchedAt": "ISO string"
      },
      "platform": "string",
      "patterns": "array",
      "icon": "string",
      "color": "string",
      "category": "string",
      "label": "string",
      "hostname": "string",
      "enrichedAt": "ISO string | null",
      "createdAt": "ISO string",
      "updatedAt": "ISO string | null"
    }
  ],
  "lastUpdated": "ISO string"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| url | text | NO |
| author | text | YES |
| timestamp | timestamptz | YES |
| chat | text | YES |
| notes | text | YES |
| manual | boolean | YES |
| preview | jsonb | YES |
| platform | text | YES |
| patterns | jsonb | YES |
| icon | text | YES |
| color | text | YES |
| category | text | YES |
| label | text | YES |
| hostname | text | YES |
| enriched_at | timestamptz | YES |
| created_at | timestamptz | YES |

### MISMATCH
✅ **Zero mismatch.** snake_case ↔ camelCase perfeito.

### Exemplo real (PG)
```json
{ "id": "link-1778278080439-mwik", "url": "https://github.com/nexodigitalsys-ctrl", "author": "Desconhecido", "timestamp": "2026-05-08T22:08:00.439Z", "chat": "Desconhecido", "notes": "", "manual": true, "preview": { "url": "https://github.com/nexodigitalsys-ctrl", "type": "profile", "image": "https://avatars.githubusercontent.com/u/234789460?v=4?s=400", "title": "nexodigitalsys-ctrl - Overview", "status": 200, "favicon": "https://www.google.com/s2/favicons?domain=github.com&sz=64", "isError": false, "isBroken": false, "siteName": "GitHub", "fetchedAt": "2026-05-09T15:48:03.587Z", "description": "nexodigitalsys-ctrl has 11 repositories available. Follow their code on GitHub.", "originalUrl": "https://github.com/nexodigitalsys-ctrl" }, "platform": "github", "patterns": [{}, {}, {}], "icon": "Github", "color": "#181717", "category": "dev", "label": "🐙 GitHub", "hostname": "github.com", "enriched_at": "2026-05-09T15:48:03.587Z", "created_at": "2026-05-08T22:08:00.439Z" }
```

### Rotas
- `GET /api/links/preview`
- `GET /api/links`
- `GET /api/links/platforms`
- `GET /api/links/stats`
- `POST /api/links/enrich`
- `POST /api/links/sync`
- `POST /api/links`
- `DELETE /api/links/:id`
- `PUT /api/links/:id`

---

## 12. NOTIFICATIONS

### Schema REAL do server.js
```json
{
  "version": "1.0",
  "notifications": [
    {
      "id": "string (notif-{n})",
      "type": "string",
      "title": "string",
      "message": "string",
      "severity": "string (default 'medium')",
      "read": "boolean",
      "timestamp": "ISO string",
      "metadata": "object (default {})"
    }
  ],
  "lastId": "number"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| type | text | YES |
| title | text | NO |
| message | text | YES |
| severity | text | YES |
| read | boolean | YES |
| timestamp | timestamptz | YES |
| metadata | jsonb | YES |
| created_at | timestamptz | YES |

### MISMATCH
✅ **Zero mismatch.** snake_case ↔ camelCase perfeito.

### Exemplo real (PG)
```json
{ "id": "notif-9", "type": "security_alert", "title": "🚨 Login falho detectado", "message": "Login falho para \"22\" — IP: 127.0.0.1 (Servidor Local, Rede Local)", "severity": "high", "read": true, "timestamp": "2026-05-14T08:19:23.827Z", ... }
```

### Rotas
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `DELETE /api/notifications/:id`
- `POST /api/notifications/read-all`

---

## 13. SECURITY_LOGS 🔴 CRÍTICO

### Schema REAL do server.js
```json
{
  "version": "1.0",
  "events": [
    {
      "id": "string (sec-{ts})",
      "timestamp": "ISO string",
      "type": "string (e.g. failed_login)",
      "severity": "string (critical|high)",
      "ip": "string",
      "location": { "country", "city", "region", "isp", "org", "lat", "lon", "timezone" },
      "risk": { "isVpn", "isProxy", "isTor", "isHosting", "isAnonymous", "threatScore", "provider", "source" },
      "device": { "browser", "browserVersion", "os", "device", "arch", "isMobile", "screen", "resolution", "gpu", "timezone", "language", "fingerprint", "fingerprintFull", "userAgent" },
      "attemptedUser": "string",
      "message": "string",
      "notified": "boolean",
      "notificationChannel": "string",
      "hasCameraPhoto": "boolean",
      "hasScreenshot": "boolean",
      "cameraPhoto": "string | null",
      "screenshot": "string | null",
      "intruderData": "object"
    }
  ],
  "lastNotifiedAt": "ISO string | null",
  "settings": "object"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| event_type | text | YES |
| user_id | text | YES |
| ip | text | YES |
| location | text | YES |
| user_agent | text | YES |
| success | boolean | YES |
| details | jsonb | YES |
| created_at | timestamptz | YES |

### MISMATCH 🔴
| Campo no server.js | Campo no PG | Status |
|--------------------|-------------|--------|
| `type` | `event_type` | ❌ Nome diferente |
| `severity` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `location` (objeto) | `location` (text) | ❌ Tipo diferente |
| `risk` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `device` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `attemptedUser` | `user_id` | ❌ Nome diferente |
| `message` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `notified` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `notificationChannel` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `hasCameraPhoto` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `hasScreenshot` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `cameraPhoto` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `screenshot` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `intruderData` | `details` (jsonb) | ⚠️ Possível mapear |
| `lastNotifiedAt` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `settings` | **NÃO EXISTE** | 🔴 **PERDIDO** |

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/security/log`
- `GET /api/security/settings`
- `PUT /api/security/settings`
- `POST /api/security/test-whatsapp`

---

## 14. CHANGELOG 🔴 CRÍTICO

### Schema REAL do server.js
**Arquivo:** `backend/changelog.json` (FORA de `data/`!)
```json
{
  "version": "1.0",
  "lastUpdated": "ISO string",
  "entries": [
    {
      "id": "string",
      "version": "string",
      "title": "string",
      "description": "string",
      "category": "string",
      "emoji": "string",
      "author": "string",
      "tier": "number",
      "date": "ISO string",
      "tags": "string[]",
      "readBy": "string[]"
    }
  ]
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| version | text | YES |
| title | text | NO |
| description | text | YES |
| category | text | YES |
| emoji | text | YES |
| author | text | YES |
| tier | integer | YES |
| date | timestamptz | YES |
| tags | jsonb | YES |
| read_by | jsonb | YES |
| created_at | timestamptz | YES |

### MISMATCH 🔴
- Server usa `backend/changelog.json` (fora de `data/`), não `backend/data/changelog.json`
- `lastUpdated` no server.js — **NÃO EXISTE no PG**
- `entries` wrapper no JSON — **NÃO EXISTE no PG** (PG é flat table)

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/changelog`
- `GET /api/changelog/latest`
- `GET /api/changelog/unread`
- `POST /api/changelog/:id/read`
- `POST /api/changelog/:id/unread`
- `POST /api/changelog`

---

## 15. IDEAS 🔴 CRÍTICO

### Schema REAL do server.js
**Arquivo:** `backend/data/ideas-registry.json`
```json
{
  "ideas": { "[id:string]": { ... } },
  "_meta": { "totalIdeas": "number", "lastIdeaId": "string" },
  "templates": { "[id:string]": { ... } },
  "categories": { "[id:string]": { ... } }
}
```

Cada idea:
```json
{
  "id": "string",
  "title": "string",
  "status": "string (rascunho|em-discussao|aprovada|rejeitada|em-andamento|concluida|arquivada)",
  "type": "string (proposta-comercial|brainstorm|prd|pipeline-vendas|estrategia|processo|marketing|outro)",
  "priority": "string (baixa|media|alta|urgente)",
  "linkedTo": { "clientId", "clientName", "leadId", "projectId", "projectName" },
  "content": { "blocks": "Block[]" },
  "aiContext": { "brainstormHistory": "[]", "aiSuggestions": "[]", "aiInsights": "[]" },
  "tags": "string[]",
  "createdBy": "string",
  "createdByName": "string",
  "createdAt": "ISO string",
  "updatedAt": "ISO string",
  "collaborators": "string[]",
  "comments": "Comment[]",
  "attachments": "[]",
  "versionHistory": "Version[]",
  "summary": "string",
  "dueDate": "string",
  "assignedTo": "string",
  "convertedTo": { "taskId", "convertedAt" }
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| title | text | NO |
| summary | text | YES |
| status | text | YES |
| category | text | YES |
| priority | text | YES |
| author | text | YES |
| tags | jsonb | YES |
| blocks | jsonb | YES |
| metadata | jsonb | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
- Server usa objeto `{ ideas: { [id]: {...} } }` — PG é flat table
- `type`, `linkedTo`, `content`, `aiContext`, `createdByName`, `collaborators`, `comments`, `attachments`, `versionHistory`, `dueDate`, `assignedTo`, `convertedTo` — **NÃO EXISTEM no PG**
- `_meta`, `templates`, `categories` no wrapper — **NÃO EXISTEM no PG**

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/ideas`
- `POST /api/ideas`
- `GET /api/ideas/templates`
- `POST /api/ideas/from-template`
- `GET /api/ideas/stats`
- `GET /api/ideas/:id`
- `PUT /api/ideas/:id`
- `DELETE /api/ideas/:id`
- `POST /api/ideas/:id/comments`
- `DELETE /api/ideas/:id/comments/:cid`
- `POST /api/ideas/:id/comments/:cid/reactions`
- `POST /api/ideas/:id/ai-chat`
- `POST /api/ideas/:id/convert-task`
- `POST /api/ideas/:id/apply-ai`

---

## 16. WORKSPACE_CLIENTS 🔴 CRÍTICO

### Schema REAL do server.js
**Arquivo:** `backend/data/workspace-index.json`
```json
{
  "versao": "1.0",
  "ultimaAtualizacao": "ISO string",
  "clientes": [
    {
      "id": "string",
      "nome": "string",
      "caminho": "string",
      "status": "string (ativo|pausado|concluido|arquivado)",
      "cor": "string",
      "responsavel": "string (todos|abner|nonoke|elias)",
      "tipo": "string (default 'cliente')",
      "dataInicio": "YYYY-MM-DD",
      "orcamentoTotal": "number (default 0)",
      "moeda": "string (default 'EUR')",
      "tags": "string[]",
      "anotacoes": "string"
    }
  ]
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| name | text | NO |
| path | text | NO |
| status | text | YES |
| color | text | YES |
| responsavel | text | YES |
| tipo | text | YES |
| data_inicio | date | YES |
| orcamento_total | numeric | YES |
| moeda | text | YES |
| tags | jsonb | YES |
| anotacoes | text | YES |
| metadata | jsonb | YES |
| criado_em | timestamptz | YES |
| atualizado_em | timestamptz | YES |

### MISMATCH 🔴
| Campo no server.js | Campo no PG | Status |
|--------------------|-------------|--------|
| `nome` | `name` | ❌ Nome diferente |
| `caminho` | `path` | ❌ Nome diferente |
| `cor` | `color` | ❌ Nome diferente |
| `dataInicio` | `data_inicio` | ⚠️ snake_case OK |
| `orcamentoTotal` | `orcamento_total` | ⚠️ snake_case OK |
| `anotacoes` | `anotacoes` | ✅ OK |
| `versao` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `ultimaAtualizacao` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `clientes` wrapper | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `criadoEm` | `criado_em` | ⚠️ snake_case OK |
| `atualizadoEm` | `atualizado_em` | ⚠️ snake_case OK |

### Exemplo real (PG)
```json
{ "id": "tpv-sorveteria", "name": "Juan", "path": "tpv-sorveteria", "status": "ativo", "color": "#22C55E", "responsavel": "todos", "tipo": null, "data_inicio": null, "orcamento_total": null, "moeda": null, "tags": null, "anotacoes": null, "metadata": null, "criado_em": null, "atualizado_em": null }
```

### Rotas
- `GET /api/workspace/clients`
- `POST /api/workspace/clients`
- `GET /api/workspace/clients/:id`
- `PUT /api/workspace/clients/:id`
- `DELETE /api/workspace/clients/:id`
- `GET /api/workspace/clients/:id/files`
- `POST /api/workspace/clients/:id/folders`
- `POST /api/workspace/clients/:id/upload`
- `GET /api/workspace/clients/:id/download`
- `GET /api/workspace/clients/:id/content`
- `PUT /api/workspace/clients/:id/content`
- `DELETE /api/workspace/clients/:id/files`
- `POST /api/workspace/clients/:id/rename`
- `GET /api/workspace/clients/:id/detect`
- `POST /api/workspace/clients/:id/start`
- `POST /api/workspace/clients/:id/stop`
- `GET /api/workspace/servers`
- `GET /api/workspace/servers/:serverId/logs`
- `GET /api/workspace/servers/:serverId/logs/stream`

---

## 17. WHATSAPP_HISTORY 🔴 CRÍTICO

### Schema REAL do server.js
```json
[
  {
    "id": "string",
    "text": "string",
    "body": "string (alias de text)",
    "author": "string",
    "authorName": "string",
    "chat": "string",
    "timestamp": "ISO string",
    "classification": { "category", "confidence", ... },
    "reviewed": "boolean",
    "correctedCategory": "string",
    "notes": "string",
    "sentViaDashboard": "boolean",
    "direction": "string (outgoing)",
    "responded": "boolean",
    "resolvedAuthor": { "name", "shortName", "color", "avatar", "avatarEmoji", "role", "phone", "confidence" }
  }
]
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| chat_id | text | YES |
| chat_name | text | YES |
| sender | text | YES |
| message | text | YES |
| timestamp | timestamptz | YES |
| type | text | YES |
| metadata | jsonb | YES |
| created_at | timestamptz | YES |

### MISMATCH 🔴
| Campo no server.js | Campo no PG | Status |
|--------------------|-------------|--------|
| `text` / `body` | `message` | ❌ Nome diferente |
| `author` | `sender` | ❌ Nome diferente |
| `authorName` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `chat` | `chat_name` | ❌ Nome diferente |
| `classification` | `metadata` (jsonb) | ⚠️ Possível mapear |
| `reviewed` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `correctedCategory` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `notes` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `sentViaDashboard` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `direction` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `responded` | **NÃO EXISTE** | 🔴 **PERDIDO** |
| `resolvedAuthor` | **NÃO EXISTE** | 🔴 **PERDIDO** |

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/whatsapp/history`
- `POST /api/whatsapp/send`
- `GET /api/whatsapp-agent`
- `GET /api/whatsapp-agent/status`
- `POST /api/whatsapp-agent/refresh`
- `GET /api/classifications/review`
- `POST /api/classifications/:id/correct`
- `GET /api/classifications/stats`
- `GET /api/whatsapp/checkpoint`
- `DELETE /api/whatsapp/checkpoint`
- `GET /api/whatsapp/buffer`
- `DELETE /api/whatsapp/buffer`
- `GET /api/whatsapp`
- `POST /api/whatsapp`

---

## 18. LUNA_THREADS 🔴 CRÍTICO

### Schema REAL do server.js
```json
{
  "version": "1.0",
  "lastUpdated": "ISO string",
  "threads": {
    "[id:string]": {
      "id": "string",
      "type": "string (individual|group)",
      "title": "string",
      "participants": "string[]",
      "createdAt": "ISO string",
      "updatedAt": "ISO string",
      "messageCount": "number",
      "messages": [
        {
          "id": "string",
          "role": "string (user|assistant)",
          "author": "string",
          "authorName": "string",
          "authorColor": "string",
          "text": "string",
          "timestamp": "ISO string",
          "intent": "object",
          "executed": "boolean",
          "actions": "array",
          "needsConfirmation": "boolean",
          "previewType": "string",
          "editableFields": "array",
          "preview": "object",
          "quotaExhausted": "boolean",
          "resetAt": "string"
        }
      ]
    }
  }
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | text | NO |
| user_id | text | YES |
| title | text | YES |
| messages | jsonb | YES |
| context | jsonb | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
- Server usa `{ version, lastUpdated, threads: { [id]: {...} } }` — PG é flat table
- `type`, `participants`, `messageCount` no thread — **NÃO EXISTEM no PG**
- `messages` é array no server; PG tem `messages` jsonb — possível mapear
- `context` no PG — **NÃO USADO pelo server**

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/luna/threads`
- `GET /api/luna/threads/:id`
- `GET /api/luna/threads/:id/messages`
- `POST /api/luna/threads/:id/messages`
- `DELETE /api/luna/threads/:id/messages`

---

## 19. LUNA_BUFFER 🔴 CRÍTICO

### Schema REAL do server.js
```json
{
  "newMessages": "array",
  "newTasks": "array",
  "newTasksDone": "array",
  "newIdeas": "array",
  "newDecisions": "array",
  "newLinks": "array",
  "newLeads": "array",
  "newFinance": "array",
  "ignoredMessages": "array",
  "newMentions": "array",
  "sentiment": { "positive", "negative", "urgent" },
  "lastBufferUpdate": "ISO string"
}
```

### Schema atual do PostgreSQL
| Coluna | Tipo | Nullable |
|--------|------|----------|
| id | integer | NO |
| data | jsonb | YES |
| updated_at | timestamptz | YES |

### MISMATCH 🔴
- Server usa múltiplos campos separados — PG tem **uma única coluna `data` JSONB**
- `lastBufferUpdate` no server — `updated_at` no PG

### Exemplo real (PG)
`(no data — tabela vazia)`

### Rotas
- `GET /api/whatsapp`
- `GET /api/whatsapp-agent`
- `GET /api/whatsapp-agent/status`
- `GET /api/luna/status`
- `GET /api/luna/pending`
- `POST /api/luna/pending/:id/feedback`
- `POST /api/luna/pending/:id/execute`
- `GET /api/luna/analytics`
- `GET /api/whatsapp/buffer`
- `DELETE /api/whatsapp/buffer`

---

## 🎯 CONCLUSÃO E RECOMENDAÇÕES

### Entidades que precisam de RECRIAÇÃO COMPLETA do schema PG
1. **`payments`** — schema completamente diferente
2. **`quotes`** — `quoteId` vs `id`, objetos aninhados vs colunas separadas
3. **`leads`** — campos completamente diferentes
4. **`security_logs`** — estrutura de eventos completamente diferente
5. **`changelog`** — arquivo em local diferente + wrapper `entries`
6. **`ideas`** — estrutura `{ ideas: { [id]: {...} } }` vs flat table
7. **`workspace_clients`** — nomes diferentes (`nome` vs `name`, `caminho` vs `path`, `cor` vs `color`) + wrapper `clientes`
8. **`whatsapp_history`** — campos completamente diferentes
9. **`luna_threads`** — wrapper `threads` + campos extras
10. **`luna_buffer`** — múltiplos campos vs coluna única `data`

### Entidades que precisam de AJUSTES MENORES
1. **`users`** — adicionar `discord_id` (opcional), retornar `created_at` no datastore
2. **`cash_box`** — adicionar `alerts`, `settings`, `audit_log` como JSONB
3. **`transactions`** — adicionar `currency`, `created_by`; renomear `note` → `notes` OU ajustar server

### Entidades 1:1 (não precisam mudar)
1. **`tasks`** ✅
2. **`company_tasks`** ✅
3. **`expenses`** ✅
4. **`members`** ✅
5. **`links`** ✅
6. **`notifications`** ✅

### Estratégia recomendada
1. **Recriar as 10 tabelas críticas** com schema 1:1 com o server.js
2. **Ajustar 3 tabelas parciais**
3. **Manter 6 tabelas intactas**
4. **Reescrever `datastore-pg.js`** para usar os NOMES REAIS dos campos (zero adapter)
5. **Reescrever `migrate-json-to-pg.js`** para INSERT direto 1:1
