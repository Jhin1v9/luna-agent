/**
 * Dashboard Tool Registry v1.0
 *
 * Centralizes all Dashboard Pro tools available to the Telegram mode of LUNA.
 * To add a new dashboard tool, edit this file only.
 */

'use strict';

const DASHBOARD_TOOL_REGISTRY = {
  tarefas: {
    label: 'Tarefas',
    emoji: '📝',
    description: 'Gerenciamento de tarefas e acompanhamento de atividades.',
    tools: [
      {
        name: 'dashboardListTasks',
        description: 'Lista tarefas do dashboard com filtros opcionais.',
        params: ['status', 'assignee', 'priority'],
      },
      {
        name: 'dashboardCreateTask',
        description: 'Cria uma nova tarefa no dashboard.',
        params: ['title', 'description', 'status', 'priority', 'assignee', 'dueDate'],
      },
      {
        name: 'dashboardUpdateTask',
        description: 'Atualiza os dados de uma tarefa existente.',
        params: ['taskId', 'title', 'description', 'status', 'priority', 'projectId', 'assignedTo', 'dueDate'],
      },
      {
        name: 'dashboardCompleteTask',
        description: 'Marca uma tarefa como concluída.',
        params: ['id'],
      },
      {
        name: 'dashboardDeleteTask',
        description: 'Remove uma tarefa do dashboard.',
        params: ['id'],
      },
      {
        name: 'dashboardAddComment',
        description: 'Adiciona um comentário a uma tarefa.',
        params: ['id', 'comment'],
      },
    ],
  },

  leads: {
    label: 'Leads',
    emoji: '💼',
    description: 'Cadastro, atualização e conversão de leads.',
    tools: [
      {
        name: 'dashboardListLeads',
        description: 'Lista leads cadastrados com filtros opcionais.',
        params: ['status', 'assignedTo', 'search'],
      },
      {
        name: 'dashboardCreateLead',
        description: 'Cria um novo lead no dashboard.',
        params: ['name', 'email', 'phone', 'source', 'estimatedValue', 'notes', 'assignedTo', 'tags'],
      },
      {
        name: 'dashboardUpdateLead',
        description: 'Atualiza os dados de um lead existente.',
        params: ['id', 'name', 'email', 'phone', 'status', 'estimatedValue', 'assignedTo', 'notes'],
      },
      {
        name: 'dashboardConvertLead',
        description: 'Converte um lead em cliente.',
        params: ['id'],
      },
      {
        name: 'dashboardDeleteLead',
        description: 'Remove um lead do dashboard.',
        params: ['id'],
      },
    ],
  },

  financeiro: {
    label: 'Financeiro',
    emoji: '💰',
    description: 'Resumo financeiro, pagamentos e divisão de receitas.',
    tools: [
      {
        name: 'dashboardGetFinanceSummary',
        description: 'Retorna o resumo financeiro esperado, recebido, pendente e em atraso.',
        params: [],
      },
      {
        name: 'dashboardListPayments',
        description: 'Lista pagamentos/receitas cadastradas.',
        params: ['status', 'from'],
      },
      {
        name: 'dashboardCreatePayment',
        description: 'Registra um novo pagamento ou receita.',
        params: ['amount', 'description', 'from', 'date', 'status'],
      },
      {
        name: 'dashboardReceiveSplit',
        description: 'Marca uma parte de pagamento dividido como recebida.',
        params: ['id', 'personId'],
      },
    ],
  },

  despesas: {
    label: 'Despesas',
    emoji: '💸',
    description: 'Controle de despesas, pagamentos e categorização.',
    tools: [
      {
        name: 'dashboardListExpenses',
        description: 'Lista despesas com filtros de status e categoria.',
        params: ['status', 'category'],
      },
      {
        name: 'dashboardCreateExpense',
        description: 'Registra uma nova despesa.',
        params: ['amount', 'description', 'category', 'to', 'date', 'status', 'splitAmong'],
      },
      {
        name: 'dashboardUpdateExpense',
        description: 'Atualiza os dados de uma despesa existente.',
        params: ['id', 'amount', 'description', 'status', 'category'],
      },
      {
        name: 'dashboardDeleteExpense',
        description: 'Remove uma despesa do dashboard.',
        params: ['id'],
      },
      {
        name: 'dashboardPayExpense',
        description: 'Marca uma despesa como paga.',
        params: ['id'],
      },
    ],
  },

  caixa: {
    label: 'Caixa',
    emoji: '🏦',
    description: 'Gestão de caixa, histórico, reconciliação e projeções.',
    tools: [
      {
        name: 'dashboardGetCashBox',
        description: 'Retorna o saldo atual do caixa.',
        params: [],
      },
      {
        name: 'dashboardListCashHistory',
        description: 'Lista o histórico de movimentações do caixa.',
        params: ['limit'],
      },
      {
        name: 'dashboardAddCashEntry',
        description: 'Adiciona uma entrada ou saída de caixa.',
        params: ['type', 'amount', 'description', 'category', 'date'],
      },
      {
        name: 'dashboardReconcileCashBox',
        description: 'Reconcilia o caixa com um saldo real informado.',
        params: ['actualBalance'],
      },
      {
        name: 'dashboardAdjustCashBox',
        description: 'Ajusta o saldo do caixa manualmente.',
        params: ['amount', 'reason'],
      },
      {
        name: 'dashboardGetCashBoxProjection',
        description: 'Retorna a projeção financeira do caixa.',
        params: [],
      },
      {
        name: 'dashboardCreateCashPayment',
        description: 'Registra um pagamento direto no caixa.',
        params: ['amount', 'description', 'from'],
      },
    ],
  },

  projetos: {
    label: 'Projetos',
    emoji: '📊',
    description: 'Listagem de projetos e clientes.',
    tools: [
      {
        name: 'dashboardListProjects',
        description: 'Lista os projetos cadastrados no dashboard.',
        params: [],
      },
      {
        name: 'dashboardListClients',
        description: 'Lista os clientes cadastrados no dashboard.',
        params: [],
      },
    ],
  },

  roadmaps: {
    label: 'Roadmaps',
    emoji: '🎯',
    description: 'Roadmaps de projeto, fases e templates.',
    tools: [
      {
        name: 'dashboardListRoadmaps',
        description: 'Lista roadmaps com filtros opcionais.',
        params: ['status', 'clientId', 'projectType'],
      },
      {
        name: 'dashboardGetRoadmap',
        description: 'Retorna os detalhes de um roadmap específico.',
        params: ['id'],
      },
      {
        name: 'dashboardCreateRoadmap',
        description: 'Cria um novo roadmap de projeto.',
        params: [
          'title',
          'clientId',
          'leadId',
          'projectType',
          'totalValue',
          'currency',
          'startDate',
          'githubRepo',
          'subdomain',
          'onboardingAnswers',
        ],
      },
      {
        name: 'dashboardAdvanceRoadmapPhase',
        description: 'Avança para a próxima fase de um roadmap.',
        params: ['id', 'reason'],
      },
      {
        name: 'dashboardListProjectTypes',
        description: 'Lista os tipos de projeto disponíveis.',
        params: [],
      },
    ],
  },

  ideias: {
    label: 'Ideias',
    emoji: '💡',
    description: 'Brainstorm e gestão de ideias.',
    tools: [
      {
        name: 'dashboardListIdeas',
        description: 'Lista ideias com filtros opcionais.',
        params: ['status', 'type', 'priority', 'search', 'limit'],
      },
      {
        name: 'dashboardCreateIdea',
        description: 'Cria uma nova ideia no dashboard.',
        params: ['title', 'type', 'priority', 'status', 'tags', 'description'],
      },
    ],
  },

  votacoes: {
    label: 'Votações',
    emoji: '🗳️',
    description: 'Sessões de votação para ações e decisões.',
    tools: [
      {
        name: 'dashboardListVotingSessions',
        description: 'Lista sessões de votação.',
        params: ['status', 'page', 'limit'],
      },
      {
        name: 'dashboardGetVotingSession',
        description: 'Retorna os detalhes de uma sessão de votação.',
        params: ['id'],
      },
      {
        name: 'dashboardCreateVotingSession',
        description: 'Cria uma nova sessão de votação.',
        params: ['title', 'description', 'type', 'quorumRequired', 'toolName', 'toolParams'],
      },
      {
        name: 'dashboardVoteInSession',
        description: 'Registra um voto em uma sessão de votação.',
        params: ['id', 'vote', 'comment'],
      },
      {
        name: 'dashboardDeleteVotingSession',
        description: 'Remove uma sessão de votação.',
        params: ['id'],
      },
    ],
  },

  historico: {
    label: 'Histórico',
    emoji: '🕒',
    description: 'Audit log, lixeira e restauração de alterações do dashboard.',
    tools: [
      {
        name: 'dashboardListRecentChanges',
        description: 'Lista as alterações recentes no dashboard (criações, atualizações, exclusões).',
        params: ['limit', 'entityType', 'action'],
      },
      {
        name: 'dashboardListTrash',
        description: 'Mostra a lixeira do dashboard com itens excluídos que podem ser restaurados.',
        params: ['limit', 'entityType'],
      },
      {
        name: 'dashboardUndoLastChange',
        description: 'Desfaz a última alteração feita pelo usuário no dashboard.',
        params: ['actor', 'actions'],
      },
      {
        name: 'dashboardRestoreItem',
        description: 'Restaura um item específico a partir do ID do histórico (audit log).',
        params: ['id', 'actor'],
      },
    ],
  },

  links: {
    label: 'Links',
    emoji: '🔗',
    description: 'Salvamento e listagem de links úteis.',
    tools: [
      {
        name: 'dashboardListLinks',
        description: 'Lista links salvos no dashboard.',
        params: ['platform', 'search'],
      },
      {
        name: 'dashboardAddLink',
        description: 'Adiciona um novo link ao dashboard.',
        params: ['url', 'title', 'description', 'tags'],
      },
    ],
  },

  cotacoes: {
    label: 'Cotações',
    emoji: '📄',
    description: 'Orçamentos e cotações para clientes.',
    tools: [
      {
        name: 'dashboardListQuotes',
        description: 'Lista orçamentos/cotações cadastradas.',
        params: [],
      },
      {
        name: 'dashboardCreateQuote',
        description: 'Cria uma nova cotação/orçamento.',
        params: ['clientName', 'projectName', 'totalAmount', 'description', 'status'],
      },
      {
        name: 'dashboardUpdateQuote',
        description: 'Atualiza uma cotação existente.',
        params: ['id', 'totalAmount', 'status', 'description'],
      },
      {
        name: 'dashboardDeleteQuote',
        description: 'Remove uma cotação do dashboard.',
        params: ['id'],
      },
    ],
  },
};

/**
 * Returns an array of category keys in registry order.
 * @returns {string[]}
 */
function getCategories() {
  return Object.keys(DASHBOARD_TOOL_REGISTRY);
}

/**
 * Returns the category object for the given key, or null if not found.
 * @param {string} category
 * @returns {object|null}
 */
function getCategory(category) {
  return DASHBOARD_TOOL_REGISTRY[category] || null;
}

/**
 * Returns the tools array for the given category, or an empty array.
 * @param {string} category
 * @returns {object[]}
 */
function getToolsForCategory(category) {
  return DASHBOARD_TOOL_REGISTRY[category]?.tools || [];
}

/**
 * Returns a flat array of all registered dashboard tool names.
 * @returns {string[]}
 */
function getAllToolNames() {
  return getCategories().flatMap((key) => getToolsForCategory(key).map((tool) => tool.name));
}

/**
 * Returns true if the provided name is a string starting with 'dashboard'
 * and exists in the registry.
 * @param {string} name
 * @returns {boolean}
 */
function isDashboardTool(name) {
  if (typeof name !== 'string' || !name.startsWith('dashboard')) return false;
  return getAllToolNames().includes(name);
}

Object.freeze(DASHBOARD_TOOL_REGISTRY);

module.exports = {
  DASHBOARD_TOOL_REGISTRY,
  getCategories,
  getCategory,
  getToolsForCategory,
  getAllToolNames,
  isDashboardTool,
};
