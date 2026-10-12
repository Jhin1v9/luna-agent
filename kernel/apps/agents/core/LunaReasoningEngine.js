// ============================================================
// LUNA REASONING ENGINE v18.0 — A Luna Pensa Antes de Responder
// Chain-of-Thought: Decompor → Buscar → Analisar → Responder
// ============================================================

class LunaReasoningEngine {
  constructor(orchestrator, lunaBrain) {
    this.orchestrator = orchestrator;
    this.brain = lunaBrain;
  }

  /**
   * Processa uma pergunta com raciocínio em etapas
   */
  async think(question, context = {}) {
    const steps = [];

    // ETAPA 1: ENTENDER
    steps.push({ step: 'understand', text: 'Entendendo a pergunta...' });
    const understanding = await this._understand(question, context);
    steps.push({ step: 'understand', result: understanding });

    // ETAPA 2: BUSCAR DADOS
    steps.push({ step: 'search', text: 'Buscando dados relevantes...' });
    const data = await this._searchData(understanding);
    steps.push({ step: 'search', result: data });

    // ETAPA 3: ANALISAR
    steps.push({ step: 'analyze', text: 'Analisando padrões e riscos...' });
    const analysis = this._analyze(data, understanding);
    steps.push({ step: 'analyze', result: analysis });

    // ETAPA 4: SINTETIZAR RESPOSTA
    steps.push({ step: 'synthesize', text: 'Sintetizando resposta...' });
    const response = await this._synthesize(understanding, data, analysis, context);
    steps.push({ step: 'synthesize', result: response });

    return {
      text: response.text,
      thinking: steps,
      understanding,
      data,
      analysis
    };
  }

  // ── ETAPA 1: ENTENDER ──

  async _understand(question, context) {
    const q = question.toLowerCase();

    // Detectar entidades mencionadas
    const entities = this._extractEntities(q);

    // Detectar intenção principal
    const intent = this._detectIntent(q);

    // Detectar urgência
    const urgency = /urgente|agora|hj|hoje|asap|emergencia/i.test(q) ? 'high' :
                    /amanha|proxima|semana|depois/i.test(q) ? 'medium' : 'normal';

    // Detectar tom esperado
    const tone = /resumo|sumario|overview/i.test(q) ? 'summary' :
                 /detalhe|especifico|tudo/i.test(q) ? 'detailed' : 'balanced';

    return {
      original: question,
      entities,
      intent,
      urgency,
      tone,
      author: context.author || 'unknown'
    };
  }

  _extractEntities(text) {
    const entities = [];

    // Projetos
    const projectNames = ['santafe', 'dashboard', 'tropicale', 'superclim', 'nexo'];
    for (const name of projectNames) {
      if (text.includes(name)) entities.push({ type: 'project', name });
    }

    // Pessoas
    const people = ['abner', 'enoque', 'nonoke', 'elias', 'paulo', 'juan', 'jess', 'gesse'];
    for (const name of people) {
      if (text.includes(name)) entities.push({ type: 'person', name });
    }

    // Prioridades
    if (text.includes('P0')) entities.push({ type: 'priority', value: 'P0' });
    if (text.includes('P1')) entities.push({ type: 'priority', value: 'P1' });

    return entities;
  }

  _detectIntent(text) {
    if (/como esta|status|situacao|andamento/i.test(text)) return 'status_inquiry';
    if (/quanto|quando|quem|qual/i.test(text)) return 'factual_query';
    if (/fazer|faz|prioridade|foco/i.test(text)) return 'action_request';
    if (/resumo|sumario|overview|panorama/i.test(text)) return 'summary_request';
    if (/alerta|aviso|notifica|lembr/i.test(text)) return 'alert_request';
    return 'general';
  }

  // ── ETAPA 2: BUSCAR DADOS ──

  async _searchData(understanding) {
    const results = {};

    // Buscar dados dos agentes especializados
    const agentResult = await this.orchestrator.process(understanding.original);
    results.agentData = agentResult;

    // Buscar no Knowledge Graph
    for (const entity of understanding.entities) {
      if (entity.type === 'project') {
        const kgData = this.orchestrator.kg.findEntities('project', entity.name);
        results.kg = kgData;
      }
      if (entity.type === 'person') {
        const kgFacts = this.orchestrator.kg.getFacts(`person:${entity.name}`);
        results.personFacts = kgFacts;
      }
    }

    // Buscar na memória semântica
    const semanticResults = await this.orchestrator.sm.search(understanding.original, 5);
    results.memory = semanticResults;

    return results;
  }

  // ── ETAPA 3: ANALISAR ──

  _analyze(data, understanding) {
    const insights = [];
    const risks = [];
    const suggestions = [];

    const agentData = data.agentData?.data;

    // Analisar tarefas atrasadas
    if (agentData?.tasks?.overdue > 0) {
      risks.push(`${agentData.tasks.overdue} tarefa(s) atrasada(s)`);
    }

    // Analisar pagamentos pendentes
    if (agentData?.financial?.pendingPayments > 0) {
      risks.push(`${agentData.financial.pendingPayments} pagamento(s) pendente(s)`);
    }

    // Analisar leads sem follow-up
    if (agentData?.leads?.hot?.length > 0) {
      suggestions.push(`${agentData.leads.hot.length} lead(s) quente(s) precisa(m) de atenção`);
    }

    // Analisar comunicação com cliente
    if (agentData?.communication?.lastMention) {
      const daysSince = Math.floor((Date.now() - new Date(agentData.communication.lastMention.date).getTime()) / (24 * 60 * 60 * 1000));
      if (daysSince > 3) {
        risks.push(`Última comunicação há ${daysSince} dias`);
        suggestions.push('Enviar update ao cliente');
      }
    }

    // Analisar progresso do projeto
    if (agentData?.progress !== undefined) {
      if (agentData.progress < 30) {
        insights.push('Projeto em fase inicial');
      } else if (agentData.progress > 80) {
        insights.push('Projeto próximo da conclusão');
      }
    }

    return { insights, risks, suggestions };
  }

  // ── ETAPA 4: SINTETIZAR ──

  async _synthesize(understanding, data, analysis, context) {
    const agentText = data.agentData?.text || '';

    // Construir resposta inteligente
    let text = agentText;

    // Adicionar insights
    if (analysis.insights.length > 0) {
      text += '\n\n💡 *Insights:*\n' + analysis.insights.map(i => `• ${i}`).join('\n');
    }

    // Adicionar riscos
    if (analysis.risks.length > 0) {
      text += '\n\n⚠️ *Atenção:*\n' + analysis.risks.map(r => `• ${r}`).join('\n');
    }

    // Adicionar sugestões
    if (analysis.suggestions.length > 0) {
      text += '\n\n🎯 *Sugestões:*\n' + analysis.suggestions.map(s => `• ${s}`).join('\n');
    }

    // Personalizar pelo tom esperado
    if (understanding.tone === 'summary') {
      // Resumo já está conciso
    } else if (understanding.tone === 'detailed') {
      // Adicionar mais contexto se disponível
      const memContext = data.memory?.map(m => `• ${m.authorName}: "${m.body?.slice(0, 60)}..."`).join('\n');
      if (memContext) {
        text += '\n\n📚 *Contexto de conversas:*\n' + memContext;
      }
    }

    return { text };
  }
}

module.exports = { LunaReasoningEngine };
