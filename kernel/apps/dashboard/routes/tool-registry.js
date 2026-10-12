/**
 * Tool Registry API v1.0
 * Expõe ações do NEXO Dashboard como "tools" para a Kimi Central.
 * Cada tool tem: nome, descrição, schema de parâmetros, e função de execução.
 */

const express = require('express');
const router = express.Router();
const dataStore = require('../datastore-pg');

// ============================================================
// TOOL DEFINITIONS
// ============================================================

const TOOLS = {
  // ── Tarefas ──
  listTasks: {
    description: 'Lista tarefas do dashboard com filtros opcionais. Retorna cada tarefa com ID e título para referência.',
    parameters: {
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'archived'], optional: true },
      assignedTo: { type: 'string', optional: true },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'P0', 'P1', 'P2'], optional: true },
      limit: { type: 'number', default: 10, optional: true }
    },
    execute: async (params) => {
      let tasks = await dataStore.getTasks();
      if (params.status) tasks = tasks.filter(t => t.status === params.status);
      if (params.assignedTo) tasks = tasks.filter(t => t.assignedTo === params.assignedTo);
      if (params.priority) tasks = tasks.filter(t => t.priority === params.priority);
      const formattedTasks = tasks.slice(0, params.limit || 10).map(t => ({
        id: t.id,
        title: t.title,
        display: `ID: ${t.id} | Título: ${t.title}`,
        status: t.status,
        priority: t.priority,
        assignedTo: t.assignedTo
      }));
      return { success: true, count: formattedTasks.length, tasks: formattedTasks };
    }
  },

  createTask: {
    description: 'Cria uma nova tarefa no dashboard',
    parameters: {
      title: { type: 'string', required: true },
      description: { type: 'string', optional: true },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], default: 'pending', optional: true },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'P0', 'P1', 'P2'], default: 'medium', optional: true },
      dueDate: { type: 'string', format: 'YYYY-MM-DD', optional: true },
      assignedTo: { type: 'string', optional: true }
    },
    execute: async (params) => {
      const task = {
        id: Date.now().toString(),
        title: params.title.trim(),
        description: params.description?.trim() || '',
        status: params.status || 'pending',
        priority: params.priority || 'medium',
        dueDate: params.dueDate || null,
        assignedTo: params.assignedTo || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await dataStore.saveTask(task);
      return { success: true, task };
    }
  },

  updateTask: {
    description: 'Atualiza uma tarefa existente. Use listTasks para obter o ID (formato: ID: X | Título: Y).',
    parameters: {
      id: { type: 'string', required: true },
      title: { type: 'string', optional: true },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'archived'], optional: true },
      priority: { type: 'string', optional: true },
      dueDate: { type: 'string', optional: true },
      assignedTo: { type: 'string', optional: true }
    },
    execute: async (params) => {
      const tasks = await dataStore.getTasks();
      const existing = tasks.find(t => t.id === params.id);
      if (!existing) return { success: false, error: 'Tarefa não encontrada' };
      const updated = { ...existing, ...params, updatedAt: new Date().toISOString() };
      await dataStore.saveTask(updated);
      return { success: true, task: updated };
    }
  },

  deleteTask: {
    description: 'Deleta uma tarefa pelo ID. ⚠️ Ação irreversível. Use listTasks para ver o ID de cada tarefa (formato: ID: X | Título: Y).',
    parameters: {
      id: { type: 'string', required: true }
    },
    execute: async (params) => {
      await dataStore.deleteTask(params.id);
      return { success: true, message: 'Tarefa deletada' };
    }
  },

  completeTaskByTitle: {
    description: 'Conclui uma tarefa buscando pelo título (fuzzy match)',
    parameters: {
      title: { type: 'string', required: true }
    },
    execute: async (params) => {
      const tasks = await dataStore.getTasks();
      const search = params.title.toLowerCase().trim();
      const task = tasks.find(t => t.title.toLowerCase().includes(search));
      if (!task) return { success: false, error: `Tarefa "${params.title}" não encontrada` };
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      await dataStore.saveTask(task);
      return { success: true, task };
    }
  },

  // ── Leads ──
  listLeads: {
    description: 'Lista leads do CRM. Retorna cada lead com ID e nome para referência.',
    parameters: {
      status: { type: 'string', optional: true },
      limit: { type: 'number', default: 10, optional: true }
    },
    execute: async (params) => {
      const leadsData = await dataStore.getLeads();
      let leads = leadsData?.leads || [];
      if (params.status) leads = leads.filter(l => l.status === params.status);
      const formattedLeads = leads.slice(0, params.limit || 10).map(l => ({
        id: l.id,
        name: l.name,
        display: `ID: ${l.id} | Nome: ${l.name}`,
        status: l.status,
        email: l.email,
        phone: l.phone
      }));
      return { success: true, count: formattedLeads.length, leads: formattedLeads };
    }
  },

  createLead: {
    description: 'Cria um novo lead no CRM',
    parameters: {
      name: { type: 'string', required: true },
      email: { type: 'string', optional: true },
      phone: { type: 'string', optional: true },
      source: { type: 'string', optional: true },
      notes: { type: 'string', optional: true }
    },
    execute: async (params) => {
      const lead = {
        id: Date.now().toString(),
        name: params.name.trim(),
        email: params.email?.trim() || '',
        phone: params.phone?.trim() || '',
        source: params.source?.trim() || 'manual',
        notes: params.notes?.trim() || '',
        status: 'new',
        createdAt: new Date().toISOString()
      };
      await dataStore.saveLead(lead);
      return { success: true, lead };
    }
  },

  updateLead: {
    description: 'Atualiza um lead existente. Use listLeads para obter o ID (formato: ID: X | Nome: Y).',
    parameters: {
      id: { type: 'string', required: true },
      status: { type: 'string', optional: true },
      notes: { type: 'string', optional: true }
    },
    execute: async (params) => {
      const leadsData = await dataStore.getLeads();
      const leads = leadsData?.leads || [];
      const existing = leads.find(l => l.id === params.id);
      if (!existing) return { success: false, error: 'Lead não encontrado' };
      const updated = { ...existing, ...params, updatedAt: new Date().toISOString() };
      await dataStore.saveLead(updated);
      return { success: true, lead: updated };
    }
  },

  deleteLead: {
    description: 'Deleta um lead pelo ID. ⚠️ Ação irreversível. Use listLeads para ver o ID de cada lead (formato: ID: X | Nome: Y).',
    parameters: {
      id: { type: 'string', required: true }
    },
    execute: async (params) => {
      await dataStore.deleteLead(params.id);
      return { success: true, message: 'Lead deletado' };
    }
  },

  // ── Financeiro ──
  getFinanceSummary: {
    description: 'Retorna resumo financeiro do dashboard',
    parameters: {},
    execute: async () => {
      const payments = await dataStore.getPayments();
      const expenses = await dataStore.getExpenses();
      const totalExpected = payments.reduce((s, p) => s + (p.amount || 0), 0);
      const totalReceived = payments.filter(p => p.status === 'received').reduce((s, p) => s + (p.amount || 0), 0);
      const totalPending = totalExpected - totalReceived;
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      return {
        success: true,
        summary: {
          totalExpected,
          totalReceived,
          totalPending,
          totalExpenses,
          netBalance: totalReceived - totalExpenses
        }
      };
    }
  },

  createPayment: {
    description: 'Registra um pagamento/receita',
    parameters: {
      amount: { type: 'number', required: true },
      from: { type: 'string', required: true },
      description: { type: 'string', optional: true },
      date: { type: 'string', format: 'YYYY-MM-DD', optional: true }
    },
    execute: async (params) => {
      const payment = {
        id: Date.now().toString(),
        amount: parseFloat(params.amount),
        from: params.from.trim(),
        description: params.description?.trim() || '',
        date: params.date || new Date().toISOString().slice(0, 10),
        status: 'received',
        createdAt: new Date().toISOString()
      };
      await dataStore.savePayment(payment);
      return { success: true, payment };
    }
  },

  createExpense: {
    description: 'Registra uma despesa',
    parameters: {
      amount: { type: 'number', required: true },
      to: { type: 'string', required: true },
      description: { type: 'string', optional: true },
      date: { type: 'string', format: 'YYYY-MM-DD', optional: true }
    },
    execute: async (params) => {
      const expense = {
        id: Date.now().toString(),
        amount: parseFloat(params.amount),
        to: params.to.trim(),
        description: params.description?.trim() || '',
        date: params.date || new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      };
      await dataStore.saveExpense(expense);
      return { success: true, expense };
    }
  },

  // ── Ideias ──
  listIdeas: {
    description: 'Lista ideias do dashboard. Retorna cada ideia com ID e título para referência.',
    parameters: {
      limit: { type: 'number', default: 10, optional: true }
    },
    execute: async (params) => {
      const ideasData = await dataStore.getIdeas();
      const ideas = ideasData?.ideas ? Object.values(ideasData.ideas) : [];
      const formattedIdeas = ideas.slice(0, params.limit || 10).map(i => ({
        id: i.id,
        title: i.title,
        display: `ID: ${i.id} | Título: ${i.title}`,
        status: i.status
      }));
      return { success: true, count: formattedIdeas.length, ideas: formattedIdeas };
    }
  },

  createIdea: {
    description: 'Cria uma nova ideia',
    parameters: {
      title: { type: 'string', required: true },
      body: { type: 'string', optional: true }
    },
    execute: async (params) => {
      const idea = {
        id: Date.now().toString(),
        title: params.title.trim(),
        body: params.body?.trim() || '',
        status: 'rascunho',
        createdAt: new Date().toISOString()
      };
      await dataStore.saveIdea(idea);
      return { success: true, idea };
    }
  },

  // ── Status Geral ──
  getDashboardStatus: {
    description: 'Retorna status geral do dashboard (tarefas, leads, financeiro)',
    parameters: {},
    execute: async () => {
      const [tasks, leadsData, payments, expenses] = await Promise.all([
        dataStore.getTasks(),
        dataStore.getLeads(),
        dataStore.getPayments(),
        dataStore.getExpenses()
      ]);
      const leads = leadsData?.leads || [];
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const p0Tasks = tasks.filter(t => t.priority === 'P0' && t.status !== 'completed').length;
      const totalReceived = payments.filter(p => p.status === 'received').reduce((s, p) => s + (p.amount || 0), 0);
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      return {
        success: true,
        status: {
          tasks: { total: tasks.length, pending: pendingTasks, p0: p0Tasks },
          leads: { total: leads.length, new: leads.filter(l => l.status === 'new').length },
          finance: { received: totalReceived, expenses: totalExpenses, balance: totalReceived - totalExpenses }
        }
      };
    }
  }
};

// ============================================================
// ROUTES
// ============================================================

// GET /api/tools — Lista todas as tools disponíveis (sem executar)
router.get('/', (req, res) => {
  const definitions = Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
  }));
  res.json({ success: true, tools: definitions });
});

// POST /api/tools/execute — Executa uma tool específica
router.post('/execute', async (req, res) => {
  try {
    const { tool: toolName, params = {} } = req.body;

    if (!toolName) {
      return res.status(400).json({ success: false, error: 'Nome da tool é obrigatório' });
    }

    const tool = TOOLS[toolName];
    if (!tool) {
      return res.status(404).json({ success: false, error: `Tool "${toolName}" não encontrada` });
    }

    // Validate required parameters
    for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
      if (paramDef.required && (params[paramName] === undefined || params[paramName] === null)) {
        return res.status(400).json({
          success: false,
          error: `Parâmetro obrigatório ausente: "${paramName}"`
        });
      }
    }

    // Execute
    const result = await tool.execute(params);
    res.json({ success: true, tool: toolName, result });

  } catch (err) {
    console.error('[ToolRegistry] Erro ao executar tool:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tools/execute-batch — Executa múltiplas tools em sequência
router.post('/execute-batch', async (req, res) => {
  try {
    const { calls = [] } = req.body;
    const results = [];

    for (const call of calls) {
      const tool = TOOLS[call.tool];
      if (!tool) {
        results.push({ tool: call.tool, success: false, error: 'Tool não encontrada' });
        continue;
      }
      try {
        const result = await tool.execute(call.params || {});
        results.push({ tool: call.tool, success: true, result });
      } catch (err) {
        results.push({ tool: call.tool, success: false, error: err.message });
      }
    }

    res.json({ success: true, results });

  } catch (err) {
    console.error('[ToolRegistry] Erro em batch:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
