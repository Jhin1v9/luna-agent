// ============================================================
// HUMAN FALLBACK ENGINE v18.0 — Quando o cérebro da Luna falha
// Respostas contextualizadas que parecem intencais, não erros.
// Baseado em: CPR Framework, AIX Design, SAP Persona
// ============================================================

class HumanFallbackEngine {
  constructor() {
    this.lastSuccess = Date.now();
    this.failureStreak = 0;
    this.interactions = []; // últimas interações para contexto

    // Frases de sleep mode aprovadas pelo usuário
    this.sleepPhrases = {
      internal: [
        "Dormi já, fala amanhã 😴",
        "Já tô de pijama, respondo cedo",
        "Amanhã cedo eu vejo isso, boa noite!",
        "Tô fora do pc agora, amanhã a gente resolve"
      ],
      client: [
        "Oi! Já saí do escritório. Amanhã cedo te respondo com calma, ok? Boa noite! 🌙",
        "Desculpa, já tô off por hoje. Amanhã cedo eu vejo isso direitinho.",
        "Já fechei o pc. Amanhã a gente resolve, pode ser? Boa noite! 😊"
      ],
      urgent: [
        "Eita, isso parece urgente. Me dá 2 minutos que dou uma olhada rápida...",
        "Parece sério. Tô off mas vou dar uma espiada rápida...",
        "Urgente? Ok, me dá um minuto que vejo o que consigo fazer daqui."
      ]
    };

    // Fallbacks por intenção — voz da Luna, não mensagens de sistema
    this.fallbacks = {
      greeting: [
        "Oi! Tô meio lenta agora (problema técnico), mas tô aqui. 😊",
        "Opa! Minha conexão com o cérebro tá ruim, mas não me abandona. 😅",
        "Cheguei! Só tô meio lerda hoje, desculpa. ☕"
      ],
      status: [
        "Não consigo acessar os dados agora, mas normalmente eu te mostraria o panorama. Tenta de novo daqui a pouco?",
        "Meu cérebro deu uma travada nos dados. Pede de novo daqui a pouco que eu respondo direitinho.",
        "Hmm, não tô conseguindo puxar as infos agora. Pode repetir daqui a pouco?"
      ],
      task_list: [
        "Anotado! (salvando localmente enquanto meu cérebro volta)",
        "Recebido! Assim que voltar eu organizo direitinho.",
        "Anotado no papel aqui, depois passo pro sistema. 📋"
      ],
      task_done: [
        "Boa! Anotei aqui, depois eu marco como concluída no sistema.",
        "Recebido! 🎉 Assim que voltar eu atualizo o radar.",
        "Show! Deixei anotado, quando o cérebro voltar eu fecho a tarefa."
      ],
      urgent: [
        "Eita, parece urgente. Não tô 100% agora, mas se for P0 manda de novo que eu forço a conexão.",
        "Parece importante! Tô meio lenta agora, mas manda de novo que eu priorizo.",
        "Urgente? Ok, não tô no meu melhor momento técnico, mas vou tentar de novo."
      ],
      url: [
        "Link recebido! Assim que voltar eu processo direitinho.",
        "Anotado o link! Depois eu vejo o que tem aí.",
        "Recebido! 📝 Quando o cérebro voltar eu analiso isso."
      ],
      social: [
        "KKKKKK boa! (tô meio lenta hoje mas ri de verdade)",
        "Aí sim! 😂 Tô com problema técnico mas isso aí foi ouro.",
        "KKKK boa essa! ☕"
      ],
      unknown: [
        "Me pegou desprevenida agora (problema técnico). Pode repetir daqui a pouco? 😅",
        "Eita, minha conexão com o cérebro caiu. Pede de novo daqui a pouco?",
        "Hmm, não entendi direito agora (problema técnico). Pode repetir?"
      ]
    };
  }

  recordSuccess() {
    this.lastSuccess = Date.now();
    this.failureStreak = 0;
  }

  recordFailure() {
    this.failureStreak++;
  }

  recordInteraction(type, author) {
    this.interactions.push({ type, author, time: Date.now() });
    if (this.interactions.length > 50) this.interactions.shift();
  }

  /**
   * Retorna uma frase de sleep mode contextualizada
   */
  getSleepReply({ authorName = 'chefe', isClient = false, isUrgent = false, isQuoted = false, authorKey = '' } = {}) {
    // Se for urgente e não é cliente, pode responder
    if (isUrgent && !isClient) {
      const phrases = this.sleepPhrases.urgent;
      return phrases[Math.floor(Math.random() * phrases.length)];
    }

    // Cliente sempre recebe tom mais profissional
    if (isClient) {
      const phrases = this.sleepPhrases.client;
      return phrases[Math.floor(Math.random() * phrases.length)];
    }

    // Interno: rotaciona frases, evita repetir a mesma para o mesmo autor
    const phrases = this.sleepPhrases.internal;
    const lastUsed = this._getLastSleepPhrase(authorKey);
    let chosen = phrases[Math.floor(Math.random() * phrases.length)];
    if (phrases.length > 1 && chosen === lastUsed) {
      chosen = phrases[(phrases.indexOf(chosen) + 1) % phrases.length];
    }
    this._setLastSleepPhrase(authorKey, chosen);

    // Personaliza com nome se conhecido
    const firstName = (authorName || '').split(' ')[0];
    if (firstName && firstName.length > 2 && !/chefe|ceo|boss/i.test(firstName)) {
      // Não força nome em todas, só em ~50% para parecer natural
      if (Math.random() < 0.5) {
        chosen = chosen.replace(/^(Dormi já|Já tô|Amanhã cedo|Tô fora)/, `$1, ${firstName}`);
      }
    }

    return chosen;
  }

  /**
   * Retorna fallback contextualizado quando LLM falha
   */
  getFallback(context = {}) {
    const { intent = 'unknown', authorName = 'chefe', topic = 'general', urgency = 'normal', quotedBody = '' } = context;

    // Se falhou muitas vezes seguidas, admite cansaço
    if (this.failureStreak >= 3) {
      return `Tô meio lenta hoje, desculpa. Já são ${this.failureStreak} travadas seguidas 😅\n${this._pickFallback(intent, authorName)}`;
    }

    // Se último sucesso foi há mais de 5 min, menciona
    const minsSinceSuccess = Math.floor((Date.now() - this.lastSuccess) / 60000);
    if (minsSinceSuccess > 5) {
      return `Eita, minha conexão com o cérebro tá ruim faz ${minsSinceSuccess}min 😅\n${this._pickFallback(intent, authorName)}`;
    }

    return this._pickFallback(intent, authorName);
  }

  _pickFallback(intent, authorName) {
    const pool = this.fallbacks[intent] || this.fallbacks.unknown;
    const base = pool[Math.floor(Math.random() * pool.length)];
    // Personaliza com nome em ~30% dos casos
    const firstName = (authorName || '').split(' ')[0];
    if (firstName && firstName.length > 2 && !/chefe|ceo|boss/i.test(firstName) && Math.random() < 0.3) {
      return base.replace(/(tô aqui|desculpa|não me abandona)/, `${firstName}, $1`);
    }
    return base;
  }

  _getLastSleepPhrase(authorKey) {
    try {
      const map = require('../../dashboard/data/luna-sleep-phrases.json');
      return map[authorKey] || null;
    } catch { return null; }
  }

  _setLastSleepPhrase(authorKey, phrase) {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '../../dashboard/data/luna-sleep-phrases.json');
      let map = {};
      try { map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      map[authorKey] = phrase;
      fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf8');
    } catch { /* silent */ }
  }
}

module.exports = { HumanFallbackEngine };
