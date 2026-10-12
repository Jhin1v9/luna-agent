/**
 * ═════════════════════════════════════════════════════════════════════════════
 * UNDO SERVICE — NEXO Dashboard Pro
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Stack de undo/redo por thread, persistente em arquivo, TTL 30s.
 * Cada ação destrutiva salva o estado "before" para restauração.
 *
 * Arquitetura:
 *   push(threadId, action) → salva na stack
 *   undo(threadId) → restaura última ação, move para redo stack
 *   redo(threadId) → re-aplica ação, move para undo stack
 *   clearExpired() → remove entradas com mais de 30s
 */

const fs = require('fs');
const path = require('path');

const UNDO_FILE = path.join(__dirname, '..', 'data', 'undo-stack.json');
const MAX_STACK_SIZE = 20;
const TTL_MS = 30 * 1000; // 30 segundos

class UndoService {
  constructor() {
    this.stacks = new Map(); // threadId → { undo: [], redo: [] }
    this.load();
    // Limpa expirados a cada 60s
    this.cleanupInterval = setInterval(() => this.clearExpired(), 60000);
  }

  load() {
    try {
      if (fs.existsSync(UNDO_FILE)) {
        const raw = fs.readFileSync(UNDO_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [threadId, stack] of Object.entries(data)) {
          this.stacks.set(threadId, {
            undo: stack.undo || [],
            redo: stack.redo || [],
          });
        }
      }
    } catch (e) {
      console.error('[UndoService] Erro ao carregar:', e.message);
    }
  }

  save() {
    try {
      const data = {};
      for (const [threadId, stack] of this.stacks) {
        data[threadId] = { undo: stack.undo, redo: stack.redo };
      }
      fs.writeFileSync(UNDO_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[UndoService] Erro ao salvar:', e.message);
    }
  }

  /**
   * Registra uma ação na stack de undo.
   *
   * @param {string} threadId
   * @param {Object} action
   *   - type: 'delete_task' | 'delete_expense' | 'delete_lead' | 'delete_payment' | 'delete_idea' | 'delete_project' | 'delete_client'
   *   - description: string legível (ex: "Excluir tarefa 'Documentar arquitetura'")
   *   - before: Object — snapshot completo do item antes da ação
   *   - after: Object|null — snapshot após a ação (null para deleções)
   *   - restoreFn: string — nome do método de restauração no ActionExecutor
   *   - module: string — endpoint da API para recriar (ex: '/tasks')
   */
  push(threadId, action) {
    if (!threadId || !action?.type) return;

    const stack = this.stacks.get(threadId) || { undo: [], redo: [] };

    const entry = {
      id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: action.type,
      description: action.description || action.type,
      before: action.before,
      after: action.after || null,
      restoreFn: action.restoreFn || null,
      module: action.module || null,
      timestamp: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    };

    stack.undo.push(entry);

    // Limita stack
    if (stack.undo.length > MAX_STACK_SIZE) {
      stack.undo = stack.undo.slice(-MAX_STACK_SIZE);
    }

    // Limpa redo ao fazer nova ação
    stack.redo = [];

    this.stacks.set(threadId, stack);
    this.save();

    console.log(`[UndoService] Push: ${action.description} (thread: ${threadId}, expires: ${new Date(entry.expiresAt).toISOString()})`);
    return entry;
  }

  /**
   * Desfaz a última ação da stack.
   * Retorna a entrada desfeita + os dados necessários para restauração.
   */
  undo(threadId) {
    const stack = this.stacks.get(threadId);
    if (!stack || stack.undo.length === 0) {
      return { success: false, error: 'Nenhuma ação para desfazer' };
    }

    const entry = stack.undo.pop();

    if (Date.now() > entry.expiresAt) {
      this.save();
      return { success: false, error: 'Tempo para desfazer expirou (30s)' };
    }

    stack.redo.push(entry);
    this.stacks.set(threadId, stack);
    this.save();

    console.log(`[UndoService] Undo: ${entry.description} (thread: ${threadId})`);
    return { success: true, entry };
  }

  /**
   * Refaz a última ação desfeita.
   */
  redo(threadId) {
    const stack = this.stacks.get(threadId);
    if (!stack || stack.redo.length === 0) {
      return { success: false, error: 'Nenhuma ação para refazer' };
    }

    const entry = stack.redo.pop();
    stack.undo.push(entry);
    this.stacks.set(threadId, stack);
    this.save();

    console.log(`[UndoService] Redo: ${entry.description} (thread: ${threadId})`);
    return { success: true, entry };
  }

  /**
   * Retorna a stack de undo de uma thread (para mostrar no UI).
   */
  getStack(threadId) {
    const stack = this.stacks.get(threadId);
    if (!stack) return { undo: [], redo: [], canUndo: false, canRedo: false };

    const now = Date.now();
    const validUndo = stack.undo.filter(e => e.expiresAt > now);

    return {
      undo: validUndo.map(e => ({
        id: e.id,
        type: e.type,
        description: e.description,
        expiresAt: e.expiresAt,
        expired: e.expiresAt <= now,
      })),
      redo: stack.redo.map(e => ({
        id: e.id,
        type: e.type,
        description: e.description,
      })),
      canUndo: validUndo.length > 0,
      canRedo: stack.redo.length > 0,
    };
  }

  /**
   * Retorna a última ação de uma thread (para mostrar botão Desfazer).
   */
  getLastAction(threadId) {
    const stack = this.stacks.get(threadId);
    if (!stack || stack.undo.length === 0) return null;

    const last = stack.undo[stack.undo.length - 1];
    if (Date.now() > last.expiresAt) return null;

    return {
      id: last.id,
      type: last.type,
      description: last.description,
      expiresAt: last.expiresAt,
      remainingMs: last.expiresAt - Date.now(),
    };
  }

  /**
   * Remove entradas expiradas de todas as threads.
   */
  clearExpired() {
    const now = Date.now();
    let changed = false;

    for (const [threadId, stack] of this.stacks) {
      const before = stack.undo.length;
      stack.undo = stack.undo.filter(e => e.expiresAt > now);
      if (stack.undo.length !== before) changed = true;

      // Se não há mais nada, remove a thread
      if (stack.undo.length === 0 && stack.redo.length === 0) {
        this.stacks.delete(threadId);
        changed = true;
      }
    }

    if (changed) {
      this.save();
      console.log('[UndoService] Expirados limpos');
    }
  }

  /**
   * Destrói o serviço (limpa intervalo).
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton
let instance = null;

function getUndoService() {
  if (!instance) {
    instance = new UndoService();
  }
  return instance;
}

module.exports = { UndoService, getUndoService };
