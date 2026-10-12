// ============================================================
// LUNA DATA API v18.0 — Acesso Unificado a TODOS os Dados NEXO
// A Luna não responde mais no escuro. Ela CONSULTA os dados.
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../dashboard/data');
const SCHEMA_DIR = path.join(DATA_DIR, 'schema');

function readJSON(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[DataAPI] Erro ao ler ${filePath}:`, e.message);
    return defaultValue;
  }
}

class LunaDataAPI {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5000; // 5 segundos
    this.lastLoad = {};
  }

  // ── CACHE HELPERS ──
  _cached(key, loader) {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && (now - cached.time) < this.cacheTTL) {
      return cached.data;
    }
    const data = loader();
    this.cache.set(key, { data, time: now });
    return data;
  }

  _clearCache() {
    this.cache.clear();
  }

  // ── SCHEMAS ──
  getClientsRegistry() {
    return this._cached('clients-registry', () => readJSON(path.join(SCHEMA_DIR, 'clients-registry.json'), { clients: {} }));
  }

  getProjectsRegistry() {
    return this._cached('projects-registry', () => readJSON(path.join(SCHEMA_DIR, 'projects-registry.json'), { projects: {} }));
  }

  getGroupsConfig() {
    return this._cached('groups-config', () => readJSON(path.join(SCHEMA_DIR, 'groups-config.json'), { groups: {} }));
  }

  getContactsMap() {
    return this._cached('contacts-map', () => readJSON(path.join(SCHEMA_DIR, 'contacts-map.json'), { contacts: {} }));
  }

  // ── RUNTIME DATA ──
  getTasks() {
    return this._cached('tasks', () => readJSON(path.join(DATA_DIR, 'tasks.json'), []));
  }

  getCashBox() {
    return this._cached('cash-box', () => readJSON(path.join(DATA_DIR, 'cash-box.json'), { incomingPayments: [], outgoingExpenses: [], history: [] }));
  }

  getExpenses() {
    return this._cached('expenses', () => readJSON(path.join(DATA_DIR, 'expenses.json'), []));
  }

  getLeads() {
    return this._cached('leads', () => readJSON(path.join(DATA_DIR, 'leads.json'), []));
  }

  getWhatsAppHistory() {
    return this._cached('whatsapp-history', () => readJSON(path.join(DATA_DIR, 'whatsapp-history.json'), { messages: [] }));
  }

  getLunaBuffer() {
    return this._cached('luna-buffer', () => readJSON(path.join(DATA_DIR, 'luna-buffer.json'), { newTasks: [], newTasksDone: [], newLeads: [], newLinks: [], newFinance: [], newMessages: [] }));
  }

  getOpsState() {
    return this._cached('ops-state', () => readJSON(path.join(DATA_DIR, 'ops-state.json'), {}));
  }

  getLinksIndex() {
    return this._cached('links-index', () => readJSON(path.join(DATA_DIR, 'links-index.json'), []));
  }

  getPayments() {
    return this._cached('payments', () => readJSON(path.join(DATA_DIR, 'payments.json'), []));
  }

  getQuotes() {
    return this._cached('quotes', () => readJSON(path.join(DATA_DIR, 'quotes.json'), { quotes: [] }));
  }

  // ── QUERIES INTELIGENTES ──

  /**
   * Busca tarefas com filtros opcionais
   */
  queryTasks(filters = {}) {
    const tasks = this.getTasks();
    const all = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
    return all.filter(t => {
      if (filters.status && t.status !== filters.status) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.assignee && t.assignee !== filters.assignee) return false;
      if (filters.project && t.project !== filters.project) return false;
      if (filters.overdue === true) {
        const due = t.dueDate ? new Date(t.dueDate) : null;
        if (!due || due > new Date()) return false;
      }
      return true;
    });
  }

  /**
   * Status completo de um projeto
   */
  getProjectStatus(projectIdOrCodename) {
    const projects = this.getProjectsRegistry();
    const project = Object.values(projects.projects || {}).find(p =>
      p.id === projectIdOrCodename ||
      p.codename === projectIdOrCodename ||
      p.name?.toLowerCase() === projectIdOrCodename.toLowerCase()
    );
    if (!project) return null;

    // Buscar tarefas relacionadas
    const tasks = this.queryTasks({ project: project.id });
    const openTasks = tasks.filter(t => t.status !== 'concluido' && t.status !== 'done');
    const overdueTasks = openTasks.filter(t => {
      const due = t.dueDate ? new Date(t.dueDate) : null;
      return due && due < new Date();
    });

    // Buscar financeiro
    const cashBox = this.getCashBox();
    const projectTransactions = (cashBox.transactions || []).filter(tx =>
      tx.project === project.id ||
      tx.description?.toLowerCase().includes(project.codename?.toLowerCase()) ||
      tx.description?.toLowerCase().includes(project.name?.toLowerCase())
    );

    // Buscar última menção no WhatsApp
    const history = this.getWhatsAppHistory();
    const mentions = (history.messages || []).filter(m =>
      (m.body || '').toLowerCase().includes(project.codename?.toLowerCase()) ||
      (m.body || '').toLowerCase().includes(project.name?.toLowerCase())
    );
    const lastMention = mentions.length > 0 ? mentions[mentions.length - 1] : null;

    // Calcular progresso baseado nos milestones
    const milestones = project.milestones || [];
    const doneMilestones = milestones.filter(m => m.done);
    const progress = milestones.length > 0 ? Math.round((doneMilestones.length / milestones.length) * 100) : 0;

    return {
      project,
      progress,
      tasks: {
        total: tasks.length,
        open: openTasks.length,
        overdue: overdueTasks.length,
        list: tasks.slice(0, 10)
      },
      financial: {
        transactions: projectTransactions,
        totalIn: projectTransactions.filter(t => t.type === 'income' || t.amount > 0).reduce((s, t) => s + Math.abs(t.amount || 0), 0),
        totalOut: projectTransactions.filter(t => t.type === 'expense' || t.amount < 0).reduce((s, t) => s + Math.abs(t.amount || 0), 0),
        status: project.financial?.paymentStatus || 'unknown'
      },
      communication: {
        lastMention: lastMention ? {
          body: lastMention.body?.slice(0, 100),
          author: lastMention.author || lastMention.pushname,
          date: lastMention.timestamp
        } : null,
        mentionCount: mentions.length
      }
    };
  }

  /**
   * Status completo de um cliente
   */
  getClientStatus(clientIdOrName) {
    const registry = this.getClientsRegistry();
    const client = Object.values(registry.clients || {}).find(c =>
      c.id === clientIdOrName ||
      c.name?.toLowerCase() === clientIdOrName.toLowerCase() ||
      c.company?.toLowerCase() === clientIdOrName.toLowerCase()
    );
    if (!client) return null;

    // Buscar projeto do cliente
    const projects = this.getProjectsRegistry();
    const project = Object.values(projects.projects || {}).find(p => p.clientId === client.id);

    // Buscar transações financeiras
    const cashBox = this.getCashBox();
    const clientTransactions = (cashBox.transactions || []).filter(tx =>
      tx.clientId === client.id ||
      tx.description?.toLowerCase().includes(client.name?.toLowerCase()) ||
      tx.description?.toLowerCase().includes(client.company?.toLowerCase())
    );

    // Buscar mensagens
    const history = this.getWhatsAppHistory();
    const messages = (history.messages || []).filter(m =>
      (m.body || '').toLowerCase().includes(client.name?.toLowerCase()) ||
      (m.body || '').toLowerCase().includes(client.company?.toLowerCase())
    );

    return {
      client,
      project: project ? this.getProjectStatus(project.id) : null,
      financial: {
        transactions: clientTransactions,
        totalPaid: clientTransactions.filter(t => t.type === 'income' || t.amount > 0).reduce((s, t) => s + Math.abs(t.amount || 0), 0),
        totalPending: (client.financial?.totalValue || 0) - clientTransactions.filter(t => t.type === 'income' || t.amount > 0).reduce((s, t) => s + Math.abs(t.amount || 0), 0)
      },
      communication: {
        messageCount: messages.length,
        lastMessage: messages.length > 0 ? messages[messages.length - 1] : null
      }
    };
  }

  /**
   * Resumo financeiro
   */
  getFinancialSummary(filters = {}) {
    const cashBox = this.getCashBox();
    const allTransactions = [
      ...(cashBox.incomingPayments || []),
      ...(cashBox.outgoingExpenses || []),
      ...(cashBox.history || [])
    ];
    const transactions = allTransactions.filter(tx => {
      if (filters.type && tx.type !== filters.type) return false;
      const txDate = tx.date || tx.timestamp || tx.createdAt;
      if (filters.startDate && txDate && new Date(txDate) < new Date(filters.startDate)) return false;
      if (filters.endDate && txDate && new Date(txDate) > new Date(filters.endDate)) return false;
      return true;
    });

    const income = (cashBox.incomingPayments || []).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const expense = (cashBox.outgoingExpenses || []).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    return {
      transactions: transactions.slice(0, 50),
      count: transactions.length,
      income,
      expense,
      balance: income - expense,
      pendingPayments: transactions.filter(t => t.status === 'pendente' || t.status === 'pending').length
    };
  }

  /**
   * Pipeline de leads
   */
  getLeadPipeline() {
    const leads = this.getLeads();
    const all = Array.isArray(leads) ? leads : (leads.leads || []);
    const stages = {};
    for (const lead of all) {
      const stage = lead.stage || lead.status || 'novo';
      if (!stages[stage]) stages[stage] = [];
      stages[stage].push(lead);
    }
    return {
      total: all.length,
      stages,
      hot: all.filter(l => /quente|hot|urgente/i.test(l.stage || l.status || '')),
      cold: all.filter(l => /frio|cold|arquivado/i.test(l.stage || l.status || ''))
    };
  }

  /**
   * Resumo do dia — o que está acontecendo AGORA
   */
  getDailyDigest() {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = this.queryTasks({});
    const overdue = tasks.filter(t => {
      const due = t.dueDate ? new Date(t.dueDate) : null;
      return due && due < new Date() && t.status !== 'concluido' && t.status !== 'done';
    });
    const p0 = tasks.filter(t => t.priority === 'P0');
    const p1 = tasks.filter(t => t.priority === 'P1');

    const financial = this.getFinancialSummary({ startDate: today });
    const leads = this.getLeadPipeline();

    const history = this.getWhatsAppHistory();
    const todayMessages = (history.messages || []).filter(m => {
      const msgDate = m.timestamp ? m.timestamp.slice(0, 10) : null;
      return msgDate === today;
    });

    return {
      date: today,
      tasks: { total: tasks.length, p0: p0.length, p1: p1.length, overdue: overdue.length },
      financial,
      leads: { total: leads.total, hot: leads.hot.length },
      messages: { today: todayMessages.length },
      alerts: [
        ...(overdue.length > 0 ? [`${overdue.length} tarefa(s) atrasada(s)`] : []),
        ...(p0.length > 0 ? [`${p0.length} tarefa(s) P0`]: []),
        ...(leads.hot.length > 0 ? [`${leads.hot.length} lead(s) quente(s)`] : [])
      ]
    };
  }

  /**
   * Busca semântica simples (por enquanto keyword-based, depois embedding)
   */
  search(query, limit = 20) {
    const lower = query.toLowerCase();
    const results = [];

    // Buscar em tarefas
    const tasks = this.queryTasks({});
    for (const t of tasks) {
      const text = `${t.title || ''} ${t.body || ''} ${t.description || ''}`.toLowerCase();
      if (text.includes(lower)) results.push({ type: 'task', data: t, relevance: 1 });
    }

    // Buscar em mensagens
    const history = this.getWhatsAppHistory();
    for (const m of (history.messages || []).slice(-500)) {
      if ((m.body || '').toLowerCase().includes(lower)) {
        results.push({ type: 'message', data: m, relevance: 0.8 });
      }
    }

    // Buscar em transações
    const cashBox = this.getCashBox();
    for (const tx of (cashBox.transactions || [])) {
      if ((tx.description || '').toLowerCase().includes(lower)) {
        results.push({ type: 'transaction', data: tx, relevance: 0.7 });
      }
    }

    return results.slice(0, limit);
  }
}

module.exports = { LunaDataAPI };
