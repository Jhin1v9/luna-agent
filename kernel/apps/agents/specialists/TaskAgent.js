// ============================================================
// TASK AGENT v18.0 — Especialista em Tarefas
// Sabe priorizar, distribuir, e identificar o que precisa ser feito.
// ============================================================

class TaskAgent {
  constructor(dataAPI, knowledgeGraph) {
    this.dataAPI = dataAPI;
    this.kg = knowledgeGraph;
    this.name = 'Tarefas';
  }

  async answer(question, context = {}) {
    const q = question.toLowerCase();

    // O que devo fazer hoje?
    if (/o que (devo|deveria|preciso) fazer|prioridade|foco|hoje/i.test(q)) {
      return this.getTodayFocus();
    }

    // Tarefas atrasadas
    if (/atrasad|atraso|overdue|vencid/i.test(q)) {
      return this.getOverdueTasks();
    }

    // Tarefas por prioridade
    if (/P0|P1|prioridade (alta|baixa)|urgente/i.test(q)) {
      const priority = q.includes('P0') ? 'P0' : q.includes('P1') ? 'P1' : null;
      return this.getTasksByPriority(priority);
    }

    // Tarefas por pessoa
    if (/tarefas (de|do|da) (\w+)|o que (\w+) (tem|faz)/i.test(q)) {
      const person = this._extractPerson(q);
      if (person) return this.getTasksByPerson(person);
    }

    // Resumo geral
    return this.getTasksSummary();
  }

  getTodayFocus() {
    const p0 = this.dataAPI.queryTasks({ priority: 'P0' });
    const p1 = this.dataAPI.queryTasks({ priority: 'P1' });
    const overdue = this.dataAPI.queryTasks({}).filter(t => {
      const due = t.dueDate ? new Date(t.dueDate) : null;
      return due && due < new Date() && t.status !== 'concluido' && t.status !== 'done';
    });

    let text = '🎯 *Foco do Dia*\n\n';

    if (p0.length > 0) {
      text += `🔴 *P0 (${p0.length}):*\n${p0.slice(0, 3).map(t => `• ${t.title || t.body || 'Tarefa'}`).join('\n')}\n\n`;
    }

    if (overdue.length > 0) {
      text += `⏰ *Atrasadas (${overdue.length}):*\n${overdue.slice(0, 3).map(t => `• ${t.title || t.body || 'Tarefa'}`).join('\n')}\n\n`;
    }

    if (p1.length > 0) {
      text += `🟠 *P1 (${p1.length}):*\n${p1.slice(0, 3).map(t => `• ${t.title || t.body || 'Tarefa'}`).join('\n')}\n\n`;
    }

    if (p0.length === 0 && p1.length === 0 && overdue.length === 0) {
      text += '✅ Nenhuma tarefa crítica no momento. Pode respirar! 😌';
    }

    return { text, data: { p0, p1, overdue } };
  }

  getOverdueTasks() {
    const tasks = this.dataAPI.queryTasks({ overdue: true });

    if (tasks.length === 0) {
      return { text: '✅ Nenhuma tarefa atrasada! Excelente.', data: [] };
    }

    const list = tasks.slice(0, 10).map(t =>
      `• ${t.title || t.body || 'Tarefa'} ${t.dueDate ? `(vencida: ${new Date(t.dueDate).toLocaleDateString('pt-BR')})` : ''}`
    ).join('\n');

    return {
      text: `⏰ *Tarefas Atrasadas* (${tasks.length})\n\n${list}${tasks.length > 10 ? `\n...e mais ${tasks.length - 10}` : ''}`,
      data: tasks
    };
  }

  getTasksByPriority(priority = null) {
    const tasks = priority
      ? this.dataAPI.queryTasks({ priority })
      : this.dataAPI.queryTasks({});

    if (tasks.length === 0) {
      return { text: `📋 Nenhuma tarefa${priority ? ` ${priority}` : ''} encontrada.`, data: [] };
    }

    const byPriority = {};
    for (const t of tasks) {
      const p = t.priority || 'Sem prioridade';
      if (!byPriority[p]) byPriority[p] = [];
      byPriority[p].push(t);
    }

    let text = `📋 *Tarefas* (${tasks.length})\n\n`;
    for (const [p, list] of Object.entries(byPriority)) {
      const emoji = p === 'P0' ? '🔴' : p === 'P1' ? '🟠' : p === 'P2' ? '🟡' : '⚪';
      text += `${emoji} *${p}* (${list.length}):\n${list.slice(0, 5).map(t => `• ${t.title || t.body || 'Tarefa'}`).join('\n')}\n\n`;
    }

    return { text, data: tasks };
  }

  getTasksByPerson(person) {
    const tasks = this.dataAPI.queryTasks({}).filter(t =>
      t.assignee?.toLowerCase().includes(person.toLowerCase()) ||
      t.assigneeName?.toLowerCase().includes(person.toLowerCase()) ||
      (t.body || '').toLowerCase().includes(person.toLowerCase())
    );

    if (tasks.length === 0) {
      return { text: `📋 Nenhuma tarefa associada a "${person}".`, data: [] };
    }

    const open = tasks.filter(t => t.status !== 'concluido' && t.status !== 'done');
    const done = tasks.filter(t => t.status === 'concluido' || t.status === 'done');

    return {
      text: `📋 *Tarefas de ${person}*\n\n` +
            `Abertas: ${open.length}\n` +
            `Concluídas: ${done.length}\n\n` +
            `${open.slice(0, 5).map(t => `• ${t.title || t.body || 'Tarefa'}`).join('\n')}`,
      data: { open, done }
    };
  }

  getTasksSummary() {
    const tasks = this.dataAPI.queryTasks({});
    const p0 = tasks.filter(t => t.priority === 'P0');
    const p1 = tasks.filter(t => t.priority === 'P1');
    const open = tasks.filter(t => t.status !== 'concluido' && t.status !== 'done');
    const done = tasks.filter(t => t.status === 'concluido' || t.status === 'done');

    return {
      text: `📋 *Resumo de Tarefas*\n\n` +
            `Total: ${tasks.length}\n` +
            `Abertas: ${open.length}\n` +
            `Concluídas: ${done.length}\n` +
            `P0: ${p0.length} | P1: ${p1.length}\n\n` +
            `_Quer ver as P0, as atrasadas, ou por pessoa?_)`,
      data: { total: tasks.length, open: open.length, done: done.length, p0: p0.length, p1: p1.length }
    };
  }

  _extractPerson(q) {
    const known = ['abner', 'enoque', 'nonoke', 'elias', 'paulo', 'juan'];
    for (const name of known) {
      if (q.includes(name)) return name;
    }
    return null;
  }
}

module.exports = { TaskAgent };
