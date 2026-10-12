// ============================================================
// ACTION EXECUTOR v19.0 — MODO CONCIERGE
// Executa ações no backend NEXO via API REST direta
// Cria tarefas, leads, registra pagamentos/despesas
// ============================================================

const fs = require('fs');
const path = require('path');

class ActionExecutor {
  constructor(config = {}) {
    this.apiBase = config.apiBase || 'http://localhost:3456/api';
    this.apiKey = config.apiKey || null;
    this.timeout = config.timeout || 10000;
    this.dataDir = config.dataDir || path.join(__dirname, '../../dashboard/data');
    this.undoService = config.undoService || null;

    // Cache em memória dos dados
    this.cache = {
      tasks: null,
      leads: null,
      cash: null,
      lastFetch: 0
    };

    // Config de integrações (para flags como ignoreWhatsApp)
    this.integrations = this._loadIntegrationsConfig();
  }

  _loadIntegrationsConfig() {
    try {
      const configPath = path.join(this.dataDir, 'config', 'integrations-config.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      console.error('[ActionExecutor] Erro ao ler integrations-config:', e.message);
    }
    return {};
  }

  // ============================================================
  // API PÚBLICA: execute()
  // Recebe ações do IntentParser e executa cada uma
  // ============================================================
  async execute(actions, context = {}) {
    const results = [];
    const authorName = context.authorName || 'Sistema';
    const threadId = context.threadId || null;

    for (const action of actions) {
      try {
        // ── UNDO: captura estado antes de ações destrutivas ──
        let beforeSnapshot = null;
        const isDestructive = this._isDestructiveAction(action.type);
        if (isDestructive && this.undoService && threadId) {
          beforeSnapshot = await this._captureBefore(action);
        }

        const result = await this.executeSingle(action, authorName);
        results.push({ action, status: 'success', result });

        // ── UNDO: salva na stack após sucesso ──
        if (isDestructive && this.undoService && threadId && beforeSnapshot) {
          this.undoService.push(threadId, {
            type: this._undoTypeFromAction(action.type),
            description: this._undoDescription(action, beforeSnapshot),
            before: beforeSnapshot,
            after: null,
            restoreFn: null,
            module: this._undoModuleFromAction(action.type),
          });
        }
      } catch (err) {
        results.push({ action, status: 'error', error: err.message });
      }
    }

    return {
      allSuccess: results.every(r => r.status === 'success'),
      results,
      summary: this.buildSummary(results),
      undoable: results.some(r => r.status === 'success' && this._isDestructiveAction(r.action.type)),
    };
  }

  // Ações que geram entrada de undo
  _isDestructiveAction(type) {
    return ['excluir_tarefa', 'excluir_pagamento', 'excluir_despesa', 'excluir_lead', 'excluir_ideia', 'excluir_projeto', 'excluir_cliente'].includes(type);
  }

  _undoTypeFromAction(type) {
    const map = {
      excluir_tarefa: 'delete_task',
      excluir_pagamento: 'delete_payment',
      excluir_despesa: 'delete_expense',
      excluir_lead: 'delete_lead',
      excluir_ideia: 'delete_idea',
      excluir_projeto: 'delete_project',
      excluir_cliente: 'delete_client',
    };
    return map[type] || type;
  }

  _undoModuleFromAction(type) {
    const map = {
      excluir_tarefa: '/api/tasks',
      excluir_pagamento: '/api/cash/payments',
      excluir_despesa: '/api/cash/expenses',
      excluir_lead: '/api/leads',
      excluir_ideia: '/api/ideas',
      excluir_projeto: '/api/projects',
      excluir_cliente: '/api/clients',
    };
    return map[type] || null;
  }

  _undoDescription(action, before) {
    const name = before?.title || before?.name || before?.displayName || before?.description || 'item';
    const typeMap = {
      excluir_tarefa: 'Excluir tarefa',
      excluir_pagamento: 'Excluir pagamento',
      excluir_despesa: 'Excluir despesa',
      excluir_lead: 'Excluir lead',
      excluir_ideia: 'Excluir ideia',
      excluir_projeto: 'Excluir projeto',
      excluir_cliente: 'Excluir cliente',
    };
    return `${typeMap[action.type] || 'Ação'} "${name}"`;
  }

  // Captura snapshot do item antes da deleção
  async _captureBefore(action) {
    try {
      switch (action.type) {
        case 'excluir_tarefa': {
          const titulo = action.params?.titulo || action.params?.id || '';
          if (!titulo) return null;
          const tasksRes = await this.apiGet('/tasks');
          const tasks = Array.isArray(tasksRes) ? tasksRes : (tasksRes?.tasks || []);
          if (!Array.isArray(tasks)) return null;
          return tasks.find(t => t.id === titulo || t.title?.toLowerCase().includes(titulo.toLowerCase())) || null;
        }
        case 'excluir_pagamento':
        case 'excluir_despesa': {
          const search = action.params?.id || action.params?.de || action.params?.para || action.params?.descricao || '';
          if (!search) return null;
          const cashFile = path.join(this.dataDir, 'cash-box.json');
          const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
          const entry = cash.history?.find(h =>
            h.id === search ||
            h.description?.toLowerCase().includes(search.toLowerCase()) ||
            h.from?.toLowerCase().includes(search.toLowerCase()) ||
            h.to?.toLowerCase().includes(search.toLowerCase())
          );
          return entry || null;
        }
        case 'excluir_lead': {
          const search = action.params?.id || action.params?.nome || action.params?.email || '';
          if (!search) return null;
          const leadsFile = path.join(this.dataDir, 'leads.json');
          const leads = this.readJson(leadsFile, []);
          return leads.find(l =>
            l.id === search ||
            l.name?.toLowerCase().includes(search.toLowerCase()) ||
            l.email?.toLowerCase().includes(search.toLowerCase())
          ) || null;
        }
        case 'excluir_ideia': {
          const search = action.params?.id || action.params?.titulo || '';
          if (!search) return null;
          const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
          const ideasData = this.readJson(ideasFile, { ideas: {} });
          const idea = Object.values(ideasData.ideas || {}).find(i =>
            i.id === search || i.title?.toLowerCase().includes(search.toLowerCase())
          );
          return idea || null;
        }
        default:
          return null;
      }
    } catch (e) {
      console.error('[ActionExecutor] Erro ao capturar before para undo:', e.message);
      return null;
    }
  }

  async executeSingle(action, authorName) {
    switch (action.type) {
      case 'criar_tarefa':
        return await this.createTask(action.params, authorName);
      case 'criar_lead':
        return await this.createLead(action.params, authorName);
      case 'registrar_pagamento':
        return await this.createPayment(action.params, authorName);
      case 'registrar_pagamento_com_split':
        return await this.createPaymentWithSplit(action.params, authorName);
      case 'registrar_despesa':
        return await this.createExpense(action.params, authorName);
      case 'registrar_despesa_com_split':
        return await this.createExpenseWithSplit(action.params, authorName);
      case 'confirmar_tarefa':
        return await this.completeTask(action.params, authorName);
      case 'adicionar_comentario':
        return await this.addTaskComment(action.params, authorName);
      case 'atualizar_status':
        return await this.updateTaskStatus(action.params, authorName);
      case 'consultar_status':
        return await this.getStatus(action.params);
      case 'consultar_tarefas':
        return await this.queryTasks(action.params);
      case 'consultar_leads':
        return await this.queryLeads(action.params);
      case 'consultar_financeiro':
        return await this.queryFinance(action.params);
      case 'consultar_whatsapp':
        return await this.queryWhatsApp(action.params);
      case 'verificar_mencoes':
        return await this.checkMentions(action.params);
      case 'ideia':
        return await this.saveIdea(action.params, authorName);
      case 'link':
        return await this.saveLink(action.params, authorName);
      case 'ajuda':
        return await this.showHelp(action.params, authorName);
      case 'navegar':
        return await this.navigate(action.params, authorName);
      case 'social':
        return { type: 'social', message: 'Oi! 👋 Estou por aqui, pronta pra ajudar. Diga o que precisa!', source: 'executor' };
      case 'excluir_tarefa':
        return await this.deleteTask(action.params, authorName);
      case 'excluir_pagamento':
        return await this.deletePayment(action.params, authorName);
      case 'excluir_despesa':
        return await this.deleteExpense(action.params, authorName);
      case 'excluir_lead':
        return await this.deleteLead(action.params, authorName);
      case 'consultar_emails':
        return await this.queryEmails(action.params);
      case 'atualizar_tarefa':
        return await this.updateTask(action.params, authorName);
      case 'listar_clientes':
        return await this.listClients(action.params);
      case 'criar_cliente':
        return await this.createClient(action.params, authorName);
      case 'atualizar_cliente':
        return await this.updateClient(action.params, authorName);
      case 'excluir_cliente':
        return await this.deleteClient(action.params, authorName);
      case 'listar_projetos':
        return await this.listProjects(action.params);
      case 'atualizar_lead':
        return await this.updateLead(action.params, authorName);
      case 'converter_lead':
        return await this.convertLead(action.params, authorName);
      case 'consultar_caixa':
        return await this.queryCashBox(action.params);
      case 'criar_ideia':
        return await this.createIdea(action.params, authorName);
      case 'listar_ideias':
        return await this.listIdeas(action.params);
      case 'atualizar_ideia':
        return await this.updateIdea(action.params, authorName);
      case 'excluir_ideia':
        return await this.deleteIdea(action.params, authorName);
      case 'converter_ideia_em_tarefa':
        return await this.convertIdeaToTask(action.params, authorName);
      case 'enviar_mensagem_whatsapp':
        return await this.sendWhatsAppMessage(action.params, authorName);
      case 'listar_emails':
        return await this.listEmails(action.params);
      case 'ler_email':
        return await this.readEmail(action.params);
      case 'criar_orcamento':
        return await this.createQuote(action.params, authorName);
      case 'atualizar_orcamento':
        return await this.updateQuote(action.params, authorName);
      case 'deletar_orcamento':
        return await this.deleteQuote(action.params, authorName);
      case 'listar_orcamentos':
        return await this.listQuotes(action.params);
      case 'criar_projeto':
        return await this.createProject(action.params, authorName);
      case 'atualizar_projeto':
        return await this.updateProject(action.params, authorName);
      case 'adicionar_cliente_workspace':
        return await this.addWorkspaceClient(action.params, authorName);
      case 'atualizar_cliente_workspace':
        return await this.updateWorkspaceClient(action.params, authorName);
      case 'enviar_email':
        return await this.sendEmail(action.params, authorName);
      case 'responder_email':
        return await this.replyEmail(action.params, authorName);
      case 'gerar_rascunho_email':
        return await this.draftEmail(action.params, authorName);
      case 'listar_tarefas_por_filtro':
        return await this.listTasksByFilter(action.params);
      case 'excluir_projeto':
        return await this.deleteProject(action.params);
      case 'listar_pagamentos':
        return await this.listPayments(action.params);
      case 'atualizar_pagamento':
        return await this.updatePayment(action.params);
      case 'adicionar_transacao':
        return await this.addTransaction(action.params);
      case 'receber_split':
        return await this.receiveSplit(action.params);
      case 'listar_despesas':
        return await this.listExpenses(action.params);
      case 'atualizar_despesa':
        return await this.updateExpense(action.params);
      case 'pagar_despesa':
        return await this.payExpense(action.params);
      case 'criar_template_despesa':
        return await this.createExpenseTemplate(action.params);
      case 'ajustar_caixa':
        return await this.adjustCashBox(action.params);
      case 'adicionar_entrada_caixa':
        return await this.addCashBoxEntry(action.params);
      case 'listar_historico_caixa':
        return await this.listCashBoxHistory(action.params);
      case 'projecao_caixa':
        return await this.projectCashBox(action.params);
      case 'reconciliar_caixa':
        return await this.reconcileCashBox(action.params);
      case 'comentar_ideia':
        return await this.commentIdea(action.params, authorName);
      case 'criar_ideia_de_template':
        return await this.createIdeaFromTemplate(action.params, authorName);
      case 'listar_templates_ideias':
        return await this.listIdeaTemplates(action.params);
      case 'escanear_whatsapp':
        return await this.scanWhatsApp(action.params);
      case 'limpar_buffer_whatsapp':
        return await this.clearWhatsAppBuffer(action.params);
      case 'ver_historico_whatsapp':
        return await this.viewWhatsAppHistory(action.params);
      case 'ver_classificacoes':
        return await this.viewClassifications(action.params);
      case 'corrigir_classificacao':
        throw new Error('Correção de classificação deve ser feita manualmente pela interface de classificação.');
      case 'marcar_email_lido':
        return await this.markEmailRead(action.params);
      case 'marcar_email_nao_lido':
        return await this.markEmailUnread(action.params);
      case 'favoritar_email':
        return await this.starEmail(action.params);
      case 'arquivar_email':
        return await this.archiveEmail(action.params);
      case 'mover_para_lixeira':
        return await this.trashEmail(action.params);
      case 'marcar_spam':
        return await this.spamEmail(action.params);
      case 'aprovar_rascunho':
        return await this.approveDraft(action.params);
      case 'rejeitar_rascunho':
        return await this.rejectDraft(action.params);
      case 'sugerir_resposta_email':
        return await this.suggestEmailReply(action.params);
      case 'resumir_thread_email':
        return await this.summarizeEmailThread(action.params);
      case 'analizar_email':
        return await this.analyzeEmail(action.params);
      case 'listar_mensagens_instagram':
        return await this.listInstagramMessages(action.params);
      case 'importar_mensagem_instagram':
        return await this.importInstagramMessage(action.params);
      case 'listar_links':
        return await this.listLinks(action.params);
      case 'adicionar_link':
        return await this.addLink(action.params, authorName);
      case 'excluir_link':
        return await this.deleteLink(action.params);
      case 'enriquecer_link':
        return await this.enrichLink(action.params);
      case 'sincronizar_links':
        return await this.syncLinks(action.params);
      case 'criar_alerta_operacao':
        return await this.createOpsAlert(action.params, authorName);
      case 'excluir_alerta_operacao':
        return await this.deleteOpsAlert(action.params);
      case 'registrar_mudanca':
        return await this.registerChange(action.params, authorName);
      case 'ver_logs_stack':
        return await this.viewStackLogs(action.params);
      case 'verificar_stack':
        return await this.checkStack(action.params);
      case 'consultar_log_seguranca':
        return await this.querySecurityLog(action.params);
      case 'atualizar_config_seguranca':
        return await this.updateSecurityConfig(action.params);
      case 'testar_whatsapp_seguranca':
        return await this.testWhatsAppSecurity(action.params);
      case 'listar_notificacoes':
        return await this.listNotifications(action.params);
      case 'marcar_notificacao_lida':
        return await this.markNotificationRead(action.params);
      case 'marcar_todas_lidas':
        return await this.markAllNotificationsRead(action.params);
      case 'excluir_notificacao':
        return await this.deleteNotification(action.params);
      case 'consultar_usuarios':
        return await this.listUsers(action.params);
      case 'trocar_usuario':
        return await this.switchUser(action.params);
      case 'alterar_senha':
        throw new Error('Alteração de senha não é permitida via chat. Use a interface de configurações de conta.');
      case 'listar_repos_github':
        return await this.listGitHubRepos(action.params);
      case 'listar_projetos_vercel':
        return await this.listVercelProjects(action.params);
      case 'executar_comando':
        throw new Error('Execução de comandos não é permitida por segurança.');
      case 'fazer_git_push':
        throw new Error('Git push não é permitido via chat por segurança.');
      case 'listar_relatorios_bug':
        return await this.listBugReports(action.params);
      case 'excluir_relatorio_bug':
        return await this.deleteBugReport(action.params);
      case 'controlar_servico':
        return await this.controlService(action.params);
      // ─── Administração de Sistema ───
      // REMOVIDO: foco no Dashboard, não no PC
      default:
        throw new Error(`Ação não suportada: ${action.type}`);
    }
  }

  // ============================================================
  // AÇÕES: Tarefas
  // ============================================================
  async createTask(params, authorName) {
    const title = params.titulo || params.descricao || params.title || 'Tarefa sem título';
    const description = params.descricao || params.description || title;
    // Mapeia P0/P1/P2 para high/medium/low do backend
    const priorityMap = { P0: 'high', P1: 'medium', P2: 'low' };
    const priority = priorityMap[params.prioridade] || params.priority || 'medium';
    const assignedTo = params.responsavel || params.assignedTo || null;
    const addedBy = authorName?.toLowerCase() || 'sistema';
    // Tipo de tarefa: extrai do texto ou usa padrão
    const typeMap = { 'diaria': 'daily', 'diária': 'daily', 'daily': 'daily',
                      'semanal': 'weekly', 'semanalmente': 'weekly', 'weekly': 'weekly',
                      'mensal': 'monthly', 'mensalmente': 'monthly', 'monthly': 'monthly' };
    let taskType = 'one_time';
    if (params.taskType) {
      taskType = params.taskType;
    } else if (params.type && typeMap[params.type.toLowerCase?.() || params.type]) {
      taskType = typeMap[params.type.toLowerCase?.() || params.type];
    } else {
      const typeText = (description || title || '').toLowerCase();
      for (const [pt, en] of Object.entries(typeMap)) {
        if (typeText.includes(pt)) { taskType = en; break; }
      }
    }
    // Data de prazo
    let dueDate = params.dueDate || params.prazo || null;

    const task = {
      id: Date.now().toString(),
      title,
      description,
      priority,
      status: 'pending',
      taskType,
      dueDate,
      assignedTo,
      addedBy,
      source: 'luna',
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Tentar via API (fonte única de verdade)
    const apiResult = await this.apiPost('/tasks', task);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'task', id: task.id, title, assignedTo, source: 'api' };
    }

    // Não escreve mais no JSON — retorna erro para evitar dual source of truth
    return {
      type: 'task',
      error: true,
      message: `Não consegui criar a tarefa no servidor: ${apiResult?.error || 'erro desconhecido'}`,
      id: task.id,
      title
    };
  }

  async completeTask(params, authorName) {
    const titulo = params.titulo || '';
    if (!titulo) {
      return { type: 'task_done', error: true, message: 'Informe a tarefa para concluir' };
    }

    // 1. Buscar na API primeiro
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks) && apiTasks.length > 0) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    // Procura por similaridade no título
    const match = tasks.find(t => {
      const taskTitle = (t.titulo || t.title || t.body || '').toLowerCase();
      const searchTitle = titulo.toLowerCase();
      return taskTitle.includes(searchTitle) || searchTitle.includes(taskTitle.slice(0, 30));
    });

    if (!match) {
      return {
        type: 'task_done',
        error: true,
        message: `Não encontrei nenhuma tarefa correspondente a "${titulo}". Tente ser mais específico ou verifique o título exato.`
      };
    }

    // 2. Atualizar via API (fonte única de verdade)
    const apiResult = await this.apiPut(`/tasks/${match.id}`, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });

    if (apiResult && !apiResult.error) {
      return { type: 'task_done', id: match.id, titulo: match.title || match.titulo, source: 'api' };
    }

    // Se API falhar, retorna erro (não escreve mais no JSON)
    return {
      type: 'task_done',
      error: true,
      message: `Encontrei a tarefa "${match.title || match.titulo}" mas não consegui atualizar no servidor: ${apiResult?.error || 'erro desconhecido'}`
    };
  }

  async addTaskComment(params, authorName) {
    const taskTitle = params.taskTitle || '';
    const commentText = params.commentText || '';

    // 1. Buscar na API primeiro
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks) && apiTasks.length > 0) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    const match = tasks.find(t => {
      const tTitle = (t.titulo || t.title || t.body || '').toLowerCase();
      const searchTitle = taskTitle.toLowerCase();
      return tTitle.includes(searchTitle) || searchTitle.includes(tTitle.slice(0, 30));
    });

    if (!match) {
      throw new Error(`Tarefa "${taskTitle}" não encontrada`);
    }

    const comment = {
      text: commentText,
      author: authorName,
      createdAt: new Date().toISOString()
    };

    // 2. Enviar via API (fonte única de verdade)
    const apiResult = await this.apiPost(`/tasks/${match.id}/comments`, comment);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'comment', taskId: match.id, taskTitle: match.title || match.titulo, text: commentText, source: 'api' };
    }

    // Não escreve mais no JSON — retorna erro
    throw new Error(`Não consegui adicionar comentário no servidor: ${apiResult?.error || 'erro desconhecido'}`);
  }

  async updateTaskStatus(params, authorName) {
    const taskTitle = params.taskTitle || '';
    const status = params.status || 'pending';

    // 1. Buscar na API primeiro
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks) && apiTasks.length > 0) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    const match = tasks.find(t => {
      const tTitle = (t.titulo || t.title || t.body || '').toLowerCase();
      const searchTitle = taskTitle.toLowerCase();
      return tTitle.includes(searchTitle) || searchTitle.includes(tTitle.slice(0, 30));
    });

    if (!match) {
      throw new Error(`Tarefa "${taskTitle}" não encontrada`);
    }

    // 2. Atualizar via API (fonte única de verdade)
    const apiResult = await this.apiPut(`/tasks/${match.id}`, { status });
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'status_update', taskId: match.id, taskTitle: match.title || match.titulo, status, source: 'api' };
    }

    // Não escreve mais no JSON — retorna erro
    throw new Error(`Não consegui atualizar a tarefa no servidor: ${apiResult?.error || 'erro desconhecido'}`);
  }

  // ============================================================
  // AÇÕES: Leads
  // ============================================================
  async createLead(params, authorName) {
    const displayName = params.nome || params.cliente || params.displayName || 'Lead não identificado';
    const notes = params.contexto || params.descricao || params.notes || `Lead registrado por ${authorName}`;
    const phone = params.telefone || params.phone || '';
    const email = params.email || '';

    const lead = {
      displayName,
      email,
      phone,
      source: 'luna',
      notes,
      assignedTo: params.assignedTo || null,
      tags: []
    };

    const apiResult = await this.apiPost('/leads', lead);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'lead', id: apiResult.lead?.id || apiResult.id, displayName, source: 'api' };
    }

    // Fallback: salvar no clients-registry (schema dir)
    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const registry = this.readJson(clientsFile, { clients: {}, schema: { version: '16.1.0' } });
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    registry.clients[id] = {
      displayName,
      email,
      phone,
      source: 'luna',
      type: 'lead',
      status: 'potencial',
      pipelineStatus: 'novo',
      estimatedValue: 0,
      currency: 'EUR',
      notes,
      assignedTo: params.assignedTo || null,
      tags: [],
      createdAt: new Date().toISOString()
    };
    this.writeJson(clientsFile, registry);

    return { type: 'lead', id, displayName, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Financeiro
  // ============================================================
  async createPayment(params, authorName) {
    const amount = parseFloat(params.valor) || 0;
    const de = params.de || params.cliente || params.from || 'Não identificado';
    const description = params.descricao || params.description || `Pagamento de ${de}`;

    if (amount <= 0) throw new Error('Valor do pagamento inválido');

    const entry = {
      amount,
      description,
      date: new Date().toISOString().slice(0, 10),
      source: de,
      category: 'receita',
      note: `Registrado por ${authorName} via Luna`,
      applyImmediately: true,
      recordedBy: authorName
    };

    const apiResult = await this.apiPost('/cash-box/payments', entry);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      const entryData = apiResult.entry || {};
      const dist = entryData.distribution || {};
      const splits = {};
      if (dist.splits && Array.isArray(dist.splits)) {
        dist.splits.forEach(s => {
          let key = s.recipientId;
          if (key === 'nexo-digital') key = 'empresa';
          else if (key === 'nexo-abner-001') key = 'abner';
          else if (key === 'nexo-enoque-001') key = 'nonoke';
          else if (key === 'nexo-elias-pessoal') key = 'elias';
          if (key) splits[key] = s.amount;
        });
      }
      return {
        type: 'payment',
        id: entryData.id || apiResult.id,
        amount,
        de,
        source: 'api',
        splits: Object.keys(splits).length > 0 ? splits : undefined
      };
    }

    // Fallback manual com distribuição 4-way
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    const oldBalance = parseFloat((cash.balance?.value || 0).toFixed(2));
    const newBalance = parseFloat((oldBalance + amount).toFixed(2));
    const id = `etx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cash.balance = { value: newBalance, currency: 'EUR' };
    cash.history = cash.history || [];
    const share = parseFloat((amount * 0.25).toFixed(2));
    const now = new Date().toISOString();
    cash.history.push({
      id,
      date: new Date().toISOString().slice(0, 10),
      type: 'payment_received',
      amount,
      source: de,
      description,
      balanceAfter: newBalance,
      recordedBy: authorName,
      recordedAt: now,
      applyImmediately: true,
      distribution: [
        { recipient: 'Abner', amount: share, type: 'founder_share' },
        { recipient: 'Nonoke', amount: share, type: 'founder_share' },
        { recipient: 'Elias', amount: share, type: 'founder_share' },
        { recipient: 'NEXO Digital', amount: share, type: 'reinvestment' }
      ]
    });
    this.writeJson(cashFile, cash);

    return {
      type: 'payment',
      id,
      amount,
      de,
      source: 'file',
      splits: { abner: share, nonoke: share, elias: share, empresa: share }
    };
  }

  async createExpense(params, authorName) {
    const amount = parseFloat(params.valor) || 0;
    const para = params.para || params.descricao || params.description || params.to || 'Despesa';
    const description = params.descricao || params.description || para;

    if (amount <= 0) throw new Error('Valor da despesa inválido');

    const entry = {
      type: 'expense',
      amount,
      description,
      date: new Date().toISOString().slice(0, 10),
      category: 'despesa',
      note: `Registrado por ${authorName} via Luna`,
      recordedBy: authorName
    };

    const apiResult = await this.apiPost('/cash-box/entries', entry);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'expense', id: apiResult.entry?.id || apiResult.id, amount, para, source: 'api' };
    }

    // Fallback manual
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    const oldBalance = parseFloat((cash.balance?.value || 0).toFixed(2));
    const newBalance = parseFloat((oldBalance - amount).toFixed(2));
    const id = `etx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cash.balance = { value: newBalance, currency: 'EUR' };
    cash.history = cash.history || [];
    cash.history.push({
      id,
      date: new Date().toISOString().slice(0, 10),
      type: 'expense',
      amount,
      source: para,
      description,
      balanceAfter: newBalance,
      recordedBy: authorName,
      recordedAt: new Date().toISOString()
    });
    this.writeJson(cashFile, cash);

    return { type: 'expense', id, amount, para, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Ideias e Links (low-risk, auto-save)
  // ============================================================
  async saveIdea(params, authorName) {
    const texto = params.texto || params.descricao || 'Ideia';

    const idea = {
      id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      body: texto,
      author: authorName,
      time: new Date().toISOString(),
      origem: 'whatsapp_luna'
    };

    const ideasFile = path.join(this.dataDir, 'ideas.json');
    const ideas = this.readJson(ideasFile, []);
    ideas.push(idea);
    this.writeJson(ideasFile, ideas);

    return { type: 'idea', id: idea.id, texto, source: 'file' };
  }

  async saveLink(params, authorName) {
    const url = params.url || '';
    const contexto = params.contexto || params.descricao || '';

    if (!url) throw new Error('URL não fornecida');

    const link = {
      id: `link_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      url,
      context: contexto,
      author: authorName,
      time: new Date().toISOString(),
      origem: 'whatsapp_luna'
    };

    const linksFile = path.join(this.dataDir, 'links.json');
    const links = this.readJson(linksFile, []);
    links.push(link);
    this.writeJson(linksFile, links);

    return { type: 'link', id: link.id, url, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Sistema (ajuda, navegação)
  // ============================================================
  async showHelp(params, authorName) {
    return {
      type: 'help',
      message: `Oi, ${authorName.split(' ')[0]}! 👋 Aqui está o que posso fazer:\n\n` +
        `📋 Tarefas: criar, listar, concluir, atribuir\n` +
        `💰 Financeiro: registrar pagamento/despesa, consultar caixa, listar\n` +
        `📁 Projetos: criar, listar\n` +
        `📧 Email: responder, marcar lido, listar não lidos, criar rascunho\n` +
        `💬 WhatsApp: enviar mensagem, verificar menções\n` +
        `💡 Ideias: criar, listar\n` +
        `🔗 Links: listar\n` +
        `🔔 Notificações: listar\n\n` +
        `É só falar naturalmente, tipo "cria tarefa urgente" ou "quanto temos no caixa"!`,
      source: 'file'
    };
  }

  async navigate(params, authorName) {
    const destino = params.destino || params.pagina || '/dashboard';
    return {
      type: 'navigate',
      destino,
      message: `Redirecionando para ${destino}...`,
      source: 'file'
    };
  }

  // ============================================================
  // AÇÕES: Destrutivas (Delete)
  // ============================================================
  async deleteTask(params, authorName) {
    const titulo = params.titulo || params.id || '';
    if (!titulo) throw new Error('Informe a tarefa para excluir');

    // 1. Buscar na API primeiro
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks) && apiTasks.length > 0) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    const match = tasks.find(t => {
      if (params.id && t.id === params.id) return true;
      if (!titulo.trim()) return false; // não faz match com título vazio
      const taskTitle = (t.titulo || t.title || '').toLowerCase();
      const searchTitle = titulo.toLowerCase();
      return taskTitle.includes(searchTitle) || searchTitle.includes(taskTitle.slice(0, 30));
    });

    if (!match) throw new Error(`Tarefa "${titulo}" não encontrada`);

    // 2. Deletar via API (fonte única de verdade)
    const apiResult = await this.apiDelete(`/tasks/${match.id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'task_deleted', id: match.id, titulo: match.title || match.titulo, source: 'api' };
    }

    // Se API falhar, retorna erro (não deleta mais do JSON)
    throw new Error(`Não consegui excluir a tarefa no servidor: ${apiResult?.error || 'erro desconhecido'}`);
  }

  async deletePayment(params, authorName) {
    const search = params.id || params.de || params.cliente || '';
    if (!search) throw new Error('Informe o pagamento para excluir');

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });

    const idx = cash.history.findIndex(h => {
      if (h.id === search) return true;
      const src = (h.source || h.description || '').toLowerCase();
      return src.includes(search.toLowerCase());
    });

    if (idx === -1) throw new Error(`Pagamento "${search}" não encontrado`);

    const removed = cash.history.splice(idx, 1)[0];
    // Reverte o saldo
    if (removed.type === 'payment_received') {
      cash.balance.value = parseFloat(((cash.balance?.value || 0) - removed.amount).toFixed(2));
    }
    this.writeJson(cashFile, cash);

    return { type: 'payment_deleted', id: removed.id, description: removed.description || removed.source || undefined, amount: removed.amount, source: 'file' };
  }

  async deleteExpense(params, authorName) {
    const search = params.id || params.para || params.descricao || '';
    if (!search) throw new Error('Informe a despesa para excluir');

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });

    const idx = cash.history.findIndex(h => {
      if (h.id === search) return true;
      const src = (h.source || h.description || '').toLowerCase();
      return src.includes(search.toLowerCase());
    });

    if (idx === -1) throw new Error(`Despesa "${search}" não encontrada`);

    const removed = cash.history.splice(idx, 1)[0];
    // Reverte o saldo
    if (removed.type === 'expense') {
      cash.balance.value = parseFloat(((cash.balance?.value || 0) + removed.amount).toFixed(2));
    }
    this.writeJson(cashFile, cash);

    return { type: 'expense_deleted', id: removed.id, description: removed.description || removed.source || undefined, amount: removed.amount, source: 'file' };
  }

  async deleteLead(params, authorName) {
    const search = params.nome || params.id || '';
    if (!search) throw new Error('Informe o lead para excluir');

    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const registry = this.readJson(clientsFile, { clients: {}, schema: { version: '16.1.0' } });

    const idToDelete = Object.keys(registry.clients || {}).find(id => {
      if (id === search) return true;
      const c = registry.clients[id];
      const name = (c.displayName || c.name || '').toLowerCase();
      return name.includes(search.toLowerCase());
    });

    if (!idToDelete) throw new Error(`Lead "${search}" não encontrado`);

    const removed = registry.clients[idToDelete];
    delete registry.clients[idToDelete];
    this.writeJson(clientsFile, registry);

    return { type: 'lead_deleted', id: idToDelete, nome: removed.displayName || removed.name, source: 'file' };
  }

  async queryEmails(params) {
    const apiResult = await this.apiGet('/email/messages?maxResults=10');
    if (apiResult && !apiResult.error && Array.isArray(apiResult.messages)) {
      const unread = apiResult.messages.filter(m => !m.read);
      return {
        type: 'emails',
        filtro: params.filtro || 'todos',
        total: apiResult.messages.length,
        naoLidos: unread.length,
        items: apiResult.messages.slice(0, 5).map(m => ({
          id: m.id,
          subject: m.subject || '(sem assunto)',
          from: m.from || 'Desconhecido',
          snippet: m.snippet || m.body?.text?.slice(0, 100) || m.body?.html?.slice(0, 100) || '',
          unread: !m.read
        }))
      };
    }

    // Fallback: retorna vazio se API falhar
    return { type: 'emails', filtro: params.filtro || 'todos', total: 0, naoLidos: 0, items: [], source: 'fallback' };
  }

  // ============================================================
  // AÇÕES: Status/Consulta
  // ============================================================
  async getStatus(params) {
    const filtro = params.filtro || 'geral';

    // 1. Buscar tarefas da API (fonte única de verdade)
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks)) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const cashFile = path.join(this.dataDir, 'cash-box.json');

    const clientsRegistry = this.readJson(clientsFile, { clients: {} });
    const leads = Object.values(clientsRegistry.clients || {}).filter(c => c.type === 'lead' || c.status === 'potencial');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });

    const pendentes = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const p0 = pendentes.filter(t => (t.priority || '').toLowerCase() === 'high' || (t.prioridade || '').toUpperCase() === 'P0');
    const p1 = pendentes.filter(t => (t.priority || '').toLowerCase() === 'medium' || (t.prioridade || '').toUpperCase() === 'P1');

    const saldo = cash.balance?.value || 0;

    return {
      type: 'status',
      filtro,
      tarefas: { total: tasks.length, pendentes: pendentes.length, p0: p0.length, p1: p1.length },
      leads: { total: leads.length, novos: leads.filter(l => l.pipelineStatus === 'novo' || l.status === 'novo').length },
      financeiro: { saldo }
    };
  }

  // ============================================================
  // AÇÕES: Consultas avançadas (Consciência do Dashboard)
  // ============================================================
  async queryTasks(params) {
    // 1. Buscar tarefas da API (fonte única de verdade)
    const apiTasks = await this.apiGet('/tasks');
    let all = [];
    if (Array.isArray(apiTasks)) {
      all = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      const companyTasksFile = path.join(this.dataDir, 'company-tasks.json');
      const tasks = this.readJson(tasksFile, []);
      const companyTasksRaw = this.readJson(companyTasksFile, {});
      const companyTasks = Array.isArray(companyTasksRaw) ? companyTasksRaw : Object.values(companyTasksRaw.categories || {}).flatMap(c => c.tasks || []);
      all = [...tasks, ...companyTasks];
    }

    const filtro = params.filtro || 'pendentes';

    let result = all;
    if (filtro === 'pendentes') result = all.filter(t => t.status !== 'completed' && t.status !== 'done' && !t.completed);
    if (filtro === 'p0') result = all.filter(t => (t.priority === 'P0' || t.priority === 'high' || t.prioridade === 'P0'));
    if (filtro === 'hoje') {
      const today = new Date().toISOString().slice(0, 10);
      result = all.filter(t => t.dueDate && t.dueDate.startsWith(today));
    }

    return {
      type: 'tasks',
      filtro,
      total: result.length,
      items: result.slice(0, 10).map(t => ({
        id: t.id,
        title: t.title || t.titulo || 'Sem título',
        priority: t.priority || t.prioridade || 'P2',
        status: t.status || 'pending',
        assignedTo: t.assignedTo || t.responsavel || null
      }))
    };
  }

  async queryLeads(params) {
    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const clients = this.readJson(clientsFile, { clients: {} });
    const all = Object.values(clients.clients || {});
    const leads = all.filter(c => c.type === 'lead' || c.status === 'potencial' || c.pipelineStatus);
    const filtro = params.filtro || 'todos';

    let result = leads;
    if (filtro === 'novos') result = leads.filter(l => l.pipelineStatus === 'novo' || l.status === 'novo');
    if (filtro === 'proposta') result = leads.filter(l => l.pipelineStatus === 'proposta' || l.status === 'proposta');

    return {
      type: 'leads',
      filtro,
      total: result.length,
      items: result.slice(0, 10).map(l => ({
        id: l.id,
        name: l.name || l.nome || 'Lead',
        pipelineStatus: l.pipelineStatus || l.status || 'novo'
      }))
    };
  }

  async queryFinance(params) {
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const paymentsFile = path.join(this.dataDir, 'payments.json');
    const expensesFile = path.join(this.dataDir, 'expenses.json');

    const cash = this.readJson(cashFile, { balance: { value: 0 }, history: [] });
    const payments = this.readJson(paymentsFile, []);
    const expenses = this.readJson(expensesFile, []);

    const pendingPayments = payments.filter(p => p.status !== 'paid' && p.status !== 'received');
    const totalPending = pendingPayments.reduce((s, p) => s + parseFloat(p.totalAmount || p.amount || 0), 0);

    const today = new Date();
    const monthPrefix = today.toISOString().slice(0, 7);
    const monthlyExpenses = expenses.filter(e => {
      const d = e.date || e.createdAt || '';
      return d.startsWith(monthPrefix);
    });
    const totalExpenses = monthlyExpenses.reduce((s, e) => s + parseFloat(e.amount || e.valor || 0), 0);

    return {
      type: 'finance',
      caixa: cash.balance?.value || 0,
      recebimentosPendentes: totalPending,
      clientesPendentes: pendingPayments.length,
      gastosMes: totalExpenses,
      transacoes: cash.history?.slice(-5).map(h => ({
        type: h.type,
        amount: h.amount,
        description: h.description || h.note || ''
      })) || []
    };
  }

  async queryWhatsApp(params) {
    const wcfg = this.integrations.whatsapp || {};
    const ignoreAll = wcfg.ignored === true;
    const ignoreMessages = wcfg.ignoreMessages !== false;
    const ignoreLinks = wcfg.ignoreLinks === true;
    const ignoreMentions = wcfg.ignoreMentions === true;

    if (ignoreAll) {
      return { type: 'whatsapp', ignored: true, mensagensNovas: 0, linksPendentes: 0, mencoesTotais: 0, mencoesPendentes: 0, mencoesRecentes: [] };
    }

    const bufferFile = path.join(this.dataDir, 'luna-buffer.json');
    const historyFile = path.join(this.dataDir, 'whatsapp-history.json');
    const buffer = this.readJson(bufferFile, { newMessages: [], newLinks: [], mentions: [] });
    const history = this.readJson(historyFile, []);

    const mentions = history.filter(m => /@(?:LUNA|KIMI|KIMICLAW)/i.test(m.body || m.text || ''));
    const pendingMentions = mentions.filter(m => !m.responded);

    return {
      type: 'whatsapp',
      mensagensNovas: ignoreMessages ? 0 : (buffer.newMessages?.length || 0),
      linksPendentes: ignoreLinks ? 0 : (buffer.newLinks?.length || 0),
      mencoesTotais: ignoreMentions ? 0 : mentions.length,
      mencoesPendentes: ignoreMentions ? 0 : pendingMentions.length,
      mencoesRecentes: ignoreMentions ? [] : pendingMentions.slice(0, 5).map(m => ({
        from: m.author || m.from || 'Desconhecido',
        text: (m.body?.text || m.body || m.text || '').slice(0, 100)
      }))
    };
  }

  async checkMentions(params) {
    const wcfg = this.integrations.whatsapp || {};
    if (wcfg.ignored === true) {
      return { type: 'whatsapp', ignored: true, mensagensNovas: 0, linksPendentes: 0, mencoesTotais: 0, mencoesPendentes: 0, mencoesRecentes: [] };
    }
    return await this.queryWhatsApp(params);
  }

  // ============================================================
  // AÇÕES: Financeiro Avançado (Split Automático)
  // ============================================================
  async createPaymentWithSplit(params, authorName) {
    const amount = parseFloat(params.valor) || 0;
    const client = params.de || params.cliente || params.from || 'Cliente';
    const description = params.descricao || `Pagamento de ${client}`;
    if (amount <= 0) throw new Error('Valor inválido');

    const entry = {
      amount,
      description,
      source: client,
      date: new Date().toISOString().slice(0, 10),
      applyImmediately: true,
      note: `Registrado por ${authorName} via Luna (com split automático)`
    };

    const apiResult = await this.apiPost('/cash-box/payments', entry);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      const entryData = apiResult.entry || {};
      const dist = entryData.distribution || {};
      const splits = {};
      if (dist.splits && Array.isArray(dist.splits)) {
        dist.splits.forEach(s => {
          let key = s.recipientId;
          if (key === 'nexo-digital') key = 'empresa';
          else if (key === 'nexo-abner-001') key = 'abner';
          else if (key === 'nexo-enoque-001') key = 'nonoke';
          else if (key === 'nexo-elias-pessoal') key = 'elias';
          if (key) splits[key] = s.amount;
        });
      }
      return {
        type: 'payment_split',
        amount,
        client,
        applied: true,
        source: 'api',
        id: entryData.id || apiResult.id,
        splits: Object.keys(splits).length > 0 ? splits : undefined
      };
    }

    // Fallback: escreve no cash-box.json manualmente com split
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0 }, history: [] });
    const share = parseFloat((amount / 4).toFixed(2));
    const remaining = parseFloat((amount - share * 3).toFixed(2));

    cash.balance.value = parseFloat(((cash.balance?.value || 0) + remaining).toFixed(2));
    cash.history.push({
      type: 'payment_received',
      amount,
      description: `${description} (split 25%)`,
      date: new Date().toISOString(),
      recordedBy: authorName,
      distribution: [
        { recipient: 'Abner', amount: share, type: 'founder_share' },
        { recipient: 'Nonoke', amount: share, type: 'founder_share' },
        { recipient: 'Elias', amount: share, type: 'founder_share' },
        { recipient: 'NEXO Digital', amount: remaining, type: 'reinvestment' }
      ]
    });
    this.writeJson(cashFile, cash);

    return { type: 'payment_split', amount, client, applied: true, source: 'file', splits: { abner: share, nonoke: share, elias: share, empresa: remaining } };
  }

  async createExpenseWithSplit(params, authorName) {
    const amount = parseFloat(params.valor) || 0;
    const description = params.descricao || params.para || 'Despesa';
    const splitAmong = params.splitAmong || ['abner', 'nonoke', 'elias'];
    if (amount <= 0) throw new Error('Valor inválido');

    const entry = {
      name: description,
      amount,
      description,
      date: new Date().toISOString().slice(0, 10),
      type: 'one_time',
      splitAmong,
      paidBy: {},
      autoDeductFromCashBox: true,
      note: `Registrado por ${authorName} via Luna`
    };

    splitAmong.forEach(pid => {
      entry.paidBy[pid] = { paid: false, amount: parseFloat((amount / splitAmong.length).toFixed(2)), paidAt: null, method: null };
    });

    const apiResult = await this.apiPost('/expenses', entry);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'expense_split', amount, description, splitAmong, source: 'api', id: apiResult.id || apiResult.expense?.id };
    }

    // Fallback: cash-box.json
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0 }, history: [] });
    cash.balance.value = parseFloat(((cash.balance?.value || 0) - amount).toFixed(2));
    cash.history.push({
      type: 'expense',
      amount,
      description: `${description} (split entre ${splitAmong.join(', ')})`,
      date: new Date().toISOString(),
      recordedBy: authorName
    });
    this.writeJson(cashFile, cash);

    return { type: 'expense_split', amount, description, splitAmong, source: 'file' };
  }

  // ============================================================
  // API HELPERS
  // ============================================================
  async apiPost(endpoint, data) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const fetchPromise = fetch(`${this.apiBase}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.timeout)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `HTTP ${res.status}: ${text}` };
      }

      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  }

  async apiGet(endpoint) {
    try {
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const fetchPromise = fetch(`${this.apiBase}${endpoint}`, { headers });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.timeout)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);

      if (!res.ok) return { error: `HTTP ${res.status}` };
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  }

  async apiPut(endpoint, data) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const fetchPromise = fetch(`${this.apiBase}${endpoint}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data)
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.timeout)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `HTTP ${res.status}: ${text}` };
      }

      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  }

  async apiDelete(endpoint) {
    try {
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const fetchPromise = fetch(`${this.apiBase}${endpoint}`, { method: 'DELETE', headers });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.timeout)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Tarefas
  // ============================================================
  async updateTask(params, authorName) {
    const id = params.id;
    const titulo = params.titulo || params.title;
    if (!id && !titulo) throw new Error('ID ou título da tarefa necessário');

    // 1. Buscar na API primeiro
    const apiTasks = await this.apiGet('/tasks');
    let tasks = [];
    if (Array.isArray(apiTasks) && apiTasks.length > 0) {
      tasks = apiTasks;
    } else {
      // Fallback: ler do JSON legado (apenas leitura)
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      tasks = this.readJson(tasksFile, []);
    }

    let task = tasks.find(t => t.id === id);
    if (!task && titulo) task = tasks.find(t => (t.title || t.titulo || '').toLowerCase().includes(titulo.toLowerCase()));
    if (!task) throw new Error('Tarefa não encontrada');

    if (params.titulo || params.title) task.title = params.titulo || params.title;
    if (params.descricao || params.description) task.description = params.descricao || params.description;
    if (params.prioridade || params.priority) {
      const priorityMap = { P0: 'high', P1: 'medium', P2: 'low' };
      task.priority = priorityMap[params.prioridade] || params.priority || task.priority;
    }
    if (params.responsavel || params.assignedTo !== undefined) task.assignedTo = params.responsavel || params.assignedTo;
    if (params.prazo || params.dueDate) task.dueDate = params.prazo || params.dueDate;
    if (params.status) task.status = params.status;
    task.updatedAt = new Date().toISOString();

    // 2. Atualizar via API (fonte única de verdade)
    const apiResult = await this.apiPut(`/tasks/${task.id}`, task);
    if (apiResult && !apiResult.error) {
      return { type: 'task_updated', id: task.id, title: task.title, source: 'api' };
    }

    // Não escreve mais no JSON — retorna erro
    throw new Error(`Não consegui atualizar a tarefa no servidor: ${apiResult?.error || 'erro desconhecido'}`);
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Clientes
  // ============================================================
  async listClients(params) {
    const apiResult = await this.apiGet('/workspace/clients');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(c => ({ ...c, display: `ID: ${c.id} | Nome: ${c.name || c.displayName || 'Sem nome'}` }));
      return { type: 'clients', items, source: 'api' };
    }
    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(clientsFile, { clients: {} });
    const items = Object.values(data.clients || {}).map(c => ({ ...c, display: `ID: ${c.id} | Nome: ${c.name || c.displayName || 'Sem nome'}` }));
    return { type: 'clients', items, source: 'file' };
  }

  async createClient(params, authorName) {
    const client = {
      id: `client_${Date.now()}`,
      name: params.nome || params.name || 'Cliente sem nome',
      email: params.email || '',
      phone: params.telefone || params.phone || '',
      type: params.tipo || 'lead',
      status: params.status || 'ativo',
      notes: params.notas || params.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/workspace/clients', client);
    if (apiResult && !apiResult.error) {
      return { type: 'client', id: client.id, name: client.name, source: 'api' };
    }

    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(clientsFile, { clients: {} });
    data.clients = data.clients || {};
    data.clients[client.id] = client;
    this.writeJson(clientsFile, data);
    return { type: 'client', id: client.id, name: client.name, source: 'file' };
  }

  async updateClient(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do cliente necessário');
    const updates = {};
    if (params.nome || params.name) updates.name = params.nome || params.name;
    if (params.email) updates.email = params.email;
    if (params.telefone || params.phone) updates.phone = params.telefone || params.phone;
    if (params.status) updates.status = params.status;
    if (params.notas || params.notes) updates.notes = params.notas || params.notes;
    updates.updatedAt = new Date().toISOString();

    const apiResult = await this.apiPut(`/workspace/clients/${id}`, updates);
    if (apiResult && !apiResult.error) return { type: 'client_updated', id, source: 'api' };

    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(clientsFile, { clients: {} });
    if (data.clients[id]) {
      Object.assign(data.clients[id], updates);
      this.writeJson(clientsFile, data);
      return { type: 'client_updated', id, name: data.clients[id].name, source: 'file' };
    }
    throw new Error('Cliente não encontrado');
  }

  async deleteClient(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do cliente necessário');

    const apiResult = await this.apiDelete(`/workspace/clients/${id}`);
    if (apiResult && !apiResult.error) return { type: 'client_deleted', id, source: 'api' };

    const clientsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(clientsFile, { clients: {} });
    const name = data.clients[id]?.name;
    delete data.clients[id];
    this.writeJson(clientsFile, data);
    return { type: 'client_deleted', id, name, source: 'file' };
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Projetos
  // ============================================================
  async listProjects(params) {
    const apiResult = await this.apiGet('/projects');
    if (apiResult && !apiResult.error && apiResult.projects) {
      const items = apiResult.projects.map(p => ({ ...p, display: `ID: ${p.id} | Nome: ${p.name || p.title || 'Sem nome'}` }));
      return { type: 'projects', items, source: 'api' };
    }
    const projectsFile = path.join(this.dataDir, 'schema', 'projects-registry.json');
    const data = this.readJson(projectsFile, { projects: {} });
    const items = Object.values(data.projects || {}).map(p => ({ ...p, display: `ID: ${p.id} | Nome: ${p.name || p.title || 'Sem nome'}` }));
    return { type: 'projects', items, source: 'file' };
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Leads
  // ============================================================
  async updateLead(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do lead necessário');
    const updates = {};
    if (params.nome || params.name) updates.name = params.nome || params.name;
    if (params.email) updates.email = params.email;
    if (params.telefone || params.phone) updates.phone = params.telefone || params.phone;
    if (params.status) updates.status = params.status;
    if (params.pipelineStatus) updates.pipelineStatus = params.pipelineStatus;
    updates.updatedAt = new Date().toISOString();

    const apiResult = await this.apiPut(`/leads/${id}`, updates);
    if (apiResult && !apiResult.error) return { type: 'lead_updated', id, source: 'api' };

    const leadsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(leadsFile, { clients: {} });
    const lead = Object.values(data.clients || {}).find(c => c.id === id && (c.type === 'lead' || c.status === 'potencial'));
    if (lead) {
      Object.assign(lead, updates);
      this.writeJson(leadsFile, data);
      return { type: 'lead_updated', id, name: lead.name || lead.displayName, source: 'file' };
    }
    throw new Error('Lead não encontrado');
  }

  async convertLead(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do lead necessário');

    const apiResult = await this.apiPost(`/leads/${id}/convert`, {});
    if (apiResult && !apiResult.error) return { type: 'lead_converted', id, source: 'api' };

    const leadsFile = path.join(this.dataDir, 'schema', 'clients-registry.json');
    const data = this.readJson(leadsFile, { clients: {} });
    if (data.clients[id]) {
      data.clients[id].type = 'cliente';
      data.clients[id].status = 'ativo';
      data.clients[id].convertedAt = new Date().toISOString();
      this.writeJson(leadsFile, data);
      return { type: 'lead_converted', id, name: data.clients[id].name, source: 'file' };
    }
    throw new Error('Lead não encontrado');
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Caixa
  // ============================================================
  async queryCashBox(params) {
    const apiResult = await this.apiGet('/cash-box');
    if (apiResult && !apiResult.error) {
      return { type: 'cash_box', balance: apiResult.balance, history: apiResult.history?.slice(-5), source: 'api' };
    }
    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const data = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    return { type: 'cash_box', balance: data.balance, history: data.history?.slice(-5), source: 'file' };
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Ideias
  // ============================================================
  async createIdea(params, authorName) {
    const idea = {
      id: `idea_${Date.now()}`,
      title: params.titulo || params.title || 'Ideia sem título',
      content: params.conteudo || params.content || '',
      status: params.status || 'draft',
      priority: params.prioridade || 'medium',
      tags: params.tags || [],
      author: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/ideas', idea);
    if (apiResult && apiResult.success) {
      return { type: 'idea', id: apiResult.data?.id || idea.id, title: idea.title, source: 'api' };
    }

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { _schema: 'ideas-v1', ideas: [], templates: [], categories: [] });
    data.ideas = data.ideas || [];
    data.ideas.push(idea);
    this.writeJson(ideasFile, data);
    return { type: 'idea', id: idea.id, title: idea.title, source: 'file' };
  }

  async listIdeas(params) {
    const apiResult = await this.apiGet('/ideas');
    if (apiResult && apiResult.success && apiResult.data?.ideas) {
      const items = apiResult.data.ideas.map(i => ({ ...i, display: `ID: ${i.id} | Nome: ${i.title || 'Sem nome'}` }));
      return { type: 'ideas', items, source: 'api' };
    }
    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: [] });
    const items = (data.ideas || []).map(i => ({ ...i, display: `ID: ${i.id} | Nome: ${i.title || 'Sem nome'}` }));
    return { type: 'ideas', items, source: 'file' };
  }

  async updateIdea(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID da ideia necessário');
    const updates = {};
    if (params.titulo || params.title) updates.title = params.titulo || params.title;
    if (params.conteudo || params.content) updates.content = params.conteudo || params.content;
    if (params.status) updates.status = params.status;
    if (params.prioridade || params.priority) updates.priority = params.prioridade || params.priority;
    if (params.tags) updates.tags = params.tags;
    updates.updatedAt = new Date().toISOString();

    const apiResult = await this.apiPut(`/ideas/${id}`, updates);
    if (apiResult && apiResult.success) return { type: 'idea_updated', id, source: 'api' };

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: [] });
    const idea = (data.ideas || []).find(i => i.id === id);
    if (idea) {
      Object.assign(idea, updates);
      this.writeJson(ideasFile, data);
      return { type: 'idea_updated', id, title: idea.title, source: 'file' };
    }
    throw new Error('Ideia não encontrada');
  }

  async deleteIdea(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID da ideia necessário');

    const apiResult = await this.apiDelete(`/ideas/${id}`);
    if (apiResult && apiResult.success) return { type: 'idea_deleted', id, source: 'api' };

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: [] });
    const idx = (data.ideas || []).findIndex(i => i.id === id);
    if (idx >= 0) {
      const title = data.ideas[idx].title;
      data.ideas.splice(idx, 1);
      this.writeJson(ideasFile, data);
      return { type: 'idea_deleted', id, title, source: 'file' };
    }
    throw new Error('Ideia não encontrada');
  }

  async convertIdeaToTask(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID da ideia necessário');

    const apiResult = await this.apiPost(`/ideas/${id}/convert-task`, { assignedTo: params.responsavel || null });
    if (apiResult && apiResult.success) {
      return { type: 'idea_converted', id, taskId: apiResult.data?.taskId, source: 'api' };
    }

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: [] });
    const idea = (data.ideas || []).find(i => i.id === id);
    if (!idea) throw new Error('Ideia não encontrada');

    const taskResult = await this.createTask({
      titulo: idea.title,
      descricao: idea.content,
      prioridade: idea.priority || 'P2',
      responsavel: params.responsavel || null
    }, authorName);

    idea.status = 'converted';
    idea.convertedToTaskId = taskResult.id;
    idea.updatedAt = new Date().toISOString();
    this.writeJson(ideasFile, data);

    return { type: 'idea_converted', id, taskId: taskResult.id, source: 'file' };
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: WhatsApp
  // ============================================================
  async sendWhatsAppMessage(params, authorName) {
    const to = params.para || params.to;
    const text = params.texto || params.text || params.mensagem || params.message;
    if (!to || !text) throw new Error('Número e mensagem necessários');

    const apiResult = await this.apiPost('/whatsapp/send', { to, body: text });
    if (apiResult && !apiResult.error) {
      return { type: 'whatsapp_sent', to, text: text.substring(0, 50), source: 'api' };
    }
    throw new Error('Não foi possível enviar mensagem via WhatsApp');
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Email
  // ============================================================
  async listEmails(params) {
    const query = params.label || params.filtro || 'INBOX';
    const apiResult = await this.apiGet(`/email/messages?labelIds=${query}&maxResults=10`);
    if (apiResult && !apiResult.error && apiResult.messages) {
      const items = apiResult.messages.map(m => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        unread: m.labelIds?.includes('UNREAD') || m.unread,
        display: `ID: ${m.id} | Nome: ${m.subject || 'Sem nome'}`
      }));
      const naoLidos = items.filter(i => i.unread).length;
      return { type: 'emails', total: items.length, naoLidos, items, source: 'api' };
    }
    return { type: 'emails', total: 0, naoLidos: 0, items: [], source: 'api' };
  }

  async readEmail(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiGet(`/email/messages/${id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'email', id, from: apiResult.from, subject: apiResult.subject, body: apiResult.body?.substring(0, 500), source: 'api' };
    }
    throw new Error('Email não encontrado');
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Orçamentos
  // ============================================================
  async createQuote(params, authorName) {
    const quote = {
      id: `quote_${Date.now()}`,
      clientName: params.cliente || params.clientName || 'Cliente',
      title: params.titulo || params.title || 'Orçamento',
      description: params.descricao || params.description || '',
      amount: parseFloat(params.valor || params.amount || 0),
      status: params.status || 'pending',
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/quotes', quote);
    if (apiResult && !apiResult.error) {
      return { type: 'quote', id: quote.id, title: quote.title, amount: quote.amount, source: 'api' };
    }

    const quotesFile = path.join(this.dataDir, 'quotes.json');
    const data = this.readJson(quotesFile, []);
    data.push(quote);
    this.writeJson(quotesFile, data);
    return { type: 'quote', id: quote.id, title: quote.title, amount: quote.amount, source: 'file' };
  }

  async listQuotes(params) {
    const apiResult = await this.apiGet('/quotes');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(q => ({ ...q, display: `ID: ${q.id} | Nome: ${q.title || q.client || 'Sem nome'}` }));
      return { type: 'quotes', items, source: 'api' };
    }
    const quotesFile = path.join(this.dataDir, 'quotes.json');
    const data = this.readJson(quotesFile, []);
    const items = data.map(q => ({ ...q, display: `ID: ${q.id} | Nome: ${q.title || q.client || 'Sem nome'}` }));
    return { type: 'quotes', items, source: 'file' };
  }

  async updateQuote(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do orçamento é obrigatório');
    const updates = {
      title: params.titulo || params.title,
      description: params.descricao || params.description,
      amount: params.valor !== undefined ? parseFloat(params.valor) : params.amount !== undefined ? parseFloat(params.amount) : undefined,
      status: params.status,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const apiResult = await this.apiPut(`/quotes/${id}`, updates);
    if (apiResult && !apiResult.error) {
      return { type: 'quote_updated', id, changes: Object.keys(updates), source: 'api' };
    }

    const quotesFile = path.join(this.dataDir, 'quotes.json');
    const data = this.readJson(quotesFile, []);
    const idx = data.findIndex(q => q.id === id);
    if (idx === -1) throw new Error(`Orçamento ${id} não encontrado`);
    data[idx] = { ...data[idx], ...updates };
    this.writeJson(quotesFile, data);
    return { type: 'quote_updated', id, changes: Object.keys(updates), source: 'file' };
  }

  async deleteQuote(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do orçamento é obrigatório');

    const apiResult = await this.apiDelete(`/quotes/${id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'quote_deleted', id, title: apiResult.title || apiResult.name || undefined, source: 'api' };
    }

    const quotesFile = path.join(this.dataDir, 'quotes.json');
    const data = this.readJson(quotesFile, []);
    const quote = data.find(q => q.id === id);
    const title = quote?.title || quote?.name || undefined;
    const filtered = data.filter(q => q.id !== id);
    if (filtered.length === data.length) throw new Error(`Orçamento ${id} não encontrado`);
    this.writeJson(quotesFile, filtered);
    return { type: 'quote_deleted', id, title, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Projetos
  // ============================================================
  async createProject(params, authorName) {
    const project = {
      id: params.id || `proj_${Date.now()}`,
      codename: params.codename || params.id || `proj_${Date.now()}`,
      name: params.nome || params.name || 'Novo Projeto',
      type: params.tipo || params.type || 'web',
      status: params.status || 'planejamento',
      priority: params.prioridade || params.priority || 'medium',
      progress: params.progresso || params.progress || 0,
      description: params.descricao || params.description || '',
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Projetos não têm endpoint REST dedicado — salvar direto no registry
    const registryFile = path.join(this.dataDir, 'schema', 'projects-registry.json');
    const registry = this.readJson(registryFile, { projects: {} });
    registry.projects = registry.projects || {};
    registry.projects[project.id] = project;
    this.writeJson(registryFile, registry);
    return { type: 'project', id: project.id, name: project.name, source: 'file' };
  }

  async updateProject(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do projeto é obrigatório');
    const updates = {
      name: params.nome || params.name,
      type: params.tipo || params.type,
      status: params.status,
      priority: params.prioridade || params.priority,
      progress: params.progresso !== undefined ? parseInt(params.progresso) : params.progress !== undefined ? parseInt(params.progress) : undefined,
      description: params.descricao || params.description,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const registryFile = path.join(this.dataDir, 'schema', 'projects-registry.json');
    const registry = this.readJson(registryFile, { projects: {} });
    registry.projects = registry.projects || {};
    if (!registry.projects[id]) throw new Error(`Projeto ${id} não encontrado`);
    registry.projects[id] = { ...registry.projects[id], ...updates };
    this.writeJson(registryFile, registry);
    return { type: 'project_updated', id, changes: Object.keys(updates), source: 'file' };
  }

  // ============================================================
  // AÇÕES: Workspace Clientes
  // ============================================================
  async addWorkspaceClient(params, authorName) {
    const client = {
      id: params.id || `ws_${Date.now()}`,
      nome: params.nome || params.name || 'Novo Cliente',
      status: params.status || 'ativo',
      dataInicio: params.dataInicio || new Date().toISOString().slice(0, 10),
      responsavel: params.responsavel || authorName?.toLowerCase() || 'sistema',
      orcamentoTotal: parseFloat(params.orcamentoTotal || params.orcamento || 0),
      moeda: params.moeda || 'EUR',
      cor: params.cor || '#3b82f6',
      tags: params.tags || [],
      anotacoes: params.anotacoes || params.notes || ''
    };

    const apiResult = await this.apiPost('/workspace/clients', client);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'workspace_client', id: client.id, name: client.nome, source: 'api' };
    }

    // Fallback: salvar direto no workspace index
    const wsFile = path.join(this.dataDir, 'workspace', 'workspace-index.json');
    const ws = this.readJson(wsFile, { clientes: {} });
    ws.clientes = ws.clientes || {};
    ws.clientes[client.id] = client;
    this.writeJson(wsFile, ws);
    return { type: 'workspace_client', id: client.id, name: client.nome, source: 'file' };
  }

  async updateWorkspaceClient(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do cliente workspace é obrigatório');
    const updates = {
      nome: params.nome || params.name,
      status: params.status,
      responsavel: params.responsavel,
      orcamentoTotal: params.orcamentoTotal !== undefined ? parseFloat(params.orcamentoTotal) : undefined,
      moeda: params.moeda,
      cor: params.cor,
      tags: params.tags,
      anotacoes: params.anotacoes || params.notes,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const apiResult = await this.apiPut(`/workspace/clients/${id}`, updates);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'workspace_client_updated', id, changes: Object.keys(updates), source: 'api' };
    }

    const wsFile = path.join(this.dataDir, 'workspace', 'workspace-index.json');
    const ws = this.readJson(wsFile, { clientes: {} });
    ws.clientes = ws.clientes || {};
    if (!ws.clientes[id]) throw new Error(`Cliente workspace ${id} não encontrado`);
    ws.clientes[id] = { ...ws.clientes[id], ...updates };
    this.writeJson(wsFile, ws);
    return { type: 'workspace_client_updated', id, changes: Object.keys(updates), source: 'file' };
  }

  // ============================================================
  // AÇÕES: Email
  // ============================================================
  async sendEmail(params, authorName) {
    const payload = {
      to: params.para || params.to,
      subject: params.assunto || params.subject,
      text: params.texto || params.text || params.body,
      html: params.html,
      cc: params.cc,
      bcc: params.bcc
    };
    if (!payload.to || !payload.subject) {
      // 🎯 SMART FORM: faltam dados → devolve estrutura pro frontend abrir modal
      return {
        type: 'prompt_missing_params',
        actionType: 'enviar_email',
        title: 'Enviar Email',
        description: 'Preencha os dados abaixo para enviar o email:',
        missingFields: [
          { name: 'para', label: 'Destinatário', type: 'email', required: true, placeholder: 'exemplo@email.com' },
          { name: 'assunto', label: 'Assunto', type: 'text', required: true, placeholder: 'Assunto do email' },
          { name: 'mensagem', label: 'Mensagem', type: 'textarea', required: false, placeholder: 'Conteúdo do email...', rows: 4 }
        ],
        partialParams: payload
      };
    }

    const apiResult = await this.apiPost('/email/messages/send', payload);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'email_sent', to: payload.to, subject: payload.subject, source: 'api' };
    }
    throw new Error('Falha ao enviar email — serviço de email pode estar offline');
  }

  async replyEmail(params, authorName) {
    let to = params.para || params.to;
    let subject = params.assunto || params.subject;
    const id = params.id || params.emailId;
    
    // Se não temos to/subject mas temos ID do email, busca o email original
    if ((!to || !subject) && id) {
      try {
        const emailData = await this.apiGet(`/email/messages/${id}`);
        if (emailData && emailData.message) {
          const msg = emailData.message;
          to = to || msg.from;
          subject = subject || (msg.subject ? `Re: ${msg.subject}` : 'Re: ');
        }
      } catch (e) {
        console.warn('[ActionExecutor] Não foi possível buscar email original:', e.message);
      }
    }
    
    const payload = {
      to,
      subject,
      text: params.texto || params.text || params.body,
      html: params.html,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo || params.messageId
    };
    if (!payload.to || !payload.subject) {
      throw new Error('Destinatário (para/to) e assunto (assunto/subject) são obrigatórios');
    }

    const apiResult = await this.apiPost('/email/messages/send', payload);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'email_replied', to: payload.to, subject: payload.subject, threadId: payload.threadId, source: 'api' };
    }
    throw new Error('Falha ao responder email — serviço de email pode estar offline');
  }

  async draftEmail(params, authorName) {
    const payload = {
      to: params.para || params.to,
      subject: params.assunto || params.subject,
      text: params.texto || params.text || params.body,
      html: params.html,
      cc: params.cc,
      bcc: params.bcc
    };
    if (!payload.to || !payload.subject) {
      throw new Error('Destinatário (para/to) e assunto (assunto/subject) são obrigatórios');
    }

    const apiResult = await this.apiPost('/email/drafts', payload);
    if (apiResult && !apiResult.error && apiResult.success !== false) {
      return { type: 'email_draft', to: payload.to, subject: payload.subject, source: 'api' };
    }
    throw new Error('Falha ao criar rascunho de email — serviço de email pode estar offline');
  }

  // ============================================================
  // AÇÕES: Tarefas Avançadas
  // ============================================================
  async listTasksByFilter(params) {
    const status = params.status;
    const priority = params.prioridade || params.priority;
    const assignedTo = params.responsavel || params.assignedTo;
    const dateFrom = params.data_de;
    const dateTo = params.data_ate;

    const apiResult = await this.apiGet('/tasks');
    let items = [];
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      items = apiResult;
    } else {
      const tasksFile = path.join(this.dataDir, 'tasks.json');
      items = this.readJson(tasksFile, []);
    }

    if (status) items = items.filter(t => t.status === status);
    if (priority) items = items.filter(t => t.priority === priority || t.prioridade === priority);
    if (assignedTo) items = items.filter(t => (t.assignedTo || t.responsavel || '').toLowerCase() === assignedTo.toLowerCase());
    if (dateFrom) items = items.filter(t => (t.dueDate || t.prazo || t.createdAt || '') >= dateFrom);
    if (dateTo) items = items.filter(t => (t.dueDate || t.prazo || t.createdAt || '') <= dateTo);

    const formattedItems = items.slice(0, 20).map(t => ({ ...t, display: `ID: ${t.id} | Nome: ${t.title || 'Sem nome'}` }));
    return { type: 'tasks_filtered', total: formattedItems.length, items: formattedItems, source: 'api' };
  }

  // ============================================================
  // AÇÕES: Projetos Avançadas
  // ============================================================
  async deleteProject(params) {
    const id = params.id;
    if (!id) throw new Error('ID do projeto é obrigatório');

    const registryFile = path.join(this.dataDir, 'schema', 'projects-registry.json');
    const registry = this.readJson(registryFile, { projects: {} });
    const name = registry.projects[id]?.name;
    delete registry.projects[id];
    this.writeJson(registryFile, registry);
    return { type: 'project_deleted', id, name, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Financeiro — Receitas
  // ============================================================
  async listPayments(params) {
    const apiResult = await this.apiGet('/payments');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(p => ({ ...p, display: `ID: ${p.id} | Nome: ${p.description || p.from || 'Sem nome'}` }));
      return { type: 'payments', items, total: items.length, source: 'api' };
    }
    const paymentsFile = path.join(this.dataDir, 'payments.json');
    const data = this.readJson(paymentsFile, []);
    const items = data.map(p => ({ ...p, display: `ID: ${p.id} | Nome: ${p.description || p.from || 'Sem nome'}` }));
    return { type: 'payments', items, total: items.length, source: 'file' };
  }

  async updatePayment(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID do pagamento é obrigatório');
    const updates = {
      amount: params.valor !== undefined ? parseFloat(params.valor) : params.amount !== undefined ? parseFloat(params.amount) : undefined,
      description: params.descricao || params.description,
      client: params.cliente || params.client,
      status: params.status,
      date: params.data || params.date,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const apiResult = await this.apiPut(`/payments/${id}`, updates);
    if (apiResult && !apiResult.error) {
      return { type: 'payment_updated', id, changes: Object.keys(updates), source: 'api' };
    }

    const paymentsFile = path.join(this.dataDir, 'payments.json');
    const data = this.readJson(paymentsFile, []);
    const idx = data.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Pagamento ${id} não encontrado`);
    data[idx] = { ...data[idx], ...updates };
    this.writeJson(paymentsFile, data);
    return { type: 'payment_updated', id, changes: Object.keys(updates), source: 'file' };
  }

  async addTransaction(params, authorName) {
    const paymentId = params.id_pagamento || params.paymentId;
    if (!paymentId) throw new Error('ID do pagamento é obrigatório');
    const transaction = {
      id: `txn_${Date.now()}`,
      amount: parseFloat(params.valor || params.amount || 0),
      description: params.descricao || params.description || 'Transação',
      date: params.data || new Date().toISOString(),
      createdBy: authorName?.toLowerCase() || 'sistema'
    };

    const apiResult = await this.apiPost(`/payments/${paymentId}/transactions`, transaction);
    if (apiResult && !apiResult.error) {
      return { type: 'transaction_added', paymentId, amount: transaction.amount, source: 'api' };
    }

    const paymentsFile = path.join(this.dataDir, 'payments.json');
    const data = this.readJson(paymentsFile, []);
    const idx = data.findIndex(p => p.id === paymentId);
    if (idx === -1) throw new Error(`Pagamento ${paymentId} não encontrado`);
    data[idx].transactions = data[idx].transactions || [];
    data[idx].transactions.push(transaction);
    this.writeJson(paymentsFile, data);
    return { type: 'transaction_added', paymentId, amount: transaction.amount, source: 'file' };
  }

  async receiveSplit(params, authorName) {
    const paymentId = params.id_pagamento || params.paymentId;
    const personId = params.id_pessoa || params.personId;
    if (!paymentId || !personId) throw new Error('ID do pagamento e ID da pessoa são obrigatórios');

    const apiResult = await this.apiPost(`/payments/${paymentId}/split/${personId}/receive`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'split_received', paymentId, personId, source: 'api' };
    }

    const paymentsFile = path.join(this.dataDir, 'payments.json');
    const data = this.readJson(paymentsFile, []);
    const payment = data.find(p => p.id === paymentId);
    if (!payment) throw new Error(`Pagamento ${paymentId} não encontrado`);
    payment.split = payment.split || [];
    const split = payment.split.find(s => s.personId === personId || s.id === personId);
    if (!split) throw new Error(`Split ${personId} não encontrado`);
    split.received = true;
    split.receivedAt = new Date().toISOString();
    this.writeJson(paymentsFile, data);
    return { type: 'split_received', paymentId, personId, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Financeiro — Despesas
  // ============================================================
  async listExpenses(params) {
    const apiResult = await this.apiGet('/expenses');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(e => ({ ...e, display: `ID: ${e.id} | Nome: ${e.description || e.to || 'Sem nome'}` }));
      return { type: 'expenses', items, total: items.length, source: 'api' };
    }
    const expensesFile = path.join(this.dataDir, 'expenses.json');
    const data = this.readJson(expensesFile, []);
    const items = data.map(e => ({ ...e, display: `ID: ${e.id} | Nome: ${e.description || e.to || 'Sem nome'}` }));
    return { type: 'expenses', items, total: items.length, source: 'file' };
  }

  async updateExpense(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID da despesa é obrigatório');
    const updates = {
      amount: params.valor !== undefined ? parseFloat(params.valor) : params.amount !== undefined ? parseFloat(params.amount) : undefined,
      description: params.descricao || params.description,
      vendor: params.fornecedor || params.vendor,
      status: params.status,
      date: params.data || params.date,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const apiResult = await this.apiPut(`/expenses/${id}`, updates);
    if (apiResult && !apiResult.error) {
      return { type: 'expense_updated', id, changes: Object.keys(updates), source: 'api' };
    }

    const expensesFile = path.join(this.dataDir, 'expenses.json');
    const data = this.readJson(expensesFile, []);
    const idx = data.findIndex(e => e.id === id);
    if (idx === -1) throw new Error(`Despesa ${id} não encontrada`);
    data[idx] = { ...data[idx], ...updates };
    this.writeJson(expensesFile, data);
    return { type: 'expense_updated', id, changes: Object.keys(updates), source: 'file' };
  }

  async payExpense(params, authorName) {
    const id = params.id;
    if (!id) throw new Error('ID da despesa é obrigatório');

    const apiResult = await this.apiPost(`/expenses/${id}/pay`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'expense_paid', id, source: 'api' };
    }

    const expensesFile = path.join(this.dataDir, 'expenses.json');
    const data = this.readJson(expensesFile, []);
    const idx = data.findIndex(e => e.id === id);
    if (idx === -1) throw new Error(`Despesa ${id} não encontrada`);
    data[idx].status = 'paid';
    data[idx].paidAt = new Date().toISOString();
    this.writeJson(expensesFile, data);
    return { type: 'expense_paid', id, source: 'file' };
  }

  async createExpenseTemplate(params, authorName) {
    const template = {
      id: `tmpl_${Date.now()}`,
      name: params.nome || params.name || 'Template',
      description: params.descricao || params.description || '',
      amount: parseFloat(params.valor || params.amount || 0),
      vendor: params.fornecedor || params.vendor || '',
      category: params.categoria || params.category || 'geral',
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/expenses/templates', template);
    if (apiResult && !apiResult.error) {
      return { type: 'expense_template', id: template.id, name: template.name, source: 'api' };
    }

    const templatesFile = path.join(this.dataDir, 'expense-templates.json');
    const data = this.readJson(templatesFile, []);
    data.push(template);
    this.writeJson(templatesFile, data);
    return { type: 'expense_template', id: template.id, name: template.name, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Financeiro — Caixa
  // ============================================================
  async adjustCashBox(params) {
    const amount = parseFloat(params.valor) || 0;
    const reason = params.motivo || params.reason || 'Ajuste manual';

    const apiResult = await this.apiPost('/cash-box/adjust', { amount, reason });
    if (apiResult && !apiResult.error) {
      return { type: 'cash_adjusted', amount, reason, source: 'api' };
    }

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    cash.balance.value = parseFloat((cash.balance.value + amount).toFixed(2));
    cash.history.push({ type: 'adjustment', amount, reason, date: new Date().toISOString() });
    this.writeJson(cashFile, cash);
    return { type: 'cash_adjusted', amount, reason, source: 'file' };
  }

  async addCashBoxEntry(params) {
    const amount = parseFloat(params.valor) || 0;
    const description = params.descricao || params.description || 'Entrada';
    const type = params.tipo || 'income';

    const apiResult = await this.apiPost('/cash-box/entries', { amount, description, type });
    if (apiResult && !apiResult.error) {
      return { type: 'cash_entry', amount, description, type, source: 'api' };
    }

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    cash.balance.value = parseFloat((cash.balance.value + amount).toFixed(2));
    cash.history.push({ type, amount, description, date: new Date().toISOString() });
    this.writeJson(cashFile, cash);
    return { type: 'cash_entry', amount, description, type, source: 'file' };
  }

  async listCashBoxHistory(params) {
    const limit = parseInt(params.limite) || 50;

    const apiResult = await this.apiGet('/cash-box/history');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(h => ({ ...h, display: `ID: ${h.id} | Nome: ${h.description || 'Sem nome'}` })).slice(0, limit);
      return { type: 'cash_history', items, total: apiResult.length, source: 'api' };
    }

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    const items = cash.history.map(h => ({ ...h, display: `ID: ${h.id} | Nome: ${h.description || 'Sem nome'}` })).slice(0, limit);
    return { type: 'cash_history', items, total: cash.history.length, source: 'file' };
  }

  async projectCashBox(params) {
    const months = parseInt(params.meses) || 6;

    const apiResult = await this.apiGet('/cash-box/projection');
    if (apiResult && !apiResult.error) {
      return { type: 'cash_projection', months, data: apiResult, source: 'api' };
    }

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    const currentBalance = cash.balance.value;
    const projection = [];
    for (let i = 1; i <= months; i++) {
      projection.push({ month: i, projectedBalance: currentBalance });
    }
    return { type: 'cash_projection', months, data: projection, source: 'file' };
  }

  async reconcileCashBox(params) {
    const targetBalance = parseFloat(params.saldo_alvo || params.targetBalance || 0);
    const reason = params.motivo || params.reason || 'Reconciliação';

    const apiResult = await this.apiPost('/cash-box/reconcile', { targetBalance, reason });
    if (apiResult && !apiResult.error) {
      return { type: 'cash_reconciled', targetBalance, reason, source: 'api' };
    }

    const cashFile = path.join(this.dataDir, 'cash-box.json');
    const cash = this.readJson(cashFile, { balance: { value: 0, currency: 'EUR' }, history: [] });
    const diff = parseFloat((targetBalance - cash.balance.value).toFixed(2));
    cash.balance.value = targetBalance;
    cash.history.push({ type: 'reconciliation', amount: diff, reason, date: new Date().toISOString() });
    this.writeJson(cashFile, cash);
    return { type: 'cash_reconciled', targetBalance, diff, reason, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Ideias Avançadas
  // ============================================================
  async commentIdea(params, authorName) {
    const id = params.id;
    const text = params.texto || params.text || params.comentario;
    if (!id || !text) throw new Error('ID da ideia e texto do comentário são obrigatórios');

    const comment = {
      id: `cmt_${Date.now()}`,
      text,
      author: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: {} });
    if (!data.ideas[id]) throw new Error(`Ideia ${id} não encontrada`);
    data.ideas[id].comments = data.ideas[id].comments || [];
    data.ideas[id].comments.push(comment);
    this.writeJson(ideasFile, data);
    return { type: 'idea_commented', id, commentId: comment.id, source: 'file' };
  }

  async createIdeaFromTemplate(params, authorName) {
    const templateId = params.id_template || params.templateId;
    if (!templateId) throw new Error('ID do template é obrigatório');

    const templatesFile = path.join(this.dataDir, 'idea-templates.json');
    const templates = this.readJson(templatesFile, []);
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl) throw new Error(`Template ${templateId} não encontrado`);

    const idea = {
      id: `idea_${Date.now()}`,
      title: params.titulo || params.title || tmpl.name || 'Ideia de template',
      description: params.descricao || params.description || tmpl.description || '',
      status: params.status || 'nova',
      tags: params.tags || tmpl.tags || [],
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };

    const ideasFile = path.join(this.dataDir, 'ideas-registry.json');
    const data = this.readJson(ideasFile, { ideas: {} });
    data.ideas[idea.id] = idea;
    this.writeJson(ideasFile, data);
    return { type: 'idea_from_template', id: idea.id, title: idea.title, templateId, source: 'file' };
  }

  async listIdeaTemplates(params) {
    const templatesFile = path.join(this.dataDir, 'idea-templates.json');
    const data = this.readJson(templatesFile, []);
    const items = data.map(t => ({ ...t, display: `ID: ${t.id} | Nome: ${t.title || 'Sem nome'}` }));
    return { type: 'idea_templates', items, total: items.length, source: 'file' };
  }

  // ============================================================
  // AÇÕES: WhatsApp Avançadas
  // ============================================================
  async scanWhatsApp(params) {
    const apiResult = await this.apiPost('/whatsapp-agent/refresh', {});
    if (apiResult && !apiResult.error) {
      return { type: 'whatsapp_scan', source: 'api' };
    }
    throw new Error('Não foi possível escanear WhatsApp');
  }

  async clearWhatsAppBuffer(params) {
    const apiResult = await this.apiDelete('/whatsapp/buffer');
    if (apiResult && !apiResult.error) {
      return { type: 'whatsapp_buffer_cleared', source: 'api' };
    }
    const bufferFile = path.join(this.dataDir, 'luna-buffer.json');
    if (fs.existsSync(bufferFile)) {
      this.writeJson(bufferFile, { newMessages: [], newLinks: [], mentions: [] });
    }
    return { type: 'whatsapp_buffer_cleared', source: 'file' };
  }

  async viewWhatsAppHistory(params) {
    const limit = parseInt(params.limite) || 50;
    const apiResult = await this.apiGet(`/whatsapp/history?limit=${limit}`);
    if (apiResult && !apiResult.error) {
      return { type: 'whatsapp_history', items: apiResult.messages || apiResult, total: (apiResult.messages || apiResult).length, source: 'api' };
    }
    const historyFile = path.join(this.dataDir, 'whatsapp-history.json');
    const data = this.readJson(historyFile, []);
    return { type: 'whatsapp_history', items: data.slice(0, limit), total: data.length, source: 'file' };
  }

  async viewClassifications(params) {
    const apiResult = await this.apiGet('/whatsapp/buffer');
    if (apiResult && !apiResult.error) {
      return { type: 'classifications', items: apiResult, source: 'api' };
    }
    const bufferFile = path.join(this.dataDir, 'luna-buffer.json');
    const data = this.readJson(bufferFile, { mentions: [] });
    return { type: 'classifications', items: data.mentions || [], source: 'file' };
  }

  // ============================================================
  // AÇÕES: Email Avançadas
  // ============================================================
  async markEmailRead(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/read`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_marked_read', id, source: 'api' };
    }
    throw new Error('Não foi possível marcar email como lido');
  }

  async markEmailUnread(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/unread`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_marked_unread', id, source: 'api' };
    }
    throw new Error('Não foi possível marcar email como não lido');
  }

  async starEmail(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/star`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_starred', id, source: 'api' };
    }
    throw new Error('Não foi possível favoritar email');
  }

  async archiveEmail(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/archive`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_archived', id, source: 'api' };
    }
    throw new Error('Não foi possível arquivar email');
  }

  async trashEmail(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/trash`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_trashed', id, source: 'api' };
    }
    throw new Error('Não foi possível mover email para lixeira');
  }

  async spamEmail(params) {
    const id = params.id;
    if (!id) throw new Error('ID do email necessário');
    const apiResult = await this.apiPost(`/email/messages/${id}/spam`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'email_spam', id, source: 'api' };
    }
    throw new Error('Não foi possível marcar email como spam');
  }

  async approveDraft(params) {
    const id = params.id;
    if (!id) throw new Error('ID do rascunho necessário');
    const apiResult = await this.apiPost(`/email/drafts/${id}/approve`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'draft_approved', id, source: 'api' };
    }
    throw new Error('Não foi possível aprovar rascunho');
  }

  async rejectDraft(params) {
    const id = params.id;
    if (!id) throw new Error('ID do rascunho necessário');
    const apiResult = await this.apiPost(`/email/drafts/${id}/reject`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'draft_rejected', id, source: 'api' };
    }
    throw new Error('Não foi possível rejeitar rascunho');
  }

  async suggestEmailReply(params) {
    const threadMessages = params.mensagens || params.threadMessages;
    const instructions = params.instrucoes || params.instructions || 'Sugira uma resposta profissional.';
    if (!threadMessages) throw new Error('Mensagens da thread são obrigatórias');

    const apiResult = await this.apiPost('/email/ai/draft', { threadMessages, instructions });
    if (apiResult && !apiResult.error) {
      return { type: 'email_reply_suggestion', draft: apiResult.draft, source: 'api' };
    }
    throw new Error('Não foi possível gerar sugestão de resposta');
  }

  async summarizeEmailThread(params) {
    const threadMessages = params.mensagens || params.threadMessages;
    if (!threadMessages) throw new Error('Mensagens da thread são obrigatórias');

    const apiResult = await this.apiPost('/email/ai/summarize', { threadMessages });
    if (apiResult && !apiResult.error) {
      return { type: 'email_thread_summary', summary: apiResult.summary, source: 'api' };
    }
    throw new Error('Não foi possível resumir thread');
  }

  async analyzeEmail(params) {
    const emailId = params.id;
    if (!emailId) throw new Error('ID do email necessário');

    const apiResult = await this.apiPost('/email/ai/analyze', { emailId });
    if (apiResult && !apiResult.error) {
      return { type: 'email_analyzed', id: emailId, analysis: apiResult.analysis, source: 'api' };
    }
    throw new Error('Não foi possível analisar email');
  }

  // ============================================================
  // AÇÕES: Instagram
  // ============================================================
  async listInstagramMessages(params) {
    const apiResult = await this.apiGet('/instagram/messages');
    if (apiResult && !apiResult.error) {
      const raw = apiResult.messages || apiResult;
      const items = Array.isArray(raw) ? raw.map(m => ({ ...m, display: `ID: ${m.id} | Nome: ${m.sender || m.text || 'Sem nome'}` })) : raw;
      return { type: 'instagram_messages', items, source: 'api' };
    }
    throw new Error('Não foi possível listar mensagens do Instagram');
  }

  async importInstagramMessage(params) {
    const messageId = params.id;
    if (!messageId) throw new Error('ID da mensagem é obrigatório');
    const apiResult = await this.apiPost('/instagram/messages/import', { messageId });
    if (apiResult && !apiResult.error) {
      return { type: 'instagram_imported', id: messageId, source: 'api' };
    }
    throw new Error('Não foi possível importar mensagem do Instagram');
  }

  // ============================================================
  // AÇÕES: Links
  // ============================================================
  async listLinks(params) {
    const apiResult = await this.apiGet('/links');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(l => ({ ...l, display: `ID: ${l.id} | Nome: ${l.title || l.url || 'Sem nome'}` }));
      return { type: 'links', items, total: items.length, source: 'api' };
    }
    const linksFile = path.join(this.dataDir, 'links.json');
    const data = this.readJson(linksFile, []);
    const items = data.map(l => ({ ...l, display: `ID: ${l.id} | Nome: ${l.title || l.url || 'Sem nome'}` }));
    return { type: 'links', items, total: items.length, source: 'file' };
  }

  async addLink(params, authorName) {
    const link = {
      id: `link_${Date.now()}`,
      url: params.url,
      title: params.titulo || params.title || 'Link',
      description: params.descricao || params.description || '',
      tags: params.tags || [],
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };
    if (!link.url) throw new Error('URL é obrigatória');

    const apiResult = await this.apiPost('/links', link);
    if (apiResult && !apiResult.error) {
      return { type: 'link_added', id: link.id, url: link.url, source: 'api' };
    }

    const linksFile = path.join(this.dataDir, 'links.json');
    const data = this.readJson(linksFile, []);
    data.push(link);
    this.writeJson(linksFile, data);
    return { type: 'link_added', id: link.id, url: link.url, source: 'file' };
  }

  async deleteLink(params) {
    const id = params.id;
    if (!id) throw new Error('ID do link é obrigatório');

    const apiResult = await this.apiDelete(`/links/${id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'link_deleted', id, title: apiResult.title || apiResult.name || undefined, source: 'api' };
    }

    const linksFile = path.join(this.dataDir, 'links.json');
    const data = this.readJson(linksFile, []);
    const link = data.find(l => l.id === id);
    const title = link?.title || link?.name || undefined;
    const filtered = data.filter(l => l.id !== id);
    if (filtered.length === data.length) throw new Error(`Link ${id} não encontrado`);
    this.writeJson(linksFile, filtered);
    return { type: 'link_deleted', id, title, source: 'file' };
  }

  async enrichLink(params) {
    const url = params.url;
    if (!url) throw new Error('URL é obrigatória');
    const apiResult = await this.apiPost('/links/enrich', { url });
    if (apiResult && !apiResult.error) {
      return { type: 'link_enriched', url, source: 'api' };
    }
    throw new Error('Não foi possível enriquecer link');
  }

  async syncLinks(params) {
    const apiResult = await this.apiPost('/links/sync', {});
    if (apiResult && !apiResult.error) {
      return { type: 'links_synced', source: 'api' };
    }
    throw new Error('Não foi possível sincronizar links');
  }

  // ============================================================
  // AÇÕES: Operações
  // ============================================================
  async createOpsAlert(params, authorName) {
    const alert = {
      id: `alert_${Date.now()}`,
      title: params.titulo || params.title || 'Alerta',
      description: params.descricao || params.description || '',
      severity: params.severidade || params.severity || 'medium',
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/ops/alerts', alert);
    if (apiResult && !apiResult.error) {
      return { type: 'ops_alert', id: alert.id, title: alert.title, source: 'api' };
    }

    const opsFile = path.join(this.dataDir, 'ops-alerts.json');
    const data = this.readJson(opsFile, []);
    data.push(alert);
    this.writeJson(opsFile, data);
    return { type: 'ops_alert', id: alert.id, title: alert.title, source: 'file' };
  }

  async deleteOpsAlert(params) {
    const id = params.id;
    if (!id) throw new Error('ID do alerta é obrigatório');

    const apiResult = await this.apiDelete(`/ops/alerts/${id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'ops_alert_deleted', id, title: apiResult.title || apiResult.name || undefined, source: 'api' };
    }

    const opsFile = path.join(this.dataDir, 'ops-alerts.json');
    const data = this.readJson(opsFile, []);
    const alert = data.find(a => a.id === id);
    const title = alert?.title || alert?.name || undefined;
    const filtered = data.filter(a => a.id !== id);
    if (filtered.length === data.length) throw new Error(`Alerta ${id} não encontrado`);
    this.writeJson(opsFile, filtered);
    return { type: 'ops_alert_deleted', id, title, source: 'file' };
  }

  async registerChange(params, authorName) {
    const change = {
      id: `chg_${Date.now()}`,
      description: params.descricao || params.description || 'Mudança registrada',
      system: params.sistema || params.system || 'geral',
      createdBy: authorName?.toLowerCase() || 'sistema',
      createdAt: new Date().toISOString()
    };

    const apiResult = await this.apiPost('/ops/changes', change);
    if (apiResult && !apiResult.error) {
      return { type: 'ops_change', id: change.id, description: change.description, source: 'api' };
    }

    const changesFile = path.join(this.dataDir, 'ops-changes.json');
    const data = this.readJson(changesFile, []);
    data.push(change);
    this.writeJson(changesFile, data);
    return { type: 'ops_change', id: change.id, description: change.description, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Sistema Avançado
  // ============================================================
  async viewStackLogs(params) {
    const lines = parseInt(params.linhas) || 100;
    const apiResult = await this.apiGet(`/stack-logs?lines=${lines}`);
    if (apiResult && !apiResult.error) {
      return { type: 'stack_logs', lines, source: 'api' };
    }
    throw new Error('Não foi possível obter logs do stack');
  }

  async checkStack(params) {
    const apiResult = await this.apiGet('/stack-status');
    if (apiResult && !apiResult.error) {
      return { type: 'stack_status', status: apiResult.status, services: apiResult.services, source: 'api' };
    }
    throw new Error('Não foi possível verificar status do stack');
  }

  // ============================================================
  // AÇÕES: Segurança
  // ============================================================
  async querySecurityLog(params) {
    const limit = parseInt(params.limite) || 50;
    const apiResult = await this.apiGet(`/security/log?limit=${limit}`);
    if (apiResult && !apiResult.error) {
      return { type: 'security_log', items: apiResult.logs || apiResult, source: 'api' };
    }
    throw new Error('Não foi possível consultar log de segurança');
  }

  async updateSecurityConfig(params) {
    const updates = {
      twoFactorEnabled: params.dois_fatores,
      alertOnLogin: params.alerta_login,
      alertOnFail: params.alerta_falha,
      updatedAt: new Date().toISOString()
    };
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

    const apiResult = await this.apiPut('/security/settings', updates);
    if (apiResult && !apiResult.error) {
      return { type: 'security_config_updated', changes: Object.keys(updates), source: 'api' };
    }
    throw new Error('Não foi possível atualizar configuração de segurança');
  }

  async testWhatsAppSecurity(params) {
    const apiResult = await this.apiPost('/security/test-whatsapp', {});
    if (apiResult && !apiResult.error) {
      return { type: 'security_whatsapp_test', result: apiResult.result, source: 'api' };
    }
    throw new Error('Não foi possível testar WhatsApp de segurança');
  }

  // ============================================================
  // AÇÕES: Notificações
  // ============================================================
  async listNotifications(params) {
    const apiResult = await this.apiGet('/notifications');
    if (apiResult && !apiResult.error && Array.isArray(apiResult)) {
      const items = apiResult.map(n => ({ ...n, display: `ID: ${n.id} | Nome: ${n.title || n.message || 'Sem nome'}` }));
      return { type: 'notifications', items, total: items.length, source: 'api' };
    }
    const notifFile = path.join(this.dataDir, 'notifications.json');
    const data = this.readJson(notifFile, []);
    const items = data.map(n => ({ ...n, display: `ID: ${n.id} | Nome: ${n.title || n.message || 'Sem nome'}` }));
    return { type: 'notifications', items, total: items.length, source: 'file' };
  }

  async markNotificationRead(params) {
    const id = params.id;
    if (!id) throw new Error('ID da notificação é obrigatório');

    const apiResult = await this.apiPost(`/notifications/${id}/read`, {});
    if (apiResult && !apiResult.error) {
      return { type: 'notification_read', id, source: 'api' };
    }

    const notifFile = path.join(this.dataDir, 'notifications.json');
    const data = this.readJson(notifFile, []);
    const idx = data.findIndex(n => n.id === id);
    if (idx === -1) throw new Error(`Notificação ${id} não encontrada`);
    data[idx].read = true;
    data[idx].readAt = new Date().toISOString();
    this.writeJson(notifFile, data);
    return { type: 'notification_read', id, source: 'file' };
  }

  async markAllNotificationsRead(params) {
    const apiResult = await this.apiPost('/notifications/read-all', {});
    if (apiResult && !apiResult.error) {
      return { type: 'all_notifications_read', source: 'api' };
    }

    const notifFile = path.join(this.dataDir, 'notifications.json');
    const data = this.readJson(notifFile, []);
    data.forEach(n => { n.read = true; n.readAt = new Date().toISOString(); });
    this.writeJson(notifFile, data);
    return { type: 'all_notifications_read', source: 'file' };
  }

  async deleteNotification(params) {
    const id = params.id;
    if (!id) throw new Error('ID da notificação é obrigatório');

    const apiResult = await this.apiDelete(`/notifications/${id}`);
    if (apiResult && !apiResult.error) {
      return { type: 'notification_deleted', id, title: apiResult.title || apiResult.name || undefined, source: 'api' };
    }

    const notifFile = path.join(this.dataDir, 'notifications.json');
    const data = this.readJson(notifFile, []);
    const notif = data.find(n => n.id === id);
    const title = notif?.title || notif?.name || undefined;
    const filtered = data.filter(n => n.id !== id);
    if (filtered.length === data.length) throw new Error(`Notificação ${id} não encontrada`);
    this.writeJson(notifFile, filtered);
    return { type: 'notification_deleted', id, title, source: 'file' };
  }

  // ============================================================
  // AÇÕES: Usuários
  // ============================================================
  async listUsers(params) {
    const apiResult = await this.apiGet('/state');
    if (apiResult && !apiResult.error && apiResult.users) {
      const items = apiResult.users.map(u => ({ ...u, display: `ID: ${u.id} | Nome: ${u.name || u.username || 'Sem nome'}` }));
      return { type: 'users', items, total: items.length, source: 'api' };
    }
    const usersFile = path.join(this.dataDir, 'users.json');
    const data = this.readJson(usersFile, []);
    const items = data.map(u => ({ ...u, display: `ID: ${u.id} | Nome: ${u.name || u.username || 'Sem nome'}` }));
    return { type: 'users', items, total: items.length, source: 'file' };
  }

  async switchUser(params) {
    const userId = params.id || params.userId;
    if (!userId) throw new Error('ID do usuário é obrigatório');

    const apiResult = await this.apiPost('/users/switch', { userId });
    if (apiResult && !apiResult.error) {
      return { type: 'user_switched', userId, source: 'api' };
    }
    throw new Error('Não foi possível trocar de usuário');
  }

  // ============================================================
  // AÇÕES: External Tools
  // ============================================================
  async listGitHubRepos(params) {
    const apiResult = await this.apiGet('/github-repos');
    if (apiResult && !apiResult.error) {
      return { type: 'github_repos', items: apiResult.repos || apiResult, source: 'api' };
    }
    throw new Error('Não foi possível listar repositórios GitHub');
  }

  async listVercelProjects(params) {
    const apiResult = await this.apiGet('/vercel-projects');
    if (apiResult && !apiResult.error) {
      return { type: 'vercel_projects', items: apiResult.projects || apiResult, source: 'api' };
    }
    throw new Error('Não foi possível listar projetos Vercel');
  }

  // ============================================================
  // AÇÕES: BugDetector
  // ============================================================
  async listBugReports(params) {
    const apiResult = await this.apiGet('/bugdetector/reports');
    if (apiResult && !apiResult.error) {
      const raw = apiResult.reports || apiResult;
      const items = Array.isArray(raw) ? raw.map(r => ({ ...r, display: `ID: ${r.id} | Nome: ${r.title || 'Sem nome'}` })) : raw;
      return { type: 'bug_reports', items, source: 'api' };
    }
    throw new Error('Não foi possível listar relatórios de bug');
  }

  async deleteBugReport(params) {
    const filename = params.filename || params.id;
    if (!filename) throw new Error('Nome do arquivo é obrigatório');

    const apiResult = await this.apiDelete(`/bugdetector/reports/${filename}`);
    if (apiResult && !apiResult.error) {
      return { type: 'bug_report_deleted', id: filename, filename, source: 'api' };
    }
    throw new Error('Não foi possível excluir relatório de bug');
  }

  // ============================================================
  // AÇÕES EXPANDIDAS: Sistema
  // ============================================================
  async controlService(params) {
    const action = params.acao || params.action;
    const service = params.servico || params.service;
    if (!action) throw new Error('Ação necessária (start/stop/restart/status)');

    const apiResult = await this.apiPost('/system/control', { action, service });
    if (apiResult && !apiResult.error) {
      return { type: 'service_control', action, service, result: apiResult, source: 'api' };
    }
    return { type: 'service_control', action, service, result: 'offline', source: 'fallback' };
  }

  // ============================================================
  // FILE HELPERS
  // ============================================================
  readJson(filePath, defaultValue = []) {
    try {
      if (!fs.existsSync(filePath)) return defaultValue;
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.trim()) return defaultValue;
      return JSON.parse(content);
    } catch {
      return defaultValue;
    }
  }

  writeJson(filePath, data) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[ActionExecutor] Erro ao salvar ${filePath}:`, err.message);
    }
  }

  // ============================================================
  // SUMMARY BUILDER
  // ============================================================
  buildSummary(results) {
    const parts = [];
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    for (const r of results) {
      if (r.status !== 'success') continue;
      const res = r.result;
      switch (res.type) {
        case 'task':
          parts.push(`tarefa "${res.title || res.titulo}"`);
          break;
        case 'task_done':
          parts.push(`tarefa "${res.title || res.titulo || 'desconhecida'}" como concluída`);
          break;
        case 'lead':
          parts.push(`lead "${res.displayName || res.nome}"`);
          break;
        case 'payment':
          parts.push(`pagamento de €${res.amount || res.valor} de ${res.de || res.from || 'cliente'}`);
          break;
        case 'expense':
          parts.push(`despesa de €${res.amount || res.valor} para ${res.para || res.to || 'fornecedor'}`);
          break;
        case 'idea':
          parts.push(`ideia anotada`);
          break;
        case 'link':
          parts.push(`link salvo`);
          break;
        case 'help':
          parts.push(`ajuda enviada`);
          break;
        case 'navigate':
          parts.push(`navegação para ${res.destino || 'página'}`);
          break;
        case 'task_deleted':
          parts.push(`tarefa "${res.titulo || res.title}" excluída`);
          break;
        case 'payment_deleted':
          parts.push(`pagamento de €${res.amount} excluído`);
          break;
        case 'expense_deleted':
          parts.push(`despesa de €${res.amount} excluída`);
          break;
        case 'lead_deleted':
          parts.push(`lead "${res.nome || res.displayName}" excluído`);
          break;
        case 'emails':
          parts.push(`📧 Emails: ${res.total} total (${res.naoLidos} não lidos)`);
          if (res.items?.length > 0) {
            parts.push(res.items.map(e => `  • ${e.unread ? '🆕 ' : ''}${e.from}: "${e.subject}"`).join('\n'));
          }
          break;
        case 'comment':
          parts.push(`comentário na tarefa "${res.taskTitle || res.title || res.titulo}"`);
          break;
        case 'status_update':
          parts.push(`status da tarefa "${res.taskTitle || res.title || res.titulo}" atualizado para ${res.status}`);
          break;
        case 'quote':
          parts.push(`orçamento "${res.title}" de €${res.amount}`);
          break;
        case 'quote_updated':
          parts.push(`orçamento ${res.id} atualizado (${res.changes?.join(', ')})`);
          break;
        case 'quote_deleted':
          parts.push(`orçamento ${res.id} excluído`);
          break;
        case 'project':
          parts.push(`projeto "${res.name}" criado`);
          break;
        case 'project_updated':
          parts.push(`projeto ${res.id} atualizado (${res.changes?.join(', ')})`);
          break;
        case 'workspace_client':
          parts.push(`cliente workspace "${res.name}" adicionado`);
          break;
        case 'workspace_client_updated':
          parts.push(`cliente workspace ${res.id} atualizado (${res.changes?.join(', ')})`);
          break;
        case 'email_sent':
          parts.push(`📧 email enviado para ${res.to}: "${res.subject}"`);
          break;
        case 'email_replied':
          parts.push(`📧 resposta enviada para ${res.to}: "${res.subject}"`);
          break;
        case 'email_draft':
          parts.push(`📧 rascunho criado para ${res.to}: "${res.subject}"`);
          break;
        case 'tasks_filtered':
          parts.push(`${res.total} tarefa(s) encontrada(s) no filtro`);
          break;
        case 'project_deleted':
          parts.push(`projeto ${res.id}${res.name ? ` "${res.name}"` : ''} excluído`);
          break;
        case 'payments':
          parts.push(`${res.total} pagamento(s) listado(s)`);
          break;
        case 'payment_updated':
          parts.push(`pagamento ${res.id} atualizado (${res.changes?.join(', ')})`);
          break;
        case 'transaction_added':
          parts.push(`transação de €${res.amount} adicionada ao pagamento ${res.paymentId}`);
          break;
        case 'split_received':
          parts.push(`split do pagamento ${res.paymentId} marcado como recebido`);
          break;
        case 'expenses':
          parts.push(`${res.total} despesa(s) listada(s)`);
          break;
        case 'expense_updated':
          parts.push(`despesa ${res.id} atualizada (${res.changes?.join(', ')})`);
          break;
        case 'expense_paid':
          parts.push(`despesa ${res.id} marcada como paga`);
          break;
        case 'expense_template':
          parts.push(`template de despesa "${res.name}" criado`);
          break;
        case 'cash_adjusted':
          parts.push(`caixa ajustado em €${res.amount} — ${res.reason}`);
          break;
        case 'cash_entry':
          parts.push(`entrada de €${res.amount} no caixa — ${res.description}`);
          break;
        case 'cash_history':
          parts.push(`${res.total} registro(s) no histórico do caixa`);
          break;
        case 'cash_projection':
          parts.push(`projeção do caixa para ${res.months} meses calculada`);
          break;
        case 'cash_reconciled':
          parts.push(`caixa reconciliado para €${res.targetBalance}`);
          break;
        case 'idea_commented':
          parts.push(`comentário adicionado à ideia ${res.id}`);
          break;
        case 'idea_from_template':
          parts.push(`ideia "${res.title}" criada do template ${res.templateId}`);
          break;
        case 'idea_templates':
          parts.push(`${res.total} template(s) de ideia listado(s)`);
          break;
        case 'whatsapp_scan':
          parts.push(`WhatsApp escaneado`);
          break;
        case 'whatsapp_buffer_cleared':
          parts.push(`buffer do WhatsApp limpo`);
          break;
        case 'whatsapp_history':
          parts.push(`${res.total} mensagem(ns) no histórico do WhatsApp`);
          break;
        case 'classifications':
          parts.push(`${res.items?.length || 0} classificação(ões) pendente(s)`);
          break;
        case 'email_marked_read':
          parts.push(`email ${res.id} marcado como lido`);
          break;
        case 'email_marked_unread':
          parts.push(`email ${res.id} marcado como não lido`);
          break;
        case 'email_starred':
          parts.push(`email ${res.id} favoritado`);
          break;
        case 'email_archived':
          parts.push(`email ${res.id} arquivado`);
          break;
        case 'email_trashed':
          parts.push(`email ${res.id} movido para lixeira`);
          break;
        case 'email_spam':
          parts.push(`email ${res.id} marcado como spam`);
          break;
        case 'draft_approved':
          parts.push(`rascunho ${res.id} aprovado`);
          break;
        case 'draft_rejected':
          parts.push(`rascunho ${res.id} rejeitado`);
          break;
        case 'email_reply_suggestion':
          parts.push(`sugestão de resposta gerada`);
          break;
        case 'email_thread_summary':
          parts.push(`thread resumida`);
          break;
        case 'email_analyzed':
          parts.push(`email ${res.id} analisado`);
          break;
        case 'instagram_messages':
          parts.push(`${res.items?.length || 0} mensagem(ns) do Instagram`);
          break;
        case 'instagram_imported':
          parts.push(`mensagem ${res.id} importada do Instagram`);
          break;
        case 'links':
          parts.push(`${res.total} link(s) listado(s)`);
          break;
        case 'link_added':
          parts.push(`link salvo: ${res.url}`);
          break;
        case 'link_deleted':
          parts.push(`link ${res.id} excluído`);
          break;
        case 'link_enriched':
          parts.push(`link ${res.url} enriquecido`);
          break;
        case 'links_synced':
          parts.push(`links sincronizados`);
          break;
        case 'ops_alert':
          parts.push(`alerta "${res.title}" criado`);
          break;
        case 'ops_alert_deleted':
          parts.push(`alerta ${res.id} excluído`);
          break;
        case 'ops_change':
          parts.push(`mudança registrada: ${res.description}`);
          break;
        case 'stack_logs':
          parts.push(`${res.lines} linha(s) de log do stack`);
          break;
        case 'stack_status':
          parts.push(`status do stack verificado`);
          break;
        case 'security_log':
          parts.push(`${res.items?.length || 0} registro(s) de segurança`);
          break;
        case 'security_config_updated':
          parts.push(`configuração de segurança atualizada`);
          break;
        case 'security_whatsapp_test':
          parts.push(`teste de WhatsApp de segurança realizado`);
          break;
        case 'notifications':
          parts.push(`${res.total} notificação(ões) listada(s)`);
          break;
        case 'notification_read':
          parts.push(`notificação ${res.id} marcada como lida`);
          break;
        case 'all_notifications_read':
          parts.push(`todas as notificações marcadas como lidas`);
          break;
        case 'notification_deleted':
          parts.push(`notificação ${res.id} excluída`);
          break;
        case 'users':
          parts.push(`${res.total} usuário(s) listado(s)`);
          break;
        case 'user_switched':
          parts.push(`usuário trocado para ${res.userId}`);
          break;
        case 'github_repos':
          parts.push(`${res.items?.length || 0} repositório(s) GitHub`);
          break;
        case 'vercel_projects':
          parts.push(`${res.items?.length || 0} projeto(s) Vercel`);
          break;
        case 'bug_reports':
          parts.push(`${res.items?.length || 0} relatório(s) de bug`);
          break;
        case 'bug_report_deleted':
          parts.push(`relatório ${res.filename} excluído`);
          break;
      }
    }

    return {
      text: parts.length > 0 ? parts.join(', ') : 'Nenhuma ação executada',
      successCount,
      errorCount,
      total: results.length
    };
  }
}

module.exports = { ActionExecutor };
