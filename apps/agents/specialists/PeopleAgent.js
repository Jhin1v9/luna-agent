// ============================================================
// PEOPLE AGENT v18.0 — Especialista em Pessoas
// Sabe preferências, perfis, histórico de interação de cada CEO.
// ============================================================

class PeopleAgent {
  constructor(dataAPI, knowledgeGraph, semanticMemory, memory) {
    this.dataAPI = dataAPI;
    this.kg = knowledgeGraph;
    this.sm = semanticMemory;
    this.memory = memory; // LunaMemory_v17 — para inferCeoPreferences
    this.name = 'Pessoas';
  }

  async answer(question, context = {}) {
    const q = question.toLowerCase();

    // Preferências de alguém
    if (/prefere|gosta|estilo|como (é|eh) (\w+)/i.test(q)) {
      const person = this._extractPerson(q);
      if (person) return this.getPersonProfile(person);
    }

    // Quem é responsável por quê
    if (/responsavel|quem (cuida|faz|gerencia)|a quem/i.test(q)) {
      return this.getResponsibilities();
    }

    return this.getTeamSummary();
  }

  getPersonProfile(person) {
    // Buscar no schema
    const contacts = this.dataAPI.getContactsMap();
    const contact = Object.values(contacts.contacts || {}).find(c =>
      c.name?.toLowerCase().includes(person.toLowerCase()) ||
      c.displayName?.toLowerCase().includes(person.toLowerCase())
    );

    // Buscar mensagens recentes
    const history = this.dataAPI.getWhatsAppHistory();
    const messages = (history.messages || []).filter(m =>
      (m.pushname || '').toLowerCase().includes(person.toLowerCase()) ||
      (m.author || '').toLowerCase().includes(person.toLowerCase())
    );

    // Buscar tarefas
    const tasks = this.dataAPI.queryTasks({}).filter(t =>
      t.assignee?.toLowerCase().includes(person.toLowerCase()) ||
      (t.body || '').toLowerCase().includes(person.toLowerCase())
    );

    const openTasks = tasks.filter(t => t.status !== 'concluido' && t.status !== 'done');

    // ── PERFIL ADAPTATIVO v18.0 ──
    let preferencesText = '';
    if (this.memory && contact?.phone) {
      const prefs = this.memory.inferCeoPreferences(contact.phone);
      if (prefs) {
        const styleEmoji = prefs.style === 'friendly' ? '😊' : prefs.style === 'formal' ? '🧐' : '😐';
        const detailEmoji = prefs.detail === 'high' ? '📚' : prefs.detail === 'low' ? '💨' : '📋';
        preferencesText = `\n\n🎯 *Perfil detectado:*\n${styleEmoji} Estilo: ${prefs.style}\n${detailEmoji} Detalhe: ${prefs.detail}`;
      }
    }
    // ────────────────────────────────

    return {
      text: `👤 *${contact?.displayName || contact?.name || person}*\n\n` +
            `📋 Tarefas: ${openTasks.length} abertas\n` +
            `💬 Mensagens recentes: ${messages.length}` +
            preferencesText + '\n\n' +
            `${openTasks.length > 0 ? 'Tarefas abertas:\n' + openTasks.slice(0, 3).map(t => `• ${t.title || t.body}`).join('\n') : '✅ Sem tarefas abertas'}`,
      data: { contact, tasks, messages }
    };
  }

  /**
   * Adapta uma resposta baseada no perfil do CEO
   * v18.0 — Personalidade Adaptativa
   */
  adaptResponse(text, authorPhoneOrName) {
    if (!this.memory) return text;

    // Tentar inferir preferências
    let prefs = null;
    if (authorPhoneOrName) {
      prefs = this.memory.inferCeoPreferences(authorPhoneOrName);
    }

    if (!prefs) return text;

    let adapted = text;

    // Ajustar tom
    if (prefs.style === 'formal') {
      adapted = adapted
        .replace(/opa/gi, 'Olá')
        .replace(/chefe/gi, 'senhor')
        .replace(/beleza/gi, 'entendido')
        .replace(/bora/gi, 'vamos');
    } else if (prefs.style === 'friendly') {
      // Já é friendly, manter
    }

    // Ajustar nível de detalhe
    if (prefs.detail === 'low') {
      // Manter resumo, remover detalhes extras
      const lines = adapted.split('\n');
      adapted = lines.slice(0, 6).join('\n');
    } else if (prefs.detail === 'high') {
      // Adicionar mais contexto se disponível
      // (o agente já retorna dados completos, então isso é mais uma flag)
    }

    return adapted;
  }

  getResponsibilities() {
    const tasks = this.dataAPI.queryTasks({});
    const byPerson = {};

    for (const t of tasks) {
      const assignee = t.assignee || t.assigneeName || 'Não atribuído';
      if (!byPerson[assignee]) byPerson[assignee] = { open: 0, done: 0 };
      if (t.status === 'concluido' || t.status === 'done') {
        byPerson[assignee].done++;
      } else {
        byPerson[assignee].open++;
      }
    }

    const list = Object.entries(byPerson)
      .map(([person, stats]) => `• ${person}: ${stats.open} abertas, ${stats.done} concluídas`)
      .join('\n');

    return {
      text: `👥 *Distribuição de Responsabilidades*\n\n${list}`,
      data: byPerson
    };
  }

  getTeamSummary() {
    const registry = this.dataAPI.getClientsRegistry();
    const contacts = this.dataAPI.getContactsMap();
    const nexoTeam = Object.values(contacts.contacts || {}).filter(c => c.isNexo || c.role?.includes('CEO'));

    return {
      text: `👥 *Equipe NEXO* (${nexoTeam.length})\n\n` +
            nexoTeam.map(p => `• ${p.displayName || p.name} — ${p.role || 'Membro'}`).join('\n') + '\n\n' +
            `Clientes: ${Object.keys(registry.clients || {}).length}`,
      data: nexoTeam
    };
  }

  _extractPerson(q) {
    const known = ['abner', 'enoque', 'nonoke', 'elias', 'paulo', 'juan', 'jess', 'gesse', 'lucas'];
    for (const name of known) {
      if (q.includes(name)) return name;
    }
    return null;
  }
}

module.exports = { PeopleAgent };
