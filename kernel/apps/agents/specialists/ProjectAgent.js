// ============================================================
// PROJECT AGENT v18.0 — Especialista em Projetos
// Sabe status, milestones, blockers, riscos, e progresso.
// ============================================================

class ProjectAgent {
  constructor(dataAPI, knowledgeGraph) {
    this.dataAPI = dataAPI;
    this.kg = knowledgeGraph;
    this.name = 'Projetos';
  }

  async answer(question, context = {}) {
    const q = question.toLowerCase();

    // Status de projeto específico
    const projectMatch = q.match(/(?:projeto|project)\s+(\w+)|\b(santafe|dashboard|tropicale|superclim)\b/i);
    if (projectMatch) {
      const projectName = projectMatch[1] || projectMatch[2];
      return this.getProjectDetail(projectName);
    }

    // O que está atrasado?
    if (/atrasad|atraso|delay|late/i.test(q)) {
      return this.getOverdueProjects();
    }

    // Resumo de todos os projetos
    return this.getAllProjectsSummary();
  }

  getProjectDetail(projectIdOrName) {
    const status = this.dataAPI.getProjectStatus(projectIdOrName);
    if (!status) {
      // Tentar busca case-insensitive
      const projects = this.dataAPI.getProjectsRegistry();
      const project = Object.values(projects.projects || {}).find(p =>
        p.id?.toLowerCase() === projectIdOrName.toLowerCase() ||
        p.codename?.toLowerCase() === projectIdOrName.toLowerCase() ||
        p.name?.toLowerCase().includes(projectIdOrName.toLowerCase())
      );
      if (project) {
        return this.getProjectDetail(project.id);
      }
      return { text: `❓ Não encontro o projeto "${projectIdOrName}" no registro.`, data: null };
    }

    const p = status.project;
    const milestones = p.milestones || [];
    const done = milestones.filter(m => m.done);
    const pending = milestones.filter(m => !m.done);

    let milestoneText = '';
    if (milestones.length > 0) {
      milestoneText = '\n\n📋 *Milestones:*\n' +
        milestones.map(m => `${m.done ? '✅' : '⬜'} ${m.name}${m.date ? ` (${m.date})` : ''}`).join('\n');
    }

    const riskText = status.tasks.overdue > 0
      ? `\n\n⚠️ *Risco:* ${status.tasks.overdue} tarefa(s) atrasada(s).`
      : '';

    const commText = status.communication.lastMention
      ? `\n\n💬 Última menção: ${status.communication.lastMention.author} — "${status.communication.lastMention.body?.slice(0, 50)}..." (${new Date(status.communication.lastMention.date).toLocaleDateString('pt-BR')})`
      : '\n\n💬 Nenhuma menção recente.';

    return {
      text: `📊 *${p.name}* (${p.codename})\n\n` +
            `Progresso: ${status.progress}% (${done.length}/${milestones.length} milestones)\n` +
            `Status: ${p.status}\n` +
            `Prioridade: ${p.priority}\n` +
            `Tarefas: ${status.tasks.open} abertas${status.tasks.overdue > 0 ? `, ${status.tasks.overdue} atrasadas` : ''}` +
            milestoneText + riskText + commText,
      data: status
    };
  }

  getOverdueProjects() {
    const projects = this.dataAPI.getProjectsRegistry();
    const allProjects = Object.values(projects.projects || {});
    const overdue = [];

    for (const proj of allProjects) {
      const status = this.dataAPI.getProjectStatus(proj.id);
      if (status && status.tasks.overdue > 0) {
        overdue.push({ project: proj, ...status });
      }
    }

    if (overdue.length === 0) {
      return { text: '✅ Nenhum projeto com tarefas atrasadas no momento.', data: [] };
    }

    const list = overdue.map(o =>
      `• ${o.project.name}: ${o.tasks.overdue} tarefa(s) atrasada(s), ${o.tasks.open} aberta(s)`
    ).join('\n');

    return {
      text: `⚠️ *Projetos com Atrasos* (${overdue.length})\n\n${list}`,
      data: overdue
    };
  }

  getAllProjectsSummary() {
    const projects = this.dataAPI.getProjectsRegistry();
    const all = Object.values(projects.projects || {});

    if (all.length === 0) {
      return { text: '📊 Nenhum projeto registrado.', data: [] };
    }

    const summaries = all.map(p => {
      const status = this.dataAPI.getProjectStatus(p.id);
      const progress = status ? status.progress : 0;
      const emoji = progress >= 80 ? '🟢' : progress >= 50 ? '🟡' : progress >= 20 ? '🟠' : '🔴';
      return `${emoji} *${p.name}*: ${progress}% — ${p.status}`;
    }).join('\n');

    return {
      text: `📊 *Projetos NEXO* (${all.length})\n\n${summaries}`,
      data: all
    };
  }
}

module.exports = { ProjectAgent };
