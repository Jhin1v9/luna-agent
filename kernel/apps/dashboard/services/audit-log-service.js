/**
 * ═════════════════════════════════════════════════════════════════════════════
 * AUDIT LOG SERVICE — NEXO Dashboard Pro
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Histórico destrutivo e reversível para TODAS as entidades do dashboard.
 * Diferente do UndoService rápido (30s por thread), este serviço:
 *   • guarda snapshot completo do estado anterior
 *   • cobre delete + update em todas as entidades
 *   • retém alterações por 30 dias
 *   • expõe API para o Telegram listar/desfazer/restaurar
 *
 * Entidades suportadas na v1:
 *   tasks, companyTasks, leads, payments, expenses, quotes, ideas, links,
 *   votingSessions, cashBox, transactions, workspaceClients
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000; // limite de segurança

// Mapeia entityType → método getter/setter/deleter do datastore
const ENTITY_HANDLERS = {
  task: { getter: 'getTasks', setter: 'saveTask', deleter: 'deleteTask', pk: 'id', label: 'Tarefa' },
  companyTask: { getter: 'getCompanyTasks', setter: 'saveCompanyTask', pk: 'id', label: 'Tarefa da empresa' },
  lead: { getter: 'getLeads', setter: 'saveLead', deleter: 'deleteLead', pk: 'id', label: 'Lead' },
  payment: { getter: 'getPayments', setter: 'savePayment', pk: 'id', label: 'Pagamento' },
  expense: { getter: 'getExpenses', setter: 'saveExpense', pk: 'id', label: 'Despesa' },
  quote: { getter: 'getQuotes', setter: 'saveQuote', pk: 'quoteId', label: 'Cotação' },
  idea: { getter: 'getIdeas', setter: 'saveIdea', pk: 'id', label: 'Ideia', listKey: 'ideas' },
  link: { getter: 'getLinks', setter: 'saveLink', pk: 'id', label: 'Link', listKey: 'links' },
  transaction: { getter: 'getTransactions', setter: 'saveTransaction', pk: 'id', label: 'Transação' },
  workspaceClient: { getter: 'getWorkspaceClients', setter: 'saveWorkspaceClient', deleter: 'deleteWorkspaceClient', pk: 'id', label: 'Cliente workspace', listKey: 'clientes' },
  cashBox: { getter: 'getCashBox', setter: 'saveCashBox', pk: 'id', label: 'Caixa' },
};

function nowISO() {
  return new Date().toISOString();
}

function generateId() {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

class AuditLogService {
  constructor(dataStore) {
    this.dataStore = dataStore || require('../datastore');
    this.entries = [];
    this._ensureDataDir();
    this._load();
    this._cleanup();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(AUDIT_FILE)) {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.entries)) {
          this.entries = data.entries;
        } else if (Array.isArray(data)) {
          // formato legado
          this.entries = data;
        }
      }
    } catch (e) {
      console.error('[AuditLogService] Erro ao carregar:', e.message);
      this.entries = [];
    }
  }

  _save() {
    try {
      this._ensureDataDir();
      fs.writeFileSync(AUDIT_FILE, JSON.stringify({ version: '1.0', updatedAt: nowISO(), entries: this.entries }, null, 2), 'utf8');
    } catch (e) {
      console.error('[AuditLogService] Erro ao salvar:', e.message);
    }
  }

  _cleanup() {
    const cutoff = Date.now() - RETENTION_MS;
    const before = this.entries.length;
    this.entries = this.entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (this.entries.length !== before) {
      console.log(`[AuditLogService] ${before - this.entries.length} entradas antigas removidas (> ${RETENTION_DAYS} dias)`);
      this._save();
    }
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
      this._save();
    }
  }

  /**
   * Registra uma alteração no audit log.
   *
   * @param {Object} opts
   *   - entityType: string — tipo da entidade (task, lead, expense, etc.)
   *   - entityId: string — identificador do item
   *   - action: 'create' | 'update' | 'delete'
   *   - actor: string — quem fez a ação (ex: 'telegram-12345', 'dashboard-ui')
   *   - before: Object|null — snapshot completo antes da ação
   *   - after: Object|null — snapshot completo depois da ação
   *   - source: string — origem da ação (ex: 'telegram', 'dashboard', 'cron')
   *   - description: string — texto humanizado curto
   */
  log(opts = {}) {
    const { entityType, entityId, action, actor = 'system', before = null, after = null, source = 'unknown', description = '' } = opts;
    if (!entityType || !entityId || !action) {
      console.warn('[AuditLogService] log ignorado: entityType, entityId e action são obrigatórios');
      return null;
    }

    const entry = {
      id: generateId(),
      timestamp: nowISO(),
      entityType,
      entityId: String(entityId),
      action,
      actor: String(actor),
      source,
      description: description || `${action} ${entityType} ${entityId}`,
      beforeSnapshot: before,
      afterSnapshot: after,
      restored: false,
      restoredAt: null,
    };

    this.entries.push(entry);
    this._cleanup();
    this._save();

    console.log(`[AuditLogService] ${action} ${entityType}/${entityId} por ${actor} (${source})`);
    return entry;
  }

  /**
   * Lista entradas recentes, opcionalmente filtradas.
   */
  list(opts = {}) {
    const { limit = 20, entityType, action, actor, source, includeRestored = false } = opts;
    let result = [...this.entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (entityType) result = result.filter(e => e.entityType === entityType);
    if (action) result = result.filter(e => e.action === action);
    if (actor) result = result.filter(e => e.actor === actor);
    if (source) result = result.filter(e => e.source === source);
    if (!includeRestored) result = result.filter(e => !e.restored);

    return result.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  /**
   * Retorna apenas alterações deletadas (lixeira) que ainda podem ser restauradas.
   */
  listTrash(opts = {}) {
    const { limit = 50, entityType } = opts;
    let result = [...this.entries]
      .filter(e => e.action === 'delete' && !e.restored)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (entityType) result = result.filter(e => e.entityType === entityType);
    return result.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  getById(id) {
    return this.entries.find(e => e.id === id) || null;
  }

  /**
   * Desfaz a última ação de um ator (por padrão excluindo já restauradas).
   */
  async undoLast(actor, opts = {}) {
    if (!actor) return { success: false, error: 'Actor é obrigatório para desfazer.' };

    const actions = opts.actions || ['delete', 'update'];
    const entry = [...this.entries]
      .filter(e => e.actor === actor && actions.includes(e.action) && !e.restored)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    if (!entry) return { success: false, error: 'Nenhuma ação recente para desfazer.' };

    return this.restoreEntry(entry.id, { actor, via: 'undo' });
  }

  /**
   * Restaura um item a partir de uma entrada de audit log.
   * Para delete: recria o item usando o snapshot before.
   * Para update: reverte para o snapshot before.
   */
  async restoreEntry(entryId, opts = {}) {
    const entry = this.getById(entryId);
    if (!entry) return { success: false, error: 'Entrada não encontrada no histórico.' };
    if (entry.restored) return { success: false, error: 'Esta ação já foi desfeita anteriormente.' };

    const handler = ENTITY_HANDLERS[entry.entityType];
    if (!handler) return { success: false, error: `Tipo de entidade não suportado para restauração: ${entry.entityType}` };

    const getter = this.dataStore[handler.getter];
    const setter = this.dataStore[handler.setter];
    if (!getter || !setter) {
      return { success: false, error: `Datastore não possui handler para ${entry.entityType}` };
    }

    try {
      const before = entry.beforeSnapshot;
      const pk = handler.pk;

      if (entry.action === 'delete') {
        if (!before || typeof before !== 'object') {
          return { success: false, error: 'Snapshot de restore incompleto.' };
        }

        // Para entidades que retornam objeto com array
        if (handler.listKey) {
          const data = await getter();
          const list = data[handler.listKey] || [];
          const exists = list.some(item => String(item[pk]) === String(before[pk]));
          if (exists) return { success: false, error: 'Item já existe — não é possível restaurar duplicado.' };
        } else {
          const all = await getter();
          const list = Array.isArray(all) ? all : (all[handler.listKey] || []);
          const exists = list.some(item => String(item[pk]) === String(before[pk]));
          if (exists) return { success: false, error: 'Item já existe — não é possível restaurar duplicado.' };
        }

        await setter(before);
      } else if (entry.action === 'update') {
        if (!before || typeof before !== 'object') {
          return { success: false, error: 'Snapshot de restore incompleto.' };
        }
        await setter(before);
      } else {
        return { success: false, error: `Ação ${entry.action} não pode ser desfeita automaticamente.` };
      }

      entry.restored = true;
      entry.restoredAt = nowISO();
      entry.restoredBy = opts.actor || 'system';
      entry.restoredVia = opts.via || 'manual';
      this._save();

      const label = handler.label || entry.entityType;
      return {
        success: true,
        message: `${label} restaurada com sucesso.`,
        restoredId: entry.entityId,
        entityType: entry.entityType,
        action: entry.action,
      };
    } catch (e) {
      console.error('[AuditLogService] restoreEntry error:', e);
      return { success: false, error: `Erro ao restaurar: ${e.message}` };
    }
  }

  getStats() {
    const total = this.entries.length;
    const deletes = this.entries.filter(e => e.action === 'delete' && !e.restored).length;
    const updates = this.entries.filter(e => e.action === 'update' && !e.restored).length;
    return { total, deletes, updates, retentionDays: RETENTION_DAYS };
  }
}

// Singleton padrão (usa datastore.js). Use createAuditLogService(dataStore) para controlar.
let instance = null;
function getAuditLogService() {
  if (!instance) instance = new AuditLogService();
  return instance;
}

function createAuditLogService(dataStore) {
  return new AuditLogService(dataStore);
}

module.exports = { AuditLogService, getAuditLogService, createAuditLogService, ENTITY_HANDLERS };
