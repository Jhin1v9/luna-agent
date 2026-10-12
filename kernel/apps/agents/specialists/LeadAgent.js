// ============================================================
// LEAD AGENT v18.0 — Especialista em Leads
// Sabe qualificar, rastrear follow-up, e identificar oportunidades.
// ============================================================

class LeadAgent {
  constructor(dataAPI, knowledgeGraph) {
    this.dataAPI = dataAPI;
    this.kg = knowledgeGraph;
    this.name = 'Leads';
  }

  async answer(question, context = {}) {
    const q = question.toLowerCase();

    // Leads que precisam atenção
    if (/atencao|seguir|follow|urgente|quente/i.test(q)) {
      return this.getHotLeads();
    }

    // Pipeline geral
    return this.getPipelineSummary();
  }

  getHotLeads() {
    const pipeline = this.dataAPI.getLeadPipeline();

    if (pipeline.hot.length === 0) {
      return { text: '🔥 Nenhum lead quente no momento.', data: [] };
    }

    const list = pipeline.hot.slice(0, 5).map(l =>
      `• ${l.name || 'Lead'}: ${l.context || l.source || 'Sem contexto'}`
    ).join('\n');

    return {
      text: `🔥 *Leads Quentes* (${pipeline.hot.length})\n\n${list}\n\n_Quer que eu prepare mensagens de follow-up?_`,
      data: pipeline.hot
    };
  }

  getPipelineSummary() {
    const pipeline = this.dataAPI.getLeadPipeline();

    let stageText = '';
    for (const [stage, leads] of Object.entries(pipeline.stages)) {
      stageText += `• ${stage}: ${leads.length}\n`;
    }

    return {
      text: `🎣 *Pipeline de Leads*\n\n` +
            `Total: ${pipeline.total}\n` +
            `Quentes: ${pipeline.hot.length}\n` +
            `Frios: ${pipeline.cold.length}\n\n` +
            `*Por estágio:*\n${stageText}`,
      data: pipeline
    };
  }
}

module.exports = { LeadAgent };
