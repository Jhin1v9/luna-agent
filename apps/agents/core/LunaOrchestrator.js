// ============================================================
// LUNA ORCHESTRATOR v18.0 — O Cérebro da Luna
// Roteia perguntas para agentes especializados.
// Sintetiza respostas em linguagem natural.
// ============================================================

const { LunaDataAPI } = require('./LunaDataAPI');
const { LunaKnowledgeGraph } = require('./LunaKnowledgeGraph');
const { LunaSemanticMemory } = require('./LunaSemanticMemory');
const { FinanceAgent } = require('../specialists/FinanceAgent');
const { ProjectAgent } = require('../specialists/ProjectAgent');
const { TaskAgent } = require('../specialists/TaskAgent');
const { LeadAgent } = require('../specialists/LeadAgent');
const { PeopleAgent } = require('../specialists/PeopleAgent');

class LunaOrchestrator {
  constructor(ollamaHost = 'http://localhost:11434') {
    this.dataAPI = new LunaDataAPI();
    this.kg = new LunaKnowledgeGraph();
    this.sm = new LunaSemanticMemory(ollamaHost);

    // Agentes especializados
    this.agents = {
      finance: new FinanceAgent(this.dataAPI, this.kg),
      project: new ProjectAgent(this.dataAPI, this.kg),
      task: new TaskAgent(this.dataAPI, this.kg),
      lead: new LeadAgent(this.dataAPI, this.kg),
      people: new PeopleAgent(this.dataAPI, this.kg, this.sm, null) // memory injetada depois
    };

    this.ollamaHost = ollamaHost;
  }

  // ── ENTRY POINT: Processar pergunta ──

  async process(question, context = {}) {
    const startTime = Date.now();

    // ETAPA 1: CLASSIFICAR INTENÇÃO
    const intent = this._classifyIntent(question);

    // ETAPA 2: ROTEAR PARA AGENTES
    const responses = [];
    for (const agentKey of intent.agents) {
      const agent = this.agents[agentKey];
      if (agent) {
        try {
          const response = await agent.answer(question, context);
          if (response) responses.push({ agent: agentKey, name: agent.name, ...response });
        } catch (e) {
          console.error(`[Orchestrator] Erro no agente ${agentKey}:`, e.message);
        }
      }
    }

    // ETAPA 3: SINTETIZAR RESPOSTA
    const synthesis = this._synthesize(responses, intent, question);

    // ETAPA 4: ENRIQUECER COM CONTEXTO DO KNOWLEDGE GRAPH
    const enriched = await this._enrichWithKG(synthesis, question);

    const duration = Date.now() - startTime;
    console.log(`[Orchestrator] Processado em ${duration}ms`);

    return {
      text: enriched.text,
      data: enriched.data,
      thinking: enriched.thinking,
      agentsUsed: intent.agents,
      duration
    };
  }

  // ── CLASSIFICAÇÃO DE INTENÇÃO ──

  _classifyIntent(question) {
    const q = question.toLowerCase();
    const agents = [];
    let confidence = 0;

    // Financeiro
    if (/pag(ou|amento|ar)|fatura|caixa|dinheiro|eur|euro|€|receita|despesa|gasto|orcamento|quote|balanco/i.test(q)) {
      agents.push('finance');
      confidence += 0.3;
    }

    // Projetos
    if (/projeto|project|status|milestone|progresso|santafe|dashboard|tropicale|superclim|site|web/i.test(q)) {
      agents.push('project');
      confidence += 0.3;
    }

    // Tarefas
    if (/tarefa|task|fazer|faz|prioridade|foco|hoje|atrasad|deadline|prazo|todo/i.test(q)) {
      agents.push('task');
      confidence += 0.3;
    }

    // Leads
    if (/lead|cliente|prospect|follow|seguir|oportunidade|venda/i.test(q)) {
      agents.push('lead');
      confidence += 0.3;
    }

    // Pessoas
    if (/abner|enoque|nonoke|elias|paulo|juan|equipe|time|responsavel|quem/i.test(q)) {
      agents.push('people');
      confidence += 0.2;
    }

    // Se nenhum agente identificado, usar todos (busca ampla)
    if (agents.length === 0) {
      agents.push('task', 'project', 'finance');
      confidence = 0.1;
    }

    return { agents: [...new Set(agents)], confidence };
  }

  // ── SÍNTESE ──

  _synthesize(responses, intent, originalQuestion) {
    if (responses.length === 0) {
      return {
        text: '🌙 Não consegui encontrar informações sobre isso. Posso tentar de outra forma?',
        data: null,
        thinking: 'Nenhum agente retornou dados.'
      };
    }

    if (responses.length === 1) {
      return {
        text: responses[0].text,
        data: responses[0].data,
        thinking: `Consultei o agente de ${responses[0].name}.`
      };
    }

    // Múltiplos agentes: juntar as respostas
    const parts = responses.map(r => r.text);
    const combined = parts.join('\n\n───\n\n');

    return {
      text: combined,
      data: responses.map(r => ({ agent: r.agent, data: r.data })),
      thinking: `Consultei ${responses.length} agentes: ${responses.map(r => r.name).join(', ')}.`
    };
  }

  // ── ENRIQUECIMENTO COM KG ──

  async _enrichWithKG(synthesis, question) {
    const q = question.toLowerCase();

    // Se a pergunta é sobre um projeto, adicionar alertas do KG
    const projects = this.kg.findEntities('project');
    for (const proj of projects) {
      if (q.includes(proj.name.toLowerCase()) || q.includes((proj.attributes?.codename || '').toLowerCase())) {
        const facts = this.kg.getFacts(`project:${proj.id}`);
        const pendingFacts = facts.filter(f =>
          f.attribute === 'deadline' || f.attribute === 'pagamento'
        );

        if (pendingFacts.length > 0) {
          const extra = '\n\n💡 *Contexto adicional:*\n' +
            pendingFacts.map(f => `• ${f.attribute}: ${f.value}`).join('\n');
          return { ...synthesis, text: synthesis.text + extra };
        }
      }
    }

    return synthesis;
  }

  // ── CONSULTAS RÁPIDAS ──

  async quickQuery(type, params = {}) {
    switch (type) {
      case 'projectStatus':
        return this.agents.project.getProjectDetail(params.project);
      case 'clientStatus':
        return this.agents.finance.getClientPaymentStatus(params.client);
      case 'dailyDigest':
        return this.dataAPI.getDailyDigest();
      case 'taskFocus':
        return this.agents.task.getTodayFocus();
      default:
        return null;
    }
  }

  getStats() {
    return {
      kg: this.kg.getStats(),
      sm: this.sm.getStats(),
      agents: Object.keys(this.agents)
    };
  }
}

module.exports = { LunaOrchestrator };
