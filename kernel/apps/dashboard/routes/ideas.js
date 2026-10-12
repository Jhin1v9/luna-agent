const express = require('express');
const fs = require('fs');
const path = require('path');
const { genAI } = require('../services/gemini-client');

const router = express.Router();

// ============================================================================
// PATHS
// ============================================================================
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEMA_DIR = path.join(DATA_DIR, 'schema');
const IDEAS_FILE = path.join(DATA_DIR, 'ideas-registry.json');
const CLIENTS_FILE = path.join(SCHEMA_DIR, 'clients-registry.json');
const PROJECTS_FILE = path.join(SCHEMA_DIR, 'projects-registry.json');
const TASKS_FILE = path.join(DATA_DIR, 'company-tasks.json');

// ============================================================================
// GEMINI (via multi-key client)
// ============================================================================

// ============================================================================
// CONSTANTS
// ============================================================================
const VALID_STATUSES = [
  'rascunho', 'em-discussao', 'aprovada', 'rejeitada',
  'em-andamento', 'concluida', 'arquivada'
];

const VALID_TYPES = [
  'proposta-comercial', 'brainstorm', 'prd', 'pipeline-vendas',
  'estrategia', 'processo', 'marketing', 'outro', 'feature'
];

const TYPE_ALIASES = {
  'feature': 'brainstorm',
  'funcionalidade': 'brainstorm',
  'improvement': 'processo',
  'melhoria': 'processo',
  'bug': 'processo',
  'bugfix': 'processo',
};

const VALID_PRIORITIES = ['baixa', 'media', 'alta', 'urgente'];

const VALID_BLOCK_TYPES = [
  'paragraph', 'heading', 'checklist', 'image', 'embed',
  'callout', 'table', 'divider', 'quote'
];

const AI_MODES = ['brainstorm', 'estrategia', 'redator', 'precificacao', 'pesquisa'];

const USER_NAMES = {
  'nexo-abner-001': 'Abner',
  'nexo-enoque-001': 'Nonoke',
  'nexo-elias-pessoal': 'Elias',
  'abner': 'Abner',
  'nonoke': 'Nonoke',
  'elias': 'Elias'
};
const USER_IDS = Object.keys(USER_NAMES);

// ============================================================================
// HELPERS
// ============================================================================
const dataStore = require('../datastore-pg');

const _readJSON = (file, defaultValue = null) => {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    return JSON.parse(raw);
  } catch { return defaultValue; }
};

const _writeJSON = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Hybrid PG+JSON loader: ideas in PG, templates/categories in JSON
async function loadIdeasData() {
  const pgData = await dataStore.getIdeas();
  const jsonData = _readJSON(IDEAS_FILE, { ideas: {}, templates: {}, categories: {} });
  return {
    ideas: pgData.ideas || jsonData.ideas || {},
    templates: jsonData.templates || {},
    categories: jsonData.categories || {},
    _meta: jsonData._meta || { totalIdeas: Object.keys(pgData.ideas || {}).length, lastIdeaId: null }
  };
}

async function saveIdeasData(data) {
  const ideasData = data || await loadIdeasData();
  for (const idea of Object.values(ideasData.ideas || {})) {
    await dataStore.saveIdea(idea);
  }
  const jsonData = {
    templates: ideasData.templates || {},
    categories: ideasData.categories || {},
    _meta: ideasData._meta || {}
  };
  backupJSON(IDEAS_FILE);
  await _writeJSON(IDEAS_FILE, jsonData);
}

const readJSON = (file, defaultValue = null) => {
  if (file === IDEAS_FILE) {
    throw new Error('Use loadIdeasData() instead of readJSON(IDEAS_FILE)');
  }
  return _readJSON(file, defaultValue);
};

const writeJSON = (file, data) => {
  if (file === IDEAS_FILE) {
    throw new Error('Use saveIdeasData() instead of writeJSON(IDEAS_FILE)');
  }
  return _writeJSON(file, data);
};

const backupJSON = (file) => {
  try {
    const ts = Date.now();
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + '.backup-' + ts);
    }
  } catch (e) {
    console.error('[IDEAS] Backup error:', e.message);
  }
};

function getUserName(userId) {
  return USER_NAMES[userId] || 'Desconhecido';
}

function generateSequentialId(items, prefix) {
  const maxNum = items.reduce((max, item) => {
    const match = item.id && item.id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

function generateRandomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

function validateClient(clientId) {
  if (!clientId) return true;
  const clientsData = readJSON(CLIENTS_FILE, {});
  return !!(clientsData.data && clientsData.data[clientId]);
}

function validateProject(projectId) {
  if (!projectId) return true;
  const projectsData = readJSON(PROJECTS_FILE, {});
  return !!(projectsData.data && projectsData.data[projectId]);
}

// Merge profundo de arrays de blocos
function mergeBlocks(currentBlocks, newBlocks) {
  const blockMap = {};
  (currentBlocks || []).forEach(b => { if (b.id) blockMap[b.id] = b; });

  const merged = [];
  const processedIds = new Set();

  (newBlocks || []).forEach(newBlock => {
    if (newBlock.id && blockMap[newBlock.id]) {
      const mergedBlock = {
        ...blockMap[newBlock.id],
        ...newBlock,
        items: newBlock.items !== undefined ? newBlock.items : blockMap[newBlock.id].items
      };
      merged.push(mergedBlock);
    } else {
      merged.push(newBlock);
    }
    if (newBlock.id) processedIds.add(newBlock.id);
  });

  (currentBlocks || []).forEach(b => {
    if (b.id && !processedIds.has(b.id)) {
      merged.push(b);
    }
  });

  return merged;
}

function computeChangeSummary(oldBlocks, newBlocks) {
  const oldCount = (oldBlocks || []).length;
  const newCount = (newBlocks || []).length;
  if (newCount > oldCount) return `Adicionados ${newCount - oldCount} blocos`;
  if (newCount < oldCount) return `Removidos ${oldCount - newCount} blocos`;
  return 'Conteudo atualizado';
}

// Parse texto de sugestao em blocos
function parseSuggestionToBlocks(content, type) {
  const blocks = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Heading: linhas que comecam com #
    if (trimmed.match(/^#{1,3}\s+/)) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#{1,3}\s+/, '');
      blocks.push({
        id: generateRandomId('blk'),
        type: 'heading',
        level: Math.min(level, 3),
        content: text
      });
      continue;
    }

    // Checklist: linhas que comecam com - [ ] ou - [x]
    const chkMatch = trimmed.match(/^- \[([ x])\]\s*/);
    if (chkMatch) {
      const text = trimmed.replace(/^- \[[ x]\]\s*/, '');
      blocks.push({
        id: generateRandomId('blk'),
        type: 'checklist',
        content: text,
        items: [{
          id: generateRandomId('chk'),
          text: text,
          checked: false
        }]
      });
      continue;
    }

    // Bullet: linhas que comecam com - ou *
    if (trimmed.match(/^[-*]\s+/)) {
      const text = trimmed.replace(/^[-*]\s+/, '');
      blocks.push({
        id: generateRandomId('blk'),
        type: 'paragraph',
        content: `\u2022 ${text}`
      });
      continue;
    }

    // Numero: linhas que comecam com digito.
    if (trimmed.match(/^\d+\.\s+/)) {
      const num = trimmed.match(/^\d+/)[0];
      const text = trimmed.replace(/^\d+\.\s+/, '');
      blocks.push({
        id: generateRandomId('blk'),
        type: 'paragraph',
        content: `${num}. ${text}`
      });
      continue;
    }

    // Paragrafo padrao
    blocks.push({
      id: generateRandomId('blk'),
      type: 'paragraph',
      content: trimmed
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      id: generateRandomId('blk'),
      type: 'paragraph',
      content: content
    });
  }

  return blocks;
}

// ============================================================================
// PROMPT BUILDER
// ============================================================================
function buildBrainstormPrompt(idea, client, history, userQuestion, mode, allIdeasList, templatesList) {
  const modeInstructions = {
    brainstorm: 'Gere 3-5 ideias criativas e concretas. Use exemplos reais. Responda em ate 5 paragrafos curtos.',
    'estrategia': 'Analise como abordar/vender. Estruture em: Problema > Oportunidade > Solucao > Proximo Passo. Maximo 4 paragrafos.',
    'redator': 'Escreva proposta, email ou pitch pronto para usar. Texto direto, sem floreios. Maximo 300 palavras.',
    'precificacao': 'Sugira faixa de preco. NUNCA prometa valor exato. Explique o raciocinio em 2-3 paragrafos.',
    'pesquisa': 'Busque benchmarks e tendencias. Liste 3-5 achados com fontes quando possivel. Maximo 4 paragrafos.'
  };

  const contextoCliente = client
    ? `Nome: ${client.name || 'Nao informado'}\nEmpresa: ${client.company || 'Nao informado'}\nServicos: ${(client.services || []).join(', ') || 'Nenhum'}\nPipeline: ${client.pipeline || 'Novo'}`
    : 'Nenhum cliente vinculado.';

  const historicoIdeias = history && history.length > 0
    ? history.map(h => `- ${h.title} (${h.status}, ${h.type})`).join('\n')
    : 'Nenhuma ideia anterior.';

  const conteudoIdeia = (idea.content && idea.content.blocks)
    ? idea.content.blocks
        .filter(b => b.type === 'paragraph')
        .map(b => b.content)
        .join('\n')
    : (idea.blocks
        ? idea.blocks.filter(b => b.type === 'paragraph').map(b => b.content).join('\n')
        : 'Sem conteudo');

  // Lista de todas as ideias para contexto completo
  const todasIdeias = allIdeasList && allIdeasList.length > 0
    ? allIdeasList.slice(-20).map(i => `- ${i.id}: ${i.title} [${i.status}, ${i.type}, ${i.priority}]`).join('\n')
    : 'Nenhuma outra ideia no workspace.';

  // Templates disponiveis
  const templatesDisp = templatesList && templatesList.length > 0
    ? templatesList.map(t => `- ${t.id}: ${t.name} (${t.type || 'geral'})`).join('\n')
    : 'Nenhum template disponivel.';

  return `Voce e um assistente direto e pratico do workspace IDEIAS da NEXO Digital. NAO se apresente. NAO diga "Oi" ou "Sou o assistente". Va DIRETO ao ponto.

=== CONTEXTO DO CLIENTE ===
${contextoCliente}

=== IDEIA ATUAL ===
ID: ${idea.id}
Titulo: ${idea.title}
Status: ${idea.status}
Tipo: ${idea.type}
Prioridade: ${idea.priority}
Conteudo: ${conteudoIdeia}

=== HISTORICO DESTE CLIENTE ===
${historicoIdeias}

=== TODAS AS IDEIAS DO WORKSPACE ===
${todasIdeias}

=== TEMPLATES DISPONIVEIS ===
${templatesDisp}

=== MODO ATUAL ===
${mode.toUpperCase()}: ${modeInstructions[mode] || modeInstructions.brainstorm}

=== FERRAMENTAS DISPONIVEIS ===
Use-as quando o usuario pedir uma acao concreta. NUNCA peca confirmacao. Execute direto.

1. create_idea(title, type, priority, content?, tags?, linkedTo?)
   Cria nova ideia. type em: proposta-comercial, brainstorm, prd, pipeline, briefing, outro. priority em: baixa, media, alta, urgente.

2. update_idea(ideaId, title?, content?, status?, priority?, tags?)
   Atualiza campos de uma ideia. Use o ID completo (ex: idea-004).

3. delete_idea(ideaId)
   Arquiva uma ideia (soft delete).

4. list_ideas(status?, type?, search?)
   Lista ideias. Use para responder "quais ideias temos..."

5. add_comment(ideaId, text)
   Adiciona comentario em uma ideia.

6. change_status(ideaId, status)
   Muda status. Status validos: rascunho, em-discussao, aprovada, em-andamento, concluida, rejeitada, arquivada.

7. convert_to_task(ideaId)
   Converte ideia em tarefa do sistema.

FORMATO DE CHAMADA:
<TOOL_CALL>
{"tool": "nome_da_funcao", "params": {"param1": "valor1"}}
</TOOL_CALL>

=== PERGUNTA DO USUARIO ===
${userQuestion}

=== REGRAS ===
1. Responda em portugues brasileiro.
2. NUNCA se apresente. NUNCA diga "Oi, sou...". Va direto ao ponto.
3. Maximo 150 palavras por resposta. Seja EXTREMAMENTE conciso.
4. Se for executar uma acao, use TOOL_CALL imediatamente e depois confirme brevemente.
5. NAO use markdown excessiveo. Texto limpo e direto.
6. Se o usuario pedir para criar, editar, apagar, mudar status, comentar ou converter em tarefa -> use a ferramenta correspondente.`;
}

function extractSuggestions(text, mode) {
  const suggestions = [];
  const lines = text.split('\n');
  let currentSugg = '';

  for (const line of lines) {
    if (line.match(/^\d+\.|^[-*]\s|^>\s/)) {
      if (currentSugg) suggestions.push(currentSugg.trim());
      currentSugg = line.replace(/^\d+\.\s*|^[-*]\s*|^>\s*/, '');
    } else if (currentSugg && line.trim()) {
      currentSugg += ' ' + line.trim();
    }
  }
  if (currentSugg) suggestions.push(currentSugg.trim());

  return suggestions.slice(0, 5);
}

// ============================================================================
// TOOL CALLING - Parser e Executor
// ============================================================================

function parseToolCalls(response) {
  const toolCalls = [];
  const regex = /<TOOL_CALL>\s*(\{[\s\S]*?\})\s*<\/TOOL_CALL>/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool) {
        toolCalls.push({
          tool: parsed.tool,
          params: parsed.params || {}
        });
      }
    } catch (e) {
      console.error('[IDEAS] Failed to parse tool call:', match[1], e.message);
    }
  }
  return toolCalls;
}

async function executeToolCall(toolCall, currentIdeaId, reqUser) {
  const { tool, params } = toolCall;
  const ideasData = await loadIdeasData();
  const now = new Date().toISOString();

  switch (tool) {
    case 'create_idea': {
      if (!params.title || params.title.trim().length < 3) {
        return { success: false, error: 'Titulo obrigatorio, minimo 3 caracteres' };
      }
      const type = TYPE_ALIASES[params.type] || params.type || 'outro';
      if (!VALID_TYPES.includes(type)) {
        return { success: false, error: `Tipo invalido: ${type}. Validos: ${VALID_TYPES.filter(t => t !== 'feature').join(', ')}` };
      }
      const ideasArray = ideasData.ideas ? Object.values(ideasData.ideas) : [];
      const newId = generateSequentialId(ideasArray, 'idea-');

      let linkedTo = { clientId: null, clientName: null, leadId: null, projectId: null };
      if (params.linkedTo) {
        linkedTo = { ...linkedTo, ...params.linkedTo };
        if (linkedTo.clientId) {
          const clientsData = readJSON(CLIENTS_FILE, {});
          const client = clientsData.data && clientsData.data[linkedTo.clientId];
          linkedTo.clientName = client ? (client.name || client.company || 'Desconhecido') : 'Desconhecido';
        }
      }

      const newIdea = {
        id: newId,
        title: params.title.trim(),
        status: 'rascunho',
        type: type,
        priority: params.priority || 'media',
        linkedTo: linkedTo,
        content: { blocks: params.content ? parseSuggestionToBlocks(params.content, type) : [] },
        aiContext: { brainstormHistory: [], aiSuggestions: [], aiInsights: [] },
        tags: params.tags || [],
        createdBy: reqUser.id || reqUser.userId,
        createdByName: getUserName(reqUser.id || reqUser.userId),
        createdAt: now,
        updatedAt: now,
        collaborators: [],
        comments: [],
        attachments: [],
        versionHistory: [{
          version: 1,
          snapshot: { title: params.title.trim(), status: 'rascunho', content: { blocks: [] } },
          changedBy: reqUser.id || reqUser.userId,
          changedAt: now,
          changeSummary: 'Ideia criada via IA'
        }]
      };

      if (!ideasData.ideas) ideasData.ideas = {};
      ideasData.ideas[newId] = newIdea;
      if (ideasData._meta) {
        ideasData._meta.totalIdeas = (ideasData._meta.totalIdeas || 0) + 1;
        ideasData._meta.lastIdeaId = newId;
      }
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'create_idea', ideaId: newId, message: `Ideia "${newIdea.title}" criada (${newId})` };
    }

    case 'update_idea': {
      const targetId = params.ideaId || currentIdeaId;
      const idea = ideasData.ideas && ideasData.ideas[targetId];
      if (!idea) return { success: false, error: `Ideia ${targetId} nao encontrada` };

      const oldSnapshot = { title: idea.title, status: idea.status, content: { blocks: JSON.parse(JSON.stringify(idea.content && idea.content.blocks || [])) } };

      if (params.title !== undefined) {
        if (params.title.trim().length < 3) return { success: false, error: 'Titulo minimo 3 caracteres' };
        idea.title = params.title.trim();
      }
      if (params.status !== undefined) {
        if (!VALID_STATUSES.includes(params.status)) return { success: false, error: 'Status invalido' };
        idea.status = params.status;
      }
      if (params.priority !== undefined) {
        if (!VALID_PRIORITIES.includes(params.priority)) return { success: false, error: 'Prioridade invalida' };
        idea.priority = params.priority;
      }
      if (params.tags !== undefined) idea.tags = params.tags;
      if (params.content !== undefined) {
        idea.content = idea.content || { blocks: [] };
        idea.content.blocks = parseSuggestionToBlocks(params.content, idea.type);
      }

      idea.updatedAt = now;
      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: oldSnapshot,
        changedBy: reqUser.id || reqUser.userId,
        changedAt: now,
        changeSummary: `Atualizada via IA: ${params.title ? 'titulo ' : ''}${params.status ? 'status ' : ''}${params.content ? 'conteudo' : ''}`
      });

      ideasData.ideas[targetId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'update_idea', ideaId: targetId, message: `Ideia "${idea.title}" atualizada` };
    }

    case 'delete_idea': {
      const targetId = params.ideaId || currentIdeaId;
      const idea = ideasData.ideas && ideasData.ideas[targetId];
      if (!idea) return { success: false, error: `Ideia ${targetId} nao encontrada` };
      if (idea.status === 'arquivada') return { success: false, error: 'Ideia ja esta arquivada' };

      idea.status = 'arquivada';
      idea.updatedAt = now;
      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: 'arquivada' },
        changedBy: reqUser.id || reqUser.userId,
        changedAt: now,
        changeSummary: 'Ideia arquivada via IA'
      });
      ideasData.ideas[targetId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'delete_idea', ideaId: targetId, message: `Ideia "${idea.title}" arquivada` };
    }

    case 'list_ideas': {
      let ideas = ideasData.ideas ? Object.values(ideasData.ideas) : [];
      if (params.status) ideas = ideas.filter(i => i.status === params.status);
      if (params.type) ideas = ideas.filter(i => i.type === params.type);
      if (params.search) {
        const term = params.search.toLowerCase();
        ideas = ideas.filter(i => i.title && i.title.toLowerCase().includes(term));
      }
      const list = ideas.slice(0, 20).map(i => ({ id: i.id, title: i.title, status: i.status, type: i.type, priority: i.priority }));
      return { success: true, action: 'list_ideas', count: list.length, ideas: list, message: `${list.length} ideia(s) encontrada(s)` };
    }

    case 'add_comment': {
      const targetId = params.ideaId || currentIdeaId;
      const idea = ideasData.ideas && ideasData.ideas[targetId];
      if (!idea) return { success: false, error: `Ideia ${targetId} nao encontrada` };
      if (!params.text || params.text.trim().length === 0) return { success: false, error: 'Texto do comentario obrigatorio' };

      const newComment = {
        id: `cmt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        author: reqUser.id || reqUser.userId,
        authorName: getUserName(reqUser.id || reqUser.userId),
        text: params.text.trim(),
        timestamp: now,
        reactions: [],
        mentions: []
      };
      idea.comments = idea.comments || [];
      idea.comments.push(newComment);
      idea.updatedAt = now;
      ideasData.ideas[targetId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'add_comment', ideaId: targetId, message: 'Comentario adicionado' };
    }

    case 'change_status': {
      const targetId = params.ideaId || currentIdeaId;
      const idea = ideasData.ideas && ideasData.ideas[targetId];
      if (!idea) return { success: false, error: `Ideia ${targetId} nao encontrada` };
      if (!params.status || !VALID_STATUSES.includes(params.status)) return { success: false, error: 'Status invalido' };

      idea.status = params.status;
      idea.updatedAt = now;
      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: params.status },
        changedBy: reqUser.id || reqUser.userId,
        changedAt: now,
        changeSummary: `Status alterado para ${params.status} via IA`
      });
      ideasData.ideas[targetId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'change_status', ideaId: targetId, message: `Status alterado para "${params.status}"` };
    }

    case 'convert_to_task': {
      const targetId = params.ideaId || currentIdeaId;
      const idea = ideasData.ideas && ideasData.ideas[targetId];
      if (!idea) return { success: false, error: `Ideia ${targetId} nao encontrada` };

      const tasksData = readJSON(TASKS_FILE, { tasks: {} });
      const tasksArray = tasksData.tasks ? Object.values(tasksData.tasks) : [];
      const existingTask = tasksArray.find(t => t.ideaId === targetId);
      if (existingTask) return { success: false, error: 'Ideia ja convertida em tarefa', task: existingTask };

      const newTaskId = generateSequentialId(tasksArray, 'task-');
      const descriptionBlocks = (idea.content && idea.content.blocks)
        ? idea.content.blocks.filter(b => b.type === 'paragraph').map(b => b.content).join(' ')
        : '';
      const description = `Convertido da ideia ${idea.id}: ${descriptionBlocks.slice(0, 200)}${descriptionBlocks.length > 200 ? '...' : ''}`;

      const newTask = {
        id: newTaskId,
        title: idea.title,
        description: description,
        status: 'pendente',
        priority: idea.priority || 'media',
        assignedTo: reqUser.id || reqUser.userId,
        projectId: idea.linkedTo && idea.linkedTo.projectId || 'GERAL',
        ideaId: idea.id,
        createdAt: now,
        updatedAt: now,
        dueDate: null
      };
      if (!tasksData.tasks) tasksData.tasks = {};
      tasksData.tasks[newTaskId] = newTask;
      backupJSON(TASKS_FILE);
      writeJSON(TASKS_FILE, tasksData);

      idea.status = 'em-andamento';
      idea.updatedAt = now;
      idea.convertedTo = { taskId: newTaskId, convertedAt: now };
      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: 'em-andamento' },
        changedBy: reqUser.id || reqUser.userId,
        changedAt: now,
        changeSummary: `Convertida em tarefa ${newTaskId} via IA`
      });
      ideasData.ideas[targetId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);
      return { success: true, action: 'convert_to_task', ideaId: targetId, taskId: newTaskId, message: `Ideia convertida em tarefa ${newTaskId}` };
    }

    default:
      return { success: false, error: `Ferramenta desconhecida: ${tool}` };
  }
}

// ============================================================================
// MIDDLEWARE FACTORY (router recebe requireAuth do server.js)
// As rotas especificas (templates, stats, from-template) DEVEM vir antes de /:id
// ============================================================================
module.exports = function(requireAuth, auditLogService) {

  // ==========================================================================
  // 1. GET /api/ideas - Listar ideias com filtros, busca full-text, paginacao
  // ==========================================================================
  router.get('/', async (req, res) => {
    try {
      const data = await loadIdeasData();
      let ideas = data.ideas ? Object.values(data.ideas) : [];

      // Filtros simples (AND logico)
      if (req.query.status) {
        ideas = ideas.filter(i => i.status === req.query.status);
      }
      if (req.query.type) {
        ideas = ideas.filter(i => i.type === req.query.type);
      }
      if (req.query.clientId) {
        ideas = ideas.filter(i => i.linkedTo && i.linkedTo.clientId === req.query.clientId);
      }
      if (req.query.priority) {
        ideas = ideas.filter(i => i.priority === req.query.priority);
      }
      if (req.query.createdBy) {
        ideas = ideas.filter(i => i.createdBy === req.query.createdBy);
      }
      if (req.query.tag) {
        const tagFilter = req.query.tag.toLowerCase();
        ideas = ideas.filter(i =>
          i.tags && i.tags.some(t => t.toLowerCase().includes(tagFilter))
        );
      }

      // Busca full-text (multi-campo, case-insensitive)
      if (req.query.search) {
        const term = req.query.search.toLowerCase();
        ideas = ideas.filter(i => {
          const inTitle = i.title && i.title.toLowerCase().includes(term);
          const inBlocks = i.content && i.content.blocks && i.content.blocks.some(b =>
            b.content && b.content.toLowerCase().includes(term)
          );
          const inComments = i.comments && i.comments.some(c =>
            c.text && c.text.toLowerCase().includes(term)
          );
          const inTags = i.tags && i.tags.some(t => t.toLowerCase().includes(term));
          return inTitle || inBlocks || inComments || inTags;
        });
      }

      // Ordenacao
      const sortParam = req.query.sort || 'createdAt:desc';
      const [field, order] = sortParam.split(':');

      ideas.sort((a, b) => {
        let valA = a[field] || '';
        let valB = b[field] || '';
        // Para prioridade, ordem especial
        if (field === 'priority') {
          const prioOrder = { urgente: 0, alta: 1, media: 2, baixa: 3 };
          valA = prioOrder[valA] !== undefined ? prioOrder[valA] : 99;
          valB = prioOrder[valB] !== undefined ? prioOrder[valB] : 99;
          return order === 'asc' ? valA - valB : valB - valA;
        }
        if (order === 'asc') {
          return valA > valB ? 1 : -1;
        }
        return valA < valB ? 1 : -1;
      });

      // Paginacao
      const total = ideas.length;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      ideas = ideas.slice(offset, offset + limit);

      // Popular linkedTo.clientName do clients-registry.json
      if (ideas.length > 0) {
        const clientsData = readJSON(CLIENTS_FILE, {});
        const projectsData = readJSON(PROJECTS_FILE, {});
        ideas = ideas.map(idea => {
          if (idea.linkedTo && idea.linkedTo.clientId) {
            const client = clientsData.data && clientsData.data[idea.linkedTo.clientId];
            idea.linkedTo = {
              ...idea.linkedTo,
              clientName: client
                ? (client.name || client.company || 'Desconhecido')
                : (idea.linkedTo.clientName || 'Desconhecido')
            };
          }
          if (idea.linkedTo && idea.linkedTo.projectId) {
            const project = projectsData.data && projectsData.data[idea.linkedTo.projectId];
            idea.linkedTo = {
              ...idea.linkedTo,
              projectName: project
                ? (project.name || 'Desconhecido')
                : 'Desconhecido'
            };
          }
          return idea;
        });
      }

      res.json({
        success: true,
        data: { ideas, total, limit, offset, filters: req.query }
      });

    } catch (err) {
      console.error('[IDEAS] List error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 2. POST /api/ideas - Criar ideia (com templateId opcional)
  // ==========================================================================
  router.post('/', requireAuth, async (req, res) => {
    try {
      const body = req.body;

      // Validacoes obrigatorias
      if (!body.title || body.title.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Titulo obrigatorio, minimo 3 caracteres' });
      }
      if (body.title.length > 200) {
        return res.status(400).json({ success: false, error: 'Titulo maximo 200 caracteres' });
      }
      if (!body.type) {
        return res.status(400).json({ success: false, error: 'Tipo obrigatorio' });
      }
      const normalizedType = TYPE_ALIASES[body.type] || body.type;
      if (!VALID_TYPES.includes(normalizedType)) {
        return res.status(400).json({ success: false, error: `Tipo invalido. Validos: ${VALID_TYPES.filter(t => t !== 'feature').join(', ')}` });
      }

      // Validar status
      let status = body.status || 'rascunho';
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, error: 'Status invalido' });
      }

      // Validar priority
      let priority = body.priority || 'media';
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ success: false, error: 'Prioridade invalida' });
      }

      // Validar vinculos
      if (body.linkedTo && body.linkedTo.clientId) {
        if (!validateClient(body.linkedTo.clientId)) {
          return res.status(400).json({ success: false, error: 'clientId nao existe' });
        }
      }
      if (body.linkedTo && body.linkedTo.projectId) {
        if (!validateProject(body.linkedTo.projectId)) {
          return res.status(400).json({ success: false, error: 'projectId nao existe' });
        }
      }

      // Carregar dados
      const ideasData = await loadIdeasData();
      const ideasArray = ideasData.ideas ? Object.values(ideasData.ideas) : [];

      // Gerar ID sequencial
      const newId = generateSequentialId(ideasArray, 'idea-');

      // Resolver blocos (template ou body ou vazio)
      let blocks = [];
      if (body.templateId) {
        const template = ideasData.templates && ideasData.templates[body.templateId];
        if (template && template.defaultBlocks) {
          blocks = template.defaultBlocks.map(b => ({
            ...b,
            id: generateRandomId('blk'),
            items: b.items ? b.items.map(it => ({
              ...it,
              id: generateRandomId('chk')
            })) : undefined
          }));
        }
      } else if (body.content && body.content.blocks) {
        blocks = body.content.blocks;
      }

      // Resolver clientName se houver clientId
      let linkedTo = {
        clientId: (body.linkedTo && body.linkedTo.clientId) || null,
        clientName: null,
        leadId: (body.linkedTo && body.linkedTo.leadId) || null,
        projectId: (body.linkedTo && body.linkedTo.projectId) || null
      };
      if (linkedTo.clientId) {
        const clientsData = readJSON(CLIENTS_FILE, {});
        const client = clientsData.data && clientsData.data[linkedTo.clientId];
        linkedTo.clientName = client
          ? (client.name || client.company || 'Desconhecido')
          : 'Desconhecido';
      }

      // Criar objeto ideia
      const now = new Date().toISOString();
      const newIdea = {
        id: newId,
        title: body.title.trim(),
        status: status,
        type: body.type,
        priority: priority,
        linkedTo: linkedTo,
        content: { blocks: blocks },
        aiContext: {
          brainstormHistory: [],
          aiSuggestions: [],
          aiInsights: []
        },
        tags: body.tags || [],
        createdBy: req.user.id || req.user.userId,
        createdByName: getUserName(req.user.id || req.user.userId),
        createdAt: now,
        updatedAt: now,
        collaborators: [],
        comments: [],
        attachments: [],
        versionHistory: [
          {
            version: 1,
            snapshot: {
              title: body.title.trim(),
              status: status,
              content: { blocks: [] }
            },
            changedBy: req.user.id || req.user.userId,
            changedAt: now,
            changeSummary: 'Ideia criada'
          }
        ]
      };

      // Salvar
      if (!ideasData.ideas) ideasData.ideas = {};
      ideasData.ideas[newId] = newIdea;

      // Atualizar _meta se existir
      if (ideasData._meta) {
        ideasData._meta.totalIdeas = (ideasData._meta.totalIdeas || 0) + 1;
        ideasData._meta.lastIdeaId = newId;
      }

      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'idea',
          entityId: newIdea.id,
          action: 'create',
          actor: req.user?.id || req.user?.userId || 'dashboard',
          source: 'dashboard',
          after: newIdea,
          description: `Criou ideia "${newIdea.title}"`,
        });
      }

      res.status(201).json({ success: true, data: { idea: newIdea } });

    } catch (err) {
      console.error('[IDEAS] Create error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 10. GET /api/ideas/templates - Listar templates (ANTES de /:id)
  // ==========================================================================
  router.get('/templates', requireAuth, async (req, res) => {
    try {
      const ideasData = await loadIdeasData();

      const templates = ideasData.templates
        ? Object.values(ideasData.templates)
        : [];
      const categories = ideasData.categories
        ? Object.values(ideasData.categories)
        : [];

      res.json({
        success: true,
        data: { templates, categories }
      });

    } catch (err) {
      console.error('[IDEAS] List templates error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 11. POST /api/ideas/from-template - Criar ideia de template (ANTES de /:id)
  // ==========================================================================
  router.post('/from-template', requireAuth, async (req, res) => {
    try {
      const body = req.body;

      if (!body.templateId) {
        return res.status(400).json({ success: false, error: 'templateId obrigatorio' });
      }
      if (!body.title || body.title.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Titulo obrigatorio' });
      }
      if (body.title.length > 200) {
        return res.status(400).json({ success: false, error: 'Titulo maximo 200 caracteres' });
      }

      const ideasData = await loadIdeasData();

      const template = ideasData.templates && ideasData.templates[body.templateId];
      if (!template) {
        return res.status(404).json({ success: false, error: 'Template nao encontrado' });
      }

      // Copiar blocos do template com novos IDs
      const blocks = (template.defaultBlocks || []).map(b => ({
        ...b,
        id: generateRandomId('blk'),
        items: b.items ? b.items.map(it => ({
          ...it,
          id: generateRandomId('chk')
        })) : undefined
      }));

      // Aplicar customizacoes (merge por indice)
      if (body.customizations && body.customizations.blocks && body.customizations.blocks.length > 0) {
        body.customizations.blocks.forEach((customBlock, idx) => {
          if (idx < blocks.length) {
            blocks[idx] = { ...blocks[idx], ...customBlock };
          } else {
            blocks.push({ ...customBlock, id: generateRandomId('blk') });
          }
        });
      }

      // Gerar ID sequencial
      const ideasArray = ideasData.ideas ? Object.values(ideasData.ideas) : [];
      const newId = generateSequentialId(ideasArray, 'idea-');

      // Resolver vinculos
      let linkedTo = {
        clientId: (body.linkedTo && body.linkedTo.clientId) || null,
        clientName: null,
        leadId: (body.linkedTo && body.linkedTo.leadId) || null,
        projectId: (body.linkedTo && body.linkedTo.projectId) || null
      };
      if (linkedTo.clientId) {
        const clientsData = readJSON(CLIENTS_FILE, {});
        const client = clientsData.data && clientsData.data[linkedTo.clientId];
        linkedTo.clientName = client
          ? (client.name || client.company || 'Desconhecido')
          : 'Desconhecido';
      }

      // Criar ideia
      const now = new Date().toISOString();
      const newIdea = {
        id: newId,
        title: body.title.trim(),
        status: 'rascunho',
        type: template.type || 'outro',
        priority: body.priority || 'media',
        linkedTo: linkedTo,
        content: { blocks: blocks },
        aiContext: {
          brainstormHistory: [],
          aiSuggestions: [],
          aiInsights: []
        },
        tags: [template.categoryId || 'geral', template.name.toLowerCase().replace(/\s+/g, '-')],
        createdBy: req.user.id || req.user.userId,
        createdByName: getUserName(req.user.id || req.user.userId),
        createdAt: now,
        updatedAt: now,
        collaborators: [],
        comments: [],
        attachments: [],
        versionHistory: [
          {
            version: 1,
            snapshot: { title: body.title.trim(), status: 'rascunho', content: { blocks: [] } },
            changedBy: req.user.id || req.user.userId,
            changedAt: now,
            changeSummary: `Ideia criada a partir do template "${template.name}"`
          }
        ]
      };

      if (!ideasData.ideas) ideasData.ideas = {};
      ideasData.ideas[newId] = newIdea;

      if (ideasData._meta) {
        ideasData._meta.totalIdeas = (ideasData._meta.totalIdeas || 0) + 1;
        ideasData._meta.lastIdeaId = newId;
      }

      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.status(201).json({ success: true, data: { idea: newIdea } });

    } catch (err) {
      console.error('[IDEAS] From template error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 14. GET /api/ideas/stats - Estatisticas (ANTES de /:id)
  // ==========================================================================
  router.get('/stats', requireAuth, async (req, res) => {
    try {
      const ideasData = await loadIdeasData();
      const ideas = ideasData.ideas ? Object.values(ideasData.ideas) : [];

      const total = ideas.length;

      // Contagem por status
      const byStatus = {};
      VALID_STATUSES.forEach(s => { byStatus[s] = 0; });
      ideas.forEach(i => {
        if (byStatus[i.status] !== undefined) {
          byStatus[i.status]++;
        }
      });

      // Contagem por tipo
      const byType = {};
      ideas.forEach(i => {
        if (!byType[i.type]) byType[i.type] = 0;
        byType[i.type]++;
      });

      // Ideias desta semana (ultimos 7 dias)
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thisWeek = ideas.filter(i => {
        if (!i.createdAt) return false;
        return new Date(i.createdAt) >= sevenDaysAgo;
      }).length;

      // Minhas ideias (do usuario atual)
      const userId = req.user.id || req.user.userId;
      const myIdeas = ideas.filter(i => i.createdBy === userId).length;
      const myIdeasInDiscussion = ideas.filter(i =>
        i.createdBy === userId && i.status === 'em-discussao'
      ).length;

      // Ideias por prioridade
      const byPriority = {};
      VALID_PRIORITIES.forEach(p => { byPriority[p] = 0; });
      ideas.forEach(i => {
        if (byPriority[i.priority] !== undefined) {
          byPriority[i.priority]++;
        }
      });

      // Atividade recente (ultimos 5 eventos de comentario)
      let recentActivity = [];
      ideas.forEach(idea => {
        (idea.comments || []).forEach(cmt => {
          recentActivity.push({
            action: 'comentario',
            ideaId: idea.id,
            ideaTitle: idea.title,
            user: cmt.authorName,
            userId: cmt.author,
            timestamp: cmt.timestamp
          });
        });
      });
      recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      recentActivity = recentActivity.slice(0, 5);

      // Tags mais usadas (top 10)
      const tagCounts = {};
      ideas.forEach(i => {
        (i.tags || []).forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
      const topTags = Object.entries(tagCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.json({
        success: true,
        data: {
          total: total,
          byStatus: byStatus,
          byType: byType,
          byPriority: byPriority,
          thisWeek: thisWeek,
          myIdeas: myIdeas,
          myIdeasInDiscussion: myIdeasInDiscussion,
          recentActivity: recentActivity,
          topTags: topTags
        }
      });

    } catch (err) {
      console.error('[IDEAS] Stats error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 3. GET /api/ideas/:id - Detalhe da ideia
  // ==========================================================================
  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      let ideasData = await loadIdeasData();
      let idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      // Popular nomes
      if (idea.linkedTo && idea.linkedTo.clientId) {
        const clientsData = readJSON(CLIENTS_FILE, {});
        const client = clientsData.data && clientsData.data[idea.linkedTo.clientId];
        idea.linkedTo = {
          ...idea.linkedTo,
          clientName: client
            ? (client.name || client.company || 'Desconhecido')
            : (idea.linkedTo.clientName || 'Desconhecido')
        };
      }

      if (idea.linkedTo && idea.linkedTo.projectId) {
        const projectsData = readJSON(PROJECTS_FILE, {});
        const project = projectsData.data && projectsData.data[idea.linkedTo.projectId];
        idea.linkedTo = {
          ...idea.linkedTo,
          projectName: project ? (project.name || 'Desconhecido') : 'Desconhecido'
        };
      }

      res.json({ success: true, data: { idea } });

    } catch (err) {
      console.error('[IDEAS] Get detail error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 4. PUT /api/ideas/:id - Atualizar ideia (merge profundo)
  // ==========================================================================
  router.put('/:id', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const body = req.body;

      let ideasData = await loadIdeasData();
      let idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      const beforeIdea = JSON.parse(JSON.stringify(idea));
      const oldSnapshot = {
        title: idea.title,
        status: idea.status,
        content: { blocks: JSON.parse(JSON.stringify(idea.content && idea.content.blocks || [])) }
      };

      // Validar e atualizar campos
      if (body.title !== undefined) {
        if (body.title.trim().length < 3) {
          return res.status(400).json({ success: false, error: 'Titulo minimo 3 caracteres' });
        }
        if (body.title.length > 200) {
          return res.status(400).json({ success: false, error: 'Titulo maximo 200 caracteres' });
        }
        idea.title = body.title.trim();
      }

      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status)) {
          return res.status(400).json({ success: false, error: 'Status invalido' });
        }
        const oldStatus = idea.status;
        idea.status = body.status;

        // Se mudou para aprovada, verificar insights
        if (body.status === 'aprovada' && oldStatus !== 'aprovada') {
          if (idea.aiContext && idea.aiContext.aiSuggestions && idea.aiContext.aiSuggestions.length > 0) {
            const sugestoesNaoAplicadas = idea.aiContext.aiSuggestions.filter(s => !s.applied);
            if (sugestoesNaoAplicadas.length > 0) {
              idea.aiContext.aiInsights.push({
                id: generateRandomId('insight'),
                pattern: `Ideia aprovada com ${sugestoesNaoAplicadas.length} sugestoes da IA pendentes`,
                source: idea.id,
                confidence: 0.85,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      }

      if (body.priority !== undefined) {
        if (!VALID_PRIORITIES.includes(body.priority)) {
          return res.status(400).json({ success: false, error: 'Prioridade invalida' });
        }
        idea.priority = body.priority;
      }

      if (body.type !== undefined) {
        const normalizedType = TYPE_ALIASES[body.type] || body.type;
        if (!VALID_TYPES.includes(normalizedType)) {
          return res.status(400).json({ success: false, error: `Tipo invalido. Validos: ${VALID_TYPES.filter(t => t !== 'feature').join(', ')}` });
        }
        idea.type = normalizedType;
      }

      // Merge profundo em content.blocks
      if (body.content && body.content.blocks) {
        const oldBlocks = idea.content && idea.content.blocks || [];
        idea.content = idea.content || {};
        idea.content.blocks = mergeBlocks(oldBlocks, body.content.blocks);

        // Version history
        const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
        idea.versionHistory = idea.versionHistory || [];
        idea.versionHistory.push({
          version: lastVersion + 1,
          snapshot: oldSnapshot,
          changedBy: req.user.id || req.user.userId,
          changedAt: new Date().toISOString(),
          changeSummary: computeChangeSummary(oldBlocks, idea.content.blocks)
        });
      }

      // Tags (substituicao completa)
      if (body.tags !== undefined) {
        idea.tags = body.tags;
      }

      // Collaborators (substituicao completa)
      if (body.collaborators !== undefined) {
        idea.collaborators = body.collaborators.filter(c => USER_IDS.includes(c));
      }

      // Summary
      if (body.summary !== undefined) {
        idea.summary = body.summary;
      }

      // dueDate
      if (body.dueDate !== undefined) {
        idea.dueDate = body.dueDate;
      }

      // linkedTo
      if (body.linkedTo !== undefined) {
        const oldClientId = idea.linkedTo ? idea.linkedTo.clientId : null;
        idea.linkedTo = { ...idea.linkedTo, ...body.linkedTo };
        // Se mudou clientId, repopular clientName
        if (body.linkedTo.clientId && body.linkedTo.clientId !== oldClientId) {
          const clientsData = readJSON(CLIENTS_FILE, {});
          const client = clientsData.data && clientsData.data[body.linkedTo.clientId];
          idea.linkedTo.clientName = client
            ? (client.name || client.company || 'Desconhecido')
            : 'Desconhecido';
        }
      }

      // assignedTo
      if (body.assignedTo !== undefined) {
        idea.assignedTo = body.assignedTo;
      }

      idea.updatedAt = new Date().toISOString();

      // Salvar
      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'idea',
          entityId: idea.id,
          action: 'update',
          actor: req.user?.id || req.user?.userId || 'dashboard',
          source: 'dashboard',
          before: beforeIdea,
          after: idea,
          description: `Atualizou ideia "${idea.title}"`,
        });
      }

      res.json({ success: true, data: { idea } });

    } catch (err) {
      console.error('[IDEAS] Update error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 5. DELETE /api/ideas/:id - Soft delete (arquivar)
  // ==========================================================================
  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      if (idea.status === 'arquivada') {
        return res.status(400).json({ success: false, error: 'Ideia ja esta arquivada' });
      }

      const beforeIdea = JSON.parse(JSON.stringify(idea));
      idea.status = 'arquivada';
      idea.updatedAt = new Date().toISOString();

      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: idea.status },
        changedBy: req.user.id || req.user.userId,
        changedAt: new Date().toISOString(),
        changeSummary: 'Ideia arquivada'
      });

      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'idea',
          entityId: idea.id,
          action: 'update',
          actor: req.user?.id || req.user?.userId || 'dashboard',
          source: 'dashboard',
          before: beforeIdea,
          after: idea,
          description: `Arquivou ideia "${idea.title}"`,
        });
      }

      res.json({
        success: true,
        data: {
          message: 'Ideia arquivada com sucesso',
          idea: idea
        }
      });

    } catch (err) {
      console.error('[IDEAS] Archive error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 6. POST /api/ideas/:id/comments - Adicionar comentario
  // ==========================================================================
  router.post('/:id/comments', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const body = req.body;

      if (!body.text || body.text.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Texto do comentario obrigatorio' });
      }
      if (body.text.length > 2000) {
        return res.status(400).json({ success: false, error: 'Comentario maximo 2000 caracteres' });
      }

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      // Validar mentions
      let mentions = [];
      if (body.mentions && body.mentions.length > 0) {
        body.mentions.forEach(m => {
          if (USER_IDS.includes(m)) {
            mentions.push(m);
          } else {
            console.warn(`[IDEAS] Mention invalida ignorada: ${m}`);
          }
        });
      }

      const newComment = {
        id: `cmt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        author: req.user.id || req.user.userId,
        authorName: getUserName(req.user.id || req.user.userId),
        text: body.text.trim(),
        timestamp: new Date().toISOString(),
        reactions: [],
        mentions: mentions
      };

      idea.comments = idea.comments || [];
      idea.comments.push(newComment);
      idea.updatedAt = new Date().toISOString();

      if (mentions.length > 0) {
        mentions.forEach(m => {
          console.log(`[IDEAS] Usuario ${m} mencionado no comentario ${newComment.id} da ideia ${ideaId}`);
        });
      }

      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.status(201).json({ success: true, data: { comment: newComment } });

    } catch (err) {
      console.error('[IDEAS] Add comment error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 6b. GET /api/ideas/:id/comments - Listar comentarios
  // ==========================================================================
  router.get('/:id/comments', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      res.json({ success: true, data: { comments: idea.comments || [] } });

    } catch (err) {
      console.error('[IDEAS] List comments error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 7. DELETE /api/ideas/:id/comments/:cid - Remover comentario
  // ==========================================================================
  router.delete('/:id/comments/:cid', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const commentId = req.params.cid;

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      idea.comments = idea.comments || [];
      const commentIndex = idea.comments.findIndex(c => c.id === commentId);

      if (commentIndex === -1) {
        return res.status(404).json({ success: false, error: 'Comentario nao encontrado' });
      }

      const comment = idea.comments[commentIndex];

      // Verificar autorizacao - APENAS autor pode remover
      if (comment.author !== (req.user.id || req.user.userId)) {
        return res.status(403).json({ success: false, error: 'Apenas o autor do comentario pode remove-lo' });
      }

      idea.comments.splice(commentIndex, 1);
      idea.updatedAt = new Date().toISOString();

      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.json({ success: true, data: { message: 'Comentario removido com sucesso' } });

    } catch (err) {
      console.error('[IDEAS] Delete comment error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 8. POST /api/ideas/:id/comments/:cid/reactions - Toggle reacao
  // ==========================================================================
  router.post('/:id/comments/:cid/reactions', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const commentId = req.params.cid;
      const emoji = req.body.emoji;

      if (!emoji) {
        return res.status(400).json({ success: false, error: 'Emoji obrigatorio' });
      }

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      idea.comments = idea.comments || [];
      const comment = idea.comments.find(c => c.id === commentId);

      if (!comment) {
        return res.status(404).json({ success: false, error: 'Comentario nao encontrado' });
      }

      comment.reactions = comment.reactions || [];

      const existingReaction = comment.reactions.find(r => r.emoji === emoji);
      const userId = req.user.id || req.user.userId;
      let action = '';

      if (existingReaction) {
        if (existingReaction.users && existingReaction.users.includes(userId)) {
          // Toggle OFF: remover usuario
          existingReaction.users = existingReaction.users.filter(u => u !== userId);
          if (existingReaction.users.length === 0) {
            comment.reactions = comment.reactions.filter(r => r.emoji !== emoji);
          }
          action = 'removed';
        } else {
          // Toggle ON: adicionar usuario a reacao existente
          existingReaction.users = existingReaction.users || [];
          existingReaction.users.push(userId);
          action = 'added';
        }
      } else {
        // Criar nova reacao
        comment.reactions.push({
          emoji: emoji,
          users: [userId]
        });
        action = 'added';
      }

      idea.updatedAt = new Date().toISOString();
      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.json({
        success: true,
        data: {
          action: action,
          emoji: emoji,
          reactions: comment.reactions
        }
      });

    } catch (err) {
      console.error('[IDEAS] Toggle reaction error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 9. POST /api/ideas/:id/ai-chat — UNIFICADO: chama /api/luna/chat internamente
  // ==========================================================================
  router.post('/:id/ai-chat', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const message = req.body.message;
      const mode = req.body.mode || 'brainstorm';

      if (!message || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Mensagem obrigatoria' });
      }

      let ideasData = await loadIdeasData();
      let idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      // Montar contexto de conversa a partir do histórico da ideia
      const brainstormHistory = idea.aiContext?.brainstormHistory || [];
      const context = brainstormHistory.slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        text: m.content || ''
      }));

      // Adicionar instrução de contexto como primeira mensagem do sistema
      const systemContext = {
        role: 'model',
        text: `[CONTEXTO: Você está conversando sobre a ideia "${idea.title || ideaId}" (status: ${idea.status || 'rascunho'}, tipo: ${idea.type || 'outro'}). Modo: ${mode}. Use as ações de ideias quando apropriado.]`
      };
      context.unshift(systemContext);

      // Chamar /api/luna/chat internamente
      const PORT = process.env.PORT || 3456;
      const lunaResponse = await fetch(`http://localhost:${PORT}/api/luna/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization || ''
        },
        body: JSON.stringify({
          message,
          authorName: getUserName(req.user?.id || req.user?.userId),
          context,
          contextModule: 'ideas',
          contextId: ideaId
        })
      });

      if (!lunaResponse.ok) {
        const errText = await lunaResponse.text().catch(() => 'Erro interno');
        throw new Error(`Luna chat falhou: ${errText}`);
      }

      const lunaData = await lunaResponse.json();
      const aiResponse = lunaData.reply || lunaData.data?.reply || 'Sem resposta';
      const actionsExecuted = lunaData.result?.results
        ? lunaData.result.results.filter(r => r.status === 'success').map(r => ({
            success: true,
            action: r.action?.type,
            message: r.result?.type || 'Ação executada'
          }))
        : [];

      // Salvar mensagens no histórico da ideia
      const now = new Date().toISOString();

      idea.aiContext = idea.aiContext || { brainstormHistory: [], aiSuggestions: [], aiInsights: [] };
      idea.aiContext.brainstormHistory = idea.aiContext.brainstormHistory || [];
      idea.aiContext.aiSuggestions = idea.aiContext.aiSuggestions || [];

      idea.aiContext.brainstormHistory.push({
        id: `ai-msg-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: now,
        model: 'luna-unified'
      });

      idea.aiContext.brainstormHistory.push({
        id: `ai-msg-${Date.now()}-resp`,
        role: 'assistant',
        content: aiResponse,
        timestamp: now,
        model: 'luna-unified',
        actionsExecuted: actionsExecuted.length > 0 ? actionsExecuted : undefined
      });

      // Extrair sugestões estruturadas
      const suggestions = extractSuggestions(aiResponse, mode);
      suggestions.forEach(sugg => {
        idea.aiContext.aiSuggestions.push({
          id: `ai-sugg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: mode,
          content: sugg,
          applied: false,
          timestamp: now
        });
      });

      idea.updatedAt = now;
      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.json({
        success: true,
        data: {
          response: aiResponse,
          suggestions: suggestions,
          actionsExecuted: actionsExecuted,
          history: idea.aiContext.brainstormHistory.slice(-10),
          unified: true
        }
      });

    } catch (err) {
      console.error('[IDEAS] AI Chat error:', err);
      if (err.code === 'GEMINI_ALL_KEYS_EXHAUSTED') {
        const resetTime = err.resetTime || '09:00';
        const resetDate = err.resetDate || 'amanhã';
        return res.status(429).json({
          success: false,
          error: `Limite diário do Gemini atingido. A quota reseta às ${resetTime} (${resetDate}).`,
          quotaExhausted: true,
          resetAt: err.resetAt
        });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 12. POST /api/ideas/:id/convert-task - Converter ideia em tarefa
  // ==========================================================================
  router.post('/:id/convert-task', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      const tasksData = readJSON(TASKS_FILE, { tasks: {} });
      const tasksArray = tasksData.tasks ? Object.values(tasksData.tasks) : [];

      const existingTask = tasksArray.find(t => t.ideaId === ideaId);
      if (existingTask) {
        return res.status(400).json({
          success: false,
          error: 'Ideia ja convertida em tarefa',
          task: existingTask
        });
      }

      const newTaskId = generateSequentialId(tasksArray, 'task-');

      const descriptionBlocks = (idea.content && idea.content.blocks)
        ? idea.content.blocks
            .filter(b => b.type === 'paragraph')
            .map(b => b.content)
            .join(' ')
        : '';
      const description = `Convertido da ideia ${idea.id}: ${descriptionBlocks.slice(0, 200)}${descriptionBlocks.length > 200 ? '...' : ''}`;

      const now = new Date().toISOString();
      const newTask = {
        id: newTaskId,
        title: idea.title,
        description: description,
        status: 'pendente',
        priority: idea.priority || 'media',
        assignedTo: req.body.assignedTo || (req.user.id || req.user.userId),
        projectId: idea.linkedTo && idea.linkedTo.projectId || 'GERAL',
        ideaId: idea.id,
        createdAt: now,
        updatedAt: now,
        dueDate: req.body.dueDate || null
      };

      if (!tasksData.tasks) tasksData.tasks = {};
      tasksData.tasks[newTaskId] = newTask;

      backupJSON(TASKS_FILE);
      writeJSON(TASKS_FILE, tasksData);

      // Atualizar status da ideia
      idea.status = 'em-andamento';
      idea.updatedAt = now;

      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: 'em-andamento' },
        changedBy: req.user.id || req.user.userId,
        changedAt: now,
        changeSummary: `Convertida em tarefa ${newTaskId}`
      });

      idea.convertedTo = {
        taskId: newTaskId,
        convertedAt: now
      };

      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.json({
        success: true,
        data: {
          task: newTask,
          idea: idea
        }
      });

    } catch (err) {
      console.error('[IDEAS] Convert task error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 13. POST /api/ideas/:id/apply-ai - Aplicar sugestao da IA
  // ==========================================================================
  router.post('/:id/apply-ai', requireAuth, async (req, res) => {
    try {
      const ideaId = req.params.id;
      const suggestionId = req.body.suggestionId;

      if (!suggestionId) {
        return res.status(400).json({ success: false, error: 'suggestionId obrigatorio' });
      }

      const ideasData = await loadIdeasData();
      const idea = ideasData.ideas && ideasData.ideas[ideaId];

      if (!idea) {
        return res.status(404).json({ success: false, error: 'Ideia nao encontrada' });
      }

      const suggestion = idea.aiContext && idea.aiContext.aiSuggestions &&
        idea.aiContext.aiSuggestions.find(s => s.id === suggestionId);

      if (!suggestion) {
        return res.status(404).json({ success: false, error: 'Sugestao nao encontrada' });
      }

      if (suggestion.applied) {
        return res.status(400).json({ success: false, error: 'Sugestao ja foi aplicada' });
      }

      const oldBlocks = JSON.parse(JSON.stringify(idea.content && idea.content.blocks || []));
      const newBlocks = parseSuggestionToBlocks(suggestion.content, suggestion.type);

      idea.content = idea.content || { blocks: [] };
      idea.content.blocks = idea.content.blocks || [];
      idea.content.blocks = [...idea.content.blocks, ...newBlocks];

      suggestion.applied = true;

      const now = new Date().toISOString();
      idea.updatedAt = now;

      const lastVersion = idea.versionHistory ? idea.versionHistory.length : 0;
      idea.versionHistory = idea.versionHistory || [];
      idea.versionHistory.push({
        version: lastVersion + 1,
        snapshot: { title: idea.title, status: idea.status, content: { blocks: oldBlocks } },
        changedBy: req.user.id || req.user.userId,
        changedAt: now,
        changeSummary: `Sugestao da IA aplicada: "${suggestion.content.slice(0, 50)}${suggestion.content.length > 50 ? '...' : ''}"`
      });

      ideasData.ideas[ideaId] = idea;
      backupJSON(IDEAS_FILE);
      await saveIdeasData(ideasData);

      res.json({
        success: true,
        data: {
          message: 'Sugestao aplicada com sucesso',
          blocksAdded: newBlocks.length,
          blocks: newBlocks,
          idea: idea
        }
      });

    } catch (err) {
      console.error('[IDEAS] Apply AI suggestion error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
