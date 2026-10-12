# 📊 Relatório Fase 0.1 — Reverse Schema Engineering

> **Projeto:** NEXO Dashboard Pro  
> **Data:** 2026-05-22  
> **Commit:** `66f6be7`  
> **Status:** ✅ Concluído · Aguardando autorização para Fase 0.2

---

## 🎯 Objetivo

Alinhar o schema PostgreSQL **exatamente** com o que o `server.js` usa hoje em seus arquivos JSON, eliminando qualquer necessidade de adapters, mappers ou tradução de nomes de campos.

> **Regra de ouro:** PostgreSQL = espelho 1:1 dos JSONs. Zero tradução.

---

## 🔍 Problema Identificado (Pré-Migração)

| Aspecto | Situação |
|---------|----------|
| Schema PG original | Desenhado teoricamente (`migrations/001-init.sql`) |
| Schema real | Definido inline no `server.js` (8.800 linhas) |
| Mismatch crítico | `payments`: PG tinha `id/amount/installments` vs JSON usa `paymentId/totalAmount/transactions/revenueSplit` |
| Tabelas afetadas | payments, quotes, workspace_clients, cash_box (faltava alerts/settings/auditLog) |
| Dados em risco | 22 tabelas com dados sincronizados via `pg-sync.js`, mas com campos perdidos ou renomeados |

---

## 🛠️ Deliverables Executados

### 1. Schema Audit Completo
- **Arquivo:** `backend/docs/SCHEMA_AUDIT.md` (46 KB)
- **Conteúdo:** Mapeamento campo-a-campo de todas as entidades (14+)
- **Descobertas críticas:**  
  - `payments`: 9 campos do JSON não existiam no PG  
  - `cash_box`: `alerts`, `settings`, `auditLog` não sincronizados  
  - `quotes`: estrutura completamente diferente (objetos aninhados vs colunas flat)

### 2. Nova Migration SQL
- **Arquivo:** `backend/migrations/005-real-schema.sql`
- **Estratégia:**

| Tabela | Ação | Dados Preservados |
|--------|------|-------------------|
| `users` | `ALTER TABLE` + `discord_id` | ✅ 3 rows |
| `tasks` | Sem alteração | ✅ 84 rows |
| `company_tasks` | Sem alteração | ✅ 76 rows |
| `expenses` | Sem alteração | ✅ 9 rows |
| `cash_box` | `ALTER TABLE` + 3 colunas JSONB | ✅ 1 row |
| `notifications` | Sem alteração | ✅ 12 rows |
| `links` | Sem alteração | ✅ 46 rows |
| `workspace_clients` | `DROP` → `CREATE` → restore backup | ✅ 2 rows |
| `quotes` | `DROP` → `CREATE` → restore backup | ✅ 4 rows |
| `payments` | `DROP` → `CREATE` (vazia) | — |
| `leads` | `DROP` → `CREATE` (vazia) | — |
| `members` | `DROP` → `CREATE` (vazia) | — |
| `transactions` | `DROP` → `CREATE` (vazia) | — |
| `security_logs` | `DROP` → `CREATE` (vazia) | — |
| `changelog` | `DROP` → `CREATE` (vazia) | — |
| `ideas` | `DROP` → `CREATE` (vazia) | — |
| `whatsapp_history` | `DROP` → `CREATE` (vazia) | — |
| `luna_threads` | `DROP` → `CREATE` (vazia) | — |
| `luna_buffer` | `DROP` → `CREATE` (vazia) | — |

### 3. Datastore Reescrito
- **Arquivo:** `backend/datastore-pg.js` (38.119 bytes)
- **Funções:** 33 exportadas (get/save/delete para 14+ entidades)
- **Princípios:**
  - Nomes de campos **idênticos** aos JSONs (`paymentId`, `totalAmount`, `revenueSplit`...)
  - Sem fallback JSON — fatal exit se `DATABASE_URL` ausente
  - `onChange(callback)` → WebSocket broadcast automático
  - Tratamento de JSONB com `JSON.stringify()` em inserts

### 4. Script de Migração de Dados
- **Arquivo:** `backend/migrate-005.js`
- **Resultado da execução (Neon DB):**

```
✅ security_logs: 0 → 14 rows (+14)
✅ changelog:     0 → 31 rows  (+31)
✅ ideas:         0 → 7 rows   (+7)
✅ whatsapp_history: 0 → 1.171 rows (+1.171)
✅ luna_threads:  0 → 4 rows   (+4)
✅ luna_buffer:   0 → 1 row    (+1)
─────────────────────────────────────
TOTAL inserido: 1.228 rows
```

### 5. Validação Pós-Migração

**Quotes — estrutura JSONB correta:**
```json
{
  "quote_id": "quote-tropicale-001",
  "total_amount": { "value": 5500, "currency": "EUR" },
  "monthly_fee": { "value": 199, "currency": "EUR" }
}
```

**Workspace Clients — nomes em português:**
```json
{
  "id": "tpv-sorveteria",
  "nome": "Juan",
  "caminho": "tpv-sorveteria",
  "status": "ativo"
}
```

**Cash Box — novos campos com defaults:**
```json
{
  "alerts": [],
  "settings": {
    "currency": "EUR",
    "projectionMonths": 3,
    "autoDeductRecurring": true,
    "lowBalanceMultiplier": 2
  },
  "audit_log": []
}
```

---

## 🚀 Deploy

- **Repositório:** `Jhin1v9/NexoDashboard`
- **Commit:** `66f6be7`
- **Render:** `https://nexodashboard.onrender.com`
- **Health Check:** `200 OK` ✅

---

## 📋 Estado Atual das Rotas

| Entidade | Fonte de Dados | Método |
|----------|----------------|--------|
| `users` | `datastore-pg.js` | ✅ Direto PG |
| `tasks` | `datastore-pg.js` | ✅ Direto PG |
| `company_tasks` | JSON + `pg-sync.js` | ⏳ Pendente |
| `payments` | JSON + `pg-sync.js` | ⏳ Pendente |
| `expenses` | JSON + `pg-sync.js` | ⏳ Pendente |
| `cash_box` | JSON + `pg-sync.js` | ⏳ Pendente |
| `quotes` | JSON + `pg-sync.js` | ⏳ Pendente |
| `leads` | JSON + `pg-sync.js` | ⏳ Pendente |
| `members` | JSON + `pg-sync.js` | ⏳ Pendente |
| `transactions` | JSON + `pg-sync.js` | ⏳ Pendente |
| `links` | JSON + `pg-sync.js` | ⏳ Pendente |
| `notifications` | JSON + `pg-sync.js` | ⏳ Pendente |
| `security_logs` | JSON + `pg-sync.js` | ⏳ Pendente |
| `changelog` | JSON + `pg-sync.js` | ⏳ Pendente |
| `ideas` | JSON + `pg-sync.js` | ⏳ Pendente |
| `whatsapp_history` | JSON + `pg-sync.js` | ⏳ Pendente |
| `luna_threads` | JSON + `pg-sync.js` | ⏳ Pendente |
| `luna_buffer` | JSON + `pg-sync.js` | ⏳ Pendente |
| `workspace_clients` | JSON + `pg-sync.js` | ⏳ Pendente |

---

## 🎬 Próximos Passos (Fase 0.2)

1. **Migrar rotas por entidade** — substituir `readJSON`/`writeJSON` por `dataStore.*` em `server.js`
2. **Desativar `pg-sync.js`** — após 100% das entidades migradas
3. **Remover arquivos JSON** — após validação completa

> ⛔ **Aguardando autorização do Abner para prosseguir.**

---

## 📁 Arquivos Criados/Alterados

```
backend/
├── docs/
│   ├── SCHEMA_AUDIT.md          (46 KB · audit completo)
│   └── RELATORIO_FASE_0_1.md    (este arquivo)
├── migrations/
│   └── 005-real-schema.sql      (novo · schema real)
├── datastore-pg.js              (reescrito · 38 KB)
├── migrate-005.js               (novo · script de migração)
└── server.js                    (modificado · tasks já em PG)
```

---

*Relatório gerado automaticamente após commit `66f6be7`.*
