/**
 * ═════════════════════════════════════════════════════════════════════════════
 * Action Preview Service — NEXO Dashboard PRO
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Gera previews contextuais para ações da Luna.
 * Mostra EXATAMENTE o que será afetado antes de executar.
 *
 * Para exclusões: busca o item real no JSON e mostra dados
 * Para criações: mostra os dados que serão criados
 * Para atualizações: mostra before/after
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ações que são destrutivas (apagar, excluir, remover)
const DESTRUCTIVE_ACTIONS = [
  'excluir_tarefa', 'excluir_lead', 'excluir_pagamento', 'excluir_despesa',
  'excluir_projeto', 'excluir_ideia', 'excluir_cliente', 'excluir_orcamento',
  'excluir_link', 'excluir_relatorio_bug', 'excluir_alerta_operacao',
  'excluir_notificacao',
];

// Ações que requerem role Admin
const ADMIN_ONLY_ACTIONS = [
  'excluir_tarefa', 'excluir_lead', 'excluir_pagamento', 'excluir_despesa',
  'excluir_projeto', 'excluir_ideia', 'excluir_cliente', 'excluir_orcamento',
  'excluir_link', 'excluir_relatorio_bug', 'excluir_alerta_operacao',
  'atualizar_config_seguranca', 'controlar_servico',
];

// Mapeia tipo de ação → arquivo JSON e campo ID
const ENTITY_MAP = {
  excluir_tarefa: { file: 'tasks.json', idField: 'id', nameField: 'title', extraFields: ['status', 'priority', 'assignedTo'], fallbackFile: 'company-tasks.json' },
  excluir_lead: { file: 'leads.json', idField: 'id', nameField: 'name', extraFields: ['email', 'pipelineStatus'] },
  excluir_pagamento: { file: 'payments.json', idField: 'id', nameField: 'client', extraFields: ['amount', 'date'] },
  excluir_despesa: { file: 'expenses.json', idField: 'id', nameField: 'name', extraFields: ['amount', 'category'] },
  excluir_projeto: { file: 'workspace-index.json', idField: 'id', nameField: 'name', extraFields: ['client'], isNested: 'clients' },
  excluir_ideia: { file: 'ideas.json', idField: 'id', nameField: 'body', extraFields: ['author'] },
  excluir_cliente: { file: 'workspace-index.json', idField: 'id', nameField: 'name', extraFields: ['email'], isNested: 'clients' },
  excluir_orcamento: { file: 'quotes.json', idField: 'id', nameField: 'clientName', extraFields: ['totalAmount', 'status'] },
  excluir_link: { file: 'links-index.json', idField: 'id', nameField: 'title', extraFields: ['url'], isNested: 'links' },
};

function readJson(filePath, defaultValue = []) {
  try {
    const fullPath = path.join(DATA_DIR, filePath);
    if (!fs.existsSync(fullPath)) return defaultValue;
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    // Se for um objeto com array aninhado (ex: workspace-index.json → clients)
    if (defaultValue === null) return data;
    return Array.isArray(data) ? data : (data.items || data.clients || data.links || []);
  } catch (e) {
    return defaultValue;
  }
}

function formatValue(key, value) {
  if (value === null || value === undefined) return '—';
  if (key === 'amount' || key === 'totalAmount') return `€${parseFloat(value).toFixed(2)}`;
  if (key === 'date') return new Date(value).toLocaleDateString('pt-BR');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 50);
  return String(value);
}

async function findItem(actionType, params, dataStore = null) {
  const config = ENTITY_MAP[actionType];
  if (!config) return null;

  let items = [];

  // Se tem dataStore, busca primeiro na fonte primária (PostgreSQL)
  if (dataStore) {
    try {
      if (actionType === 'excluir_tarefa') {
        items = await dataStore.getTasks();
      } else if (actionType === 'excluir_lead') {
        items = await dataStore.getLeads();
      } else if (actionType === 'excluir_pagamento') {
        const cash = await dataStore.getCashBox();
        items = cash?.history?.filter(h => h.type === 'income') || [];
      } else if (actionType === 'excluir_despesa') {
        const cash = await dataStore.getCashBox();
        items = cash?.history?.filter(h => h.type === 'expense') || [];
      }
    } catch (e) {
      // Falha silenciosa, cai no JSON fallback
    }
  }

  // Se não encontrou no dataStore, busca no JSON
  if (!items || items.length === 0) {
    items = readJson(config.file);
    if (config.isNested && !Array.isArray(items)) {
      items = items[config.isNested] || [];
    }
  }

  // Tenta encontrar por ID
  let item = null;
  const searchId = params.id || params[config.idField];
  const searchName = params.nome || params.name || params.titulo || params.title || params[config.nameField];

  if (searchId) {
    item = items.find(i => String(i[config.idField]) === String(searchId));
  }
  if (!item && searchName) {
    item = items.find(i => String(i[config.nameField]).toLowerCase().includes(String(searchName).toLowerCase()));
  }

  // Se não encontrou e tem fallbackFile, tenta lá
  if (!item && config.fallbackFile) {
    let fallbackItems = readJson(config.fallbackFile);
    if (config.isNested && !Array.isArray(fallbackItems)) {
      fallbackItems = fallbackItems[config.isNested] || [];
    }
    if (searchId) {
      item = fallbackItems.find(i => String(i[config.idField]) === String(searchId));
    }
    if (!item && searchName) {
      item = fallbackItems.find(i => String(i[config.nameField]).toLowerCase().includes(String(searchName).toLowerCase()));
    }
  }

  return { item, config };
}

async function buildAffectedItem(actionType, params, dataStore) {
  const found = await findItem(actionType, params, dataStore);
  if (!found || !found.item) {
    // Se não encontrou o item, retorna o que foi passado nos params
    const label = params.titulo || params.title || params.nome || params.name || params.id || 'Item desconhecido';
    return { id: params.id || 'unknown', label, detail: 'Não encontrado no banco de dados' };
  }

  const { item, config } = found;
  const label = item[config.nameField] || 'Sem nome';
  const details = config.extraFields
    .filter(f => item[f] !== undefined)
    .map(f => `${f}: ${formatValue(f, item[f])}`)
    .join(' | ');

  return { id: item[config.idField], label, detail: details };
}

function getIntentFromAction(actionType) {
  const mapping = {
    excluir_tarefa: 'tarefa.deletar',
    excluir_lead: 'lead.deletar',
    excluir_pagamento: 'financeiro.excluir_pagamento',
    excluir_despesa: 'financeiro.excluir_despesa',
    excluir_projeto: 'projeto.deletar',
    excluir_ideia: 'ideia.deletar',
    excluir_cliente: 'cliente.deletar',
    excluir_orcamento: 'orcamento.deletar',
    excluir_link: 'link.excluir',
    criar_tarefa: 'tarefa.criar',
    criar_lead: 'lead.criar',
    registrar_pagamento: 'financeiro.adicionar_receita',
    registrar_despesa: 'financeiro.adicionar_despesa',
    criar_orcamento: 'orcamento.criar',
    criar_projeto: 'projeto.criar',
    criar_ideia: 'ideia.criar',
    enviar_email: 'email.enviar',
    enviar_mensagem_whatsapp: 'whatsapp.enviar_mensagem',
    atualizar_tarefa: 'tarefa.atualizar',
    atualizar_lead: 'lead.atualizar_status',
    converter_lead: 'lead.converter',
  };
  return mapping[actionType] || 'default';
}

async function buildPreview(action, userRole = 'Admin', dataStore = null) {
  const { type, params = {} } = action;

  const isDestructive = DESTRUCTIVE_ACTIONS.includes(type);
  const requiresAdmin = ADMIN_ONLY_ACTIONS.includes(type);

  // Verifica permissão
  if (requiresAdmin && userRole !== 'Admin') {
    return {
      allowed: false,
      reason: 'Esta ação requer permissão de Administrador.',
      intent: getIntentFromAction(type),
      values: params,
      affectedItems: [],
      isDestructive,
      requiresAdmin,
    };
  }

  // Para ações destrutivas, busca o item real
  const affectedItems = [];
  if (isDestructive && ENTITY_MAP[type]) {
    affectedItems.push(await buildAffectedItem(type, params, dataStore));
  }

  // Para criações, formata os valores
  const values = { ...params };
  if (type === 'criar_tarefa') {
    values._preview = `Tarefa: "${params.titulo || 'sem título'}"${params.responsavel ? ` → ${params.responsavel}` : ''}`;
  } else if (type === 'criar_lead') {
    values._preview = `Lead: "${params.nome || 'sem nome'}"${params.email ? ` (${params.email})` : ''}`;
  } else if (type === 'registrar_pagamento') {
    values._preview = `Pagamento: €${params.valor || '?'} de ${params.de || 'cliente'}`;
  } else if (type === 'registrar_despesa') {
    values._preview = `Despesa: €${params.valor || '?'} para ${params.para || 'fornecedor'}`;
  } else if (type === 'enviar_email') {
    values._preview = `Email para: ${params.para || params.to || 'desconhecido'}`;
  }

  return {
    allowed: true,
    intent: getIntentFromAction(type),
    values,
    affectedItems,
    isDestructive,
    requiresAdmin,
  };
}

async function buildPreviewForActions(actions, userRole = 'Admin', dataStore = null) {
  const previews = [];
  for (const action of actions) {
    previews.push(await buildPreview(action, userRole, dataStore));
  }

  const hasBlocked = previews.some(p => !p.allowed);
  const blockedReasons = previews.filter(p => !p.allowed).map(p => p.reason);

  return {
    allowed: !hasBlocked,
    reasons: blockedReasons,
    previews,
    isDestructive: previews.some(p => p.isDestructive),
    requiresAdmin: previews.some(p => p.requiresAdmin),
  };
}

module.exports = {
  buildPreview,
  buildPreviewForActions,
  DESTRUCTIVE_ACTIONS,
  ADMIN_ONLY_ACTIONS,
};
