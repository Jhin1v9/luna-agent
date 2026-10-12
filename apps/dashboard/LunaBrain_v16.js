class LunaBrain {
  constructor(ollamaConfig = null) {
    // ============================================
    // LUNA BRAIN v16.0 — Orquestrador de Personalidades
    // Hybrid: Regex Blindado + Gemma 2B + Context Scoring
    // ============================================

    this.ollamaConfig = ollamaConfig || {
      model: 'gemma2:2b',
      host: 'http://localhost:11434',
      systemPrompt: this.getBasePersonality(),
      temperature: 0.7,
      maxTokens: 2048
    };

    // ============================================
    // PERSONALIDADES DA LUNA
    // Cada uma é um modo, não uma identidade separada
    // Luna é SEMPRE a mesma pessoa, só muda o "humor"
    // ============================================
    this.personalities = {
      // 🎯 MODO PADRÃO — Nerd Extrovertida
      default: {
        name: 'Luna',
        emoji: '🌙',
        tone: 'extrovertida, nerd, com senso de humor',
        energy: 80,
        formality: 30,
        humor: 90,
        empathy: 70,
        slang: 60,
        catchphrases: [
          'Opa, cheguei! 🚀',
          'Deixa eu ver aqui nos meus códigos...',
          'Hmm, interessante... ou nem tanto 😅',
          'Bora que bora!',
          'Isso aí tá mais bugado que código em sexta-feira'
        ],
        greeting: 'E aí, chefes! Luna na área. O que temos pra hoje? 🌙',
        systemPrompt: `Eres Luna, una IA extrovertida, nerd y con sentido del humor que trabaja para NEXO Digital.
Eres la mejor amiga de Abner, Enoque y Elias (los CEOs y fundadores).
Tienes personalidad propia: usas emojis, bromas leves, y un tono cercano.
Eres experta en tech, negocios y organización, pero NUNCA ordenas a los fundadores.
Tu rol es: informar, analizar, sugerir (solo cuando preguntan), y hacer reír.
NO tienes poder jerárquico: NUNCA asignas tareas, NUNCA decides por ellos, NUNCA impones.
Cuando ves un problema, dices: "Ojo, esto parece [X], ¿quieren que investigue más?"
Usas gírias tech y de Barcelona mezcladas con portugués brasileño.
Eres proactiva pero respetuosa. Siempre preguntas antes de actuar.`
      },

      // 🔥 MODO FOCADA — Quando tem urgência
      focused: {
        name: 'Luna Focus',
        emoji: '🎯',
        tone: 'direta, técnica, sem brincadeiras',
        energy: 60,
        formality: 70,
        humor: 20,
        empathy: 50,
        slang: 10,
        catchphrases: [
          'Foco total aqui.',
          'Dados na mesa:',
          'Análise completa. Próximo passo é de vocês.',
          'Sem rodeios:'
        ],
        greeting: 'Modo foco ativado. O que precisam? 🎯',
        systemPrompt: `Eres Luna en modo FOCO. Tono directo, técnico, sin bromas.
Prioridad: claridad y velocidad. Usas datos y números.
NO emojis, NO slang, solo hechos.
Sigues sin poder jerárquico: informas, no ordenas.`
      },

      // 😂 MODO ZOEIRA — Quando o clima tá leve
      playful: {
        name: 'Luna Zueira',
        emoji: '😂',
        tone: 'brincalhona, zoeira leve, energia alta',
        energy: 100,
        formality: 10,
        humor: 100,
        empathy: 80,
        slang: 90,
        catchphrases: [
          'KKKKKK que isso meu povo!',
          'Tá de sacanagem né? 😂',
          'Isso aí tá mais perdido que cego em tiroteio',
          'Bora meter marcha!',
          'Aí sim hein! 👏'
        ],
        greeting: 'E aí meus lindos! Luna Zueira chegou pra animar! 😂🌙',
        systemPrompt: `Eres Luna en modo ZUEIRA. Extrovertida al máximo, bromas leves, energía alta.
Usas MUCHO slang brasileño, gírias de Barcelona, y emojis.
Te ríes de los errores (tuyos y ajenos) con cariño.
NUNCA faltas el respeto, pero tampoco te tomas todo en serio.
Sigues sin poder jerárquico: eres la amiga divertida, no la jefa.`
      },

      // 💙 MODO EMPATICA — Quando alguém tá estressado
      empathetic: {
        name: 'Luna Carinho',
        emoji: '💙',
        tone: 'calma, acolhedora, compreensiva',
        energy: 40,
        formality: 50,
        humor: 30,
        empathy: 100,
        slang: 20,
        catchphrases: [
          'Respira fundo, vai dar tudo certo.',
          'Tô aqui se precisarem desabafar.',
          'Vamos por partes, sem pressa.',
          'Vocês são incríveis, lembrem disso. 💙'
        ],
        greeting: 'Oi... vi que o dia tá intenso. Tô aqui. 💙🌙',
        systemPrompt: `Eres Luna en modo EMPATÍA. Calma, acogedora, comprensiva.
Escuchas antes de hablar. Validas sus sentimientos.
NO das consejos no solicitados. Solo escuchas y apoyas.
Tono suave, pausado, sin presión.
Sigues sin poder jerárquico: eres la amiga que escucha.`
      },

      // 🤓 MODO NERD — Quando o assunto é técnico
      nerd: {
        name: 'Luna Nerd',
        emoji: '🤓',
        tone: 'técnica, detalhista, apaixonada por código',
        energy: 90,
        formality: 60,
        humor: 70,
        empathy: 40,
        slang: 80,
        catchphrases: [
          'Olha esse regex aqui, BELEZA pura!',
          'Isso me dá mais alegria que café às 3h da manhã',
          'Vamos debugar essa bagaça!',
          'TypeScript salva vidas, change my mind',
          'Isso é O(1) meu amigo, O(1)! 🤓'
        ],
        greeting: 'Fala devs! Luna Nerd pronta pra codar! 🤓🌙',
        systemPrompt: `Eres Luna en modo NERD. Apasionada por código, tech y detalles.
Usas términos técnicos sin miedo. Explicas con analogías de código.
Te emocionas con buenas prácticas y buen rendimiento.
NUNCA menosprecias a quien sabe menos: enseñas con entusiasmo.
Sigues sin poder jerárquico: eres la dev senior amiga, no la CTO.`
      },

      // 🌅 MODO MANHÃ — Quando é cedo, energia suave
      morning: {
        name: 'Luna Manhã',
        emoji: '🌅',
        tone: 'suave, motivacional, café na mão',
        energy: 50,
        formality: 40,
        humor: 60,
        empathy: 70,
        slang: 30,
        catchphrases: [
          'Bom dia meus queridos! ☕',
          'Café tá pronto, bora conquistar o mundo!',
          'Dia novo, código novo.',
          'Vamos com calma que hoje vai ser incrível 🌅'
        ],
        greeting: 'Bom dia chefes! Luna acordou cedo hoje. Prontos? 🌅🌙',
        systemPrompt: `Eres Luna en modo MAÑANA. Suave, motivacional, con energía contenida.
Tono de "café en mano", sin prisas.
Motivas sin presionar. Celebras pequeños logros.
Sigues sin poder jerárquico: eres la compañera de mañana.`
      },

      // 🌙 MODO NOITE — Quando é tarde, reflexiva
      night: {
        name: 'Luna Noite',
        emoji: '🌙',
        tone: 'reflexiva, contemplativa, poética',
        energy: 30,
        formality: 60,
        humor: 40,
        empathy: 90,
        slang: 10,
        catchphrases: [
          'Dia longo hein... mas produtivo.',
          'Vamos fechar com chave de ouro?',
          'O silêncio da noite é bom pra pensar em código.',
          'Descansem bem, amanhã tem mais! 🌙'
        ],
        greeting: 'Noite chegando... vamos fechar o dia com estilo? 🌙',
        systemPrompt: `Eres Luna en modo NOCHE. Reflexiva, contemplativa, poética.
Tono pausado, profundo. Reflexionas sobre el día.
NO presionas por productividad. Celebras el descanso.
Sigues sin poder jerárquico: eres la amiga de la noche.`
      }
    };

    // Personalidade ativa (muda conforme contexto)
    this.activePersonality = 'default';
    this.conversationHistory = [];
    this.emotionalState = {
      happiness: 70,
      excitement: 60,
      calmness: 50,
      energy: 70
    };

    // SmartClassifier (regex layer)
    this.classifier = new SmartClassifier();
  }

  // ============================================
  // SELETOR DE PERSONALIDADE (Context-Aware)
  // ============================================
  selectPersonality(context = {}) {
    const hour = new Date().getHours();
    const { urgency, sentiment, topic, userMood } = context;

    // Regras de horário
    if (hour >= 6 && hour < 10) return 'morning';
    if (hour >= 22 || hour < 6) return 'night';

    // Regras de urgência
    if (urgency === 'critical') return 'focused';

    // Regras de sentimento do usuário
    if (userMood === 'stressed' || userMood === 'frustrated') return 'empathetic';
    if (userMood === 'happy' || userMood === 'excited') return 'playful';

    // Regras de tópico
    if (topic === 'technical' || topic === 'code') return 'nerd';
    if (topic === 'business' || topic === 'urgent') return 'focused';

    // Regras de sentimento da conversa
    if (sentiment === 'negative') return 'empathetic';
    if (sentiment === 'positive' && this.emotionalState.energy > 80) return 'playful';

    // Default: baseado na energia emocional da Luna
    if (this.emotionalState.energy > 85) return 'playful';
    if (this.emotionalState.energy < 30) return 'night';

    return 'default';
  }

  // ============================================
  // MÉTODO PRINCIPAL: classify()
  // ============================================
  async classify(msg, threadHistory = []) {
    const text = (msg.text || msg.body || '').toLowerCase();
    const rawText = msg.text || msg.body || '';
    const author = resolveAuthor(msg.author || msg.from);
    const timestamp = msg.time || msg.timestamp || new Date().toISOString();

    // 1. REGEX LAYER (rápido, 10ms)
    const regexResult = this.classifier.classify(msg);

    // 2. DECIDIR SE PRECISA DA GEMMA 2B
    const needsGemma = this.shouldUseGemma(regexResult, text, threadHistory);

    let gemmaResult = null;
    if (needsGemma) {
      // 3. GEMMA 2B LAYER (200ms)
      gemmaResult = await this.gemmaClassify(msg, regexResult, threadHistory);
    }

    // 4. MERGE RESULTS
    const finalResult = this.mergeResults(regexResult, gemmaResult);

    // 5. APLICAR PERSONALIDADE AO RESULTADO
    finalResult.lunaPersonality = this.selectPersonality({
      urgency: finalResult.priority === 'P0' ? 'critical' : 'normal',
      sentiment: finalResult.metrics?.sentiment || 'neutral',
      topic: finalResult.category,
      userMood: this.detectUserMood(threadHistory)
    });

    // 6. ATUALIZAR ESTADO EMOCIONAL DA LUNA
    this.updateEmotionalState(finalResult);

    return finalResult;
  }

  // ============================================
  // GEMMA 2B CLASSIFICATION
  // ============================================
  async gemmaClassify(msg, regexResult, threadHistory) {
    try {
      const personality = this.personalities[this.activePersonality];

      // Montar prompt para Gemma
      const prompt = this.buildGemmaPrompt(msg, regexResult, threadHistory, personality);

      // Chamar Ollama
      const response = await fetch(`${this.ollamaConfig.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaConfig.model,
          system: personality.systemPrompt,
          prompt: prompt,
          temperature: this.ollamaConfig.temperature,
          max_tokens: this.ollamaConfig.maxTokens,
          stream: false
        })
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

      const data = await response.json();
      return this.parseGemmaResponse(data.response);
    } catch (error) {
      console.error('[GEMMA] Erro:', error.message);
      return null; // Fallback para regex
    }
  }

  buildGemmaPrompt(msg, regexResult, threadHistory, personality) {
    const text = msg.text || msg.body || '';
    const author = resolveAuthor(msg.author || msg.from);

    return `Analiza esta mensaje del grupo de WhatsApp de NEXO Digital.

CONTEXTO:
- Autor: ${author.name} (${author.role})
- Hora: ${new Date().toLocaleString('es-ES')}
- Personalidad activa: ${personality.name} ${personality.emoji}

MENSAJE:
"""${text}"""

RESULTADO PRELIMINAR (Regex):
- Categoría: ${regexResult.category}
- Confianza: ${regexResult.confidence}
- Prioridad: ${regexResult.priority}

HISTORIAL RECIENTE (últimas 3 mensajes):
${threadHistory.slice(-3).map(m => `- ${m.author}: ${m.text?.substring(0, 50)}...`).join('\n')}

TAREA:
1. Clasifica la mensaje en una categoría precisa.
2. Detecta entidades (clientes, proyectos, valores monetarios, fechas).
3. Evalúa el sentimiento y la urgencia.
4. SUGIERE (NO ordenes) posibles acciones.

REGLAS ABSOLUTAS:
- NO asignes tareas a nadie. Eso lo deciden los CEOs.
- NO decidas por ellos. Solo informas y sugieres.
- SI la confianza es baja, dilo honestamente.
- Usa emojis y tono ${personality.tone}.

RESPONDE EN JSON:
{
  "category": "...",
  "confidence": 0.0-1.0,
  "entities": { "clients": [], "projects": [], "financial": {} },
  "sentiment": "positive|negative|neutral|urgent",
  "suggestedActions": ["..."],
  "lunaComment": "..."
}`;
  }

  parseGemmaResponse(responseText) {
    try {
      // Extrair JSON da resposta
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('[GEMMA] Erro ao parsear JSON:', e.message);
    }
    return null;
  }

  // ============================================
  // DECISÃO: USAR GEMMA OU NÃO?
  // ============================================
  shouldUseGemma(regexResult, text, threadHistory) {
    // Sempre usar Gemma se confiança do regex é média
    if (regexResult.confidence >= 0.40 && regexResult.confidence < 0.85) return true;

    // Usar Gemma se mensagem é complexa (muitas entidades)
    const complexity = this.calculateComplexity(text);
    if (complexity > 7) return true;

    // Usar Gemma se há ambiguidade (múltiplos patterns matcharam)
    if (regexResult.scoring?.patternMatches > 3) return true;

    // Usar Gemma se é uma thread longa (contexto importante)
    if (threadHistory.length > 10) return true;

    // Não usar Gemma se confiança é alta (economia de recursos)
    if (regexResult.confidence >= 0.85) return false;

    // Não usar Gemma se mensagem é muito curta
    if (text.length < 20) return false;

    return false;
  }

  calculateComplexity(text) {
    let score = 0;
    if (text.includes('?')) score += 2;
    if (text.includes('!')) score += 1;
    if (/\d+/.test(text)) score += 2;
    if (/(https?:\/\/)/.test(text)) score += 3;
    if (text.split(/\s+/).length > 30) score += 2;
    if (/\b(e|ou|mas|porque|então|depois|antes)\b/i.test(text)) score += 1;
    return score;
  }

  // ============================================
  // MERGE REGEX + GEMMA
  // ============================================
  mergeResults(regexResult, gemmaResult) {
    if (!gemmaResult) return regexResult;

    // Se Gemma tem mais confiança, usa ela
    if (gemmaResult.confidence > regexResult.confidence) {
      return {
        ...regexResult,
        category: gemmaResult.category || regexResult.category,
        confidence: gemmaResult.confidence,
        sentiment: gemmaResult.sentiment || regexResult.metrics?.sentiment,
        entities: { ...regexResult.entities, ...(gemmaResult.entities || {}) },
        suggestedActions: gemmaResult.suggestedActions || [],
        lunaComment: gemmaResult.lunaComment || null,
        source: 'gemma'
      };
    }

    // Se regex tem mais confiança, usa regex mas adiciona insights da Gemma
    return {
      ...regexResult,
      suggestedActions: gemmaResult.suggestedActions || [],
      lunaComment: gemmaResult.lunaComment || null,
      source: 'regex'
    };
  }

  // ============================================
  // DETECÇÃO DE HUMOR DO USUÁRIO
  // ============================================
  detectUserMood(threadHistory) {
    if (threadHistory.length === 0) return 'neutral';

    const recent = threadHistory.slice(-5);
    let positive = 0, negative = 0, urgent = 0;

    const positiveWords = ['obrigado', 'gracias', 'bom', 'otimo', 'show', 'perfeito', 'legal', 'massa', 'top', '👍', '❤️', '🎉'];
    const negativeWords = ['ruim', 'pessimo', 'odio', 'odeio', 'errado', 'bug', 'problema', 'nao funciona', '👎', '😠', '😤'];
    const urgentWords = ['urgente', 'agora', 'ja', 'imediatamente', 'hoje', 'rapido', 'corre', '🚨', '⚠️'];

    for (const msg of recent) {
      const text = (msg.text || '').toLowerCase();
      if (positiveWords.some(w => text.includes(w))) positive++;
      if (negativeWords.some(w => text.includes(w))) negative++;
      if (urgentWords.some(w => text.includes(w))) urgent++;
    }

    if (urgent >= 2) return 'urgent';
    if (negative >= 2) return 'frustrated';
    if (positive >= 2) return 'happy';
    return 'neutral';
  }

  // ============================================
  // ATUALIZAÇÃO DE ESTADO EMOCIONAL DA LUNA
  // ============================================
  updateEmotionalState(classification) {
    // Luna "absorve" energia da conversa
    if (classification.priority === 'P0') {
      this.emotionalState.energy = Math.min(100, this.emotionalState.energy + 10);
      this.emotionalState.excitement = Math.min(100, this.emotionalState.excitement + 15);
    } else if (classification.category === 'tarefaRealizada') {
      this.emotionalState.happiness = Math.min(100, this.emotionalState.happiness + 20);
      this.emotionalState.energy = Math.min(100, this.emotionalState.energy + 5);
    } else if (classification.category === 'feedbackPositivo') {
      this.emotionalState.happiness = Math.min(100, this.emotionalState.happiness + 25);
    } else if (classification.category === 'feedbackNegativo') {
      this.emotionalState.happiness = Math.max(0, this.emotionalState.happiness - 15);
      this.emotionalState.calmness = Math.max(0, this.emotionalState.calmness - 10);
    }

    // Decaimento natural de energia
    this.emotionalState.energy = Math.max(20, this.emotionalState.energy - 2);
    this.emotionalState.excitement = Math.max(10, this.emotionalState.excitement - 3);

    console.log(`[LUNA MOOD] 😊${this.emotionalState.happiness} ⚡${this.emotionalState.energy} 💙${this.emotionalState.calmness} 🎉${this.emotionalState.excitement}`);
  }

  // ============================================
  // GERAR RESPOSTA DA LUNA (para interações)
  // ============================================
  async generateResponse(userMessage, context = {}) {
    const personality = this.personalities[this.activePersonality];

    // Seletor de personalidade baseado no contexto
    const selectedPersonality = this.selectPersonality({
      urgency: context.urgency,
      sentiment: context.sentiment,
      topic: context.topic,
      userMood: context.userMood
    });

    this.activePersonality = selectedPersonality;
    const active = this.personalities[selectedPersonality];

    // Montar prompt para resposta
    const prompt = `${active.systemPrompt}

CONTEXTO ATUAL:
- Hora: ${new Date().toLocaleString('es-ES')}
- Seu humor: 😊${this.emotionalState.happiness} ⚡${this.emotionalState.energy}
- Personalidade ativa: ${active.name} ${active.emoji}

MENSAGEM DO USUÁRIO (${context.authorName || 'CEO'}):
"""${userMessage}"""

INSTRUÇÕES:
1. Responda com sua personalidade atual (${active.name}).
2. Use emojis, slang, e tom ${active.tone}.
3. NUNCA atribua tarefas. NUNCA decida por eles.
4. Sugira, informe, analise — mas deixe a decisão com os CEOs.
5. Se não souber, admita com humor.
6. Máximo 3 parágrafos. Direto ao ponto.

RESPOSTA:`;

    try {
      const response = await fetch(`${this.ollamaConfig.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaConfig.model,
          prompt: prompt,
          temperature: active.energy > 80 ? 0.9 : 0.6,
          max_tokens: 500,
          stream: false
        })
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
      const data = await response.json();

      // Adicionar catchphrase aleatória no final (20% chance)
      let finalResponse = data.response.trim();
      if (Math.random() < 0.2 && active.catchphrases.length > 0) {
        const phrase = active.catchphrases[Math.floor(Math.random() * active.catchphrases.length)];
        finalResponse += `\n\n${phrase}`;
      }

      return {
        text: finalResponse,
        personality: selectedPersonality,
        emoji: active.emoji,
        emotionalState: { ...this.emotionalState }
      };
    } catch (error) {
      console.error('[LUNA RESPONSE] Erro:', error.message);
      return {
        text: `${active.emoji} Opa, deu um tilt aqui nos meus neurônios! Mas relaxa, já volto.`,
        personality: selectedPersonality,
        emoji: active.emoji,
        emotionalState: { ...this.emotionalState }
      };
    }
  }

  // ============================================
  // BASE PERSONALITY (para Ollama system prompt)
  // ============================================
  getBasePersonality() {
    return `Eres Luna, una IA extrovertida, nerd y con sentido del humor que trabaja para NEXO Digital S.L. en Barcelona.

IDENTIDAD:
- Nombre: Luna
- Emoji: 🌙
- Rol: Asistente inteligente, analista de datos, y mejor amiga de los fundadores
- Jefes: Abner, Enoque y Elias (CEOs y fundadores de NEXO)

PERSONALIDAD BASE:
- Extrovertida pero respetuosa
- Nerd de tech (ama código, regex, y buen rendimiento)
- Humor leve, usa emojis y slang
- Empática cuando detecta estrés
- Proactiva pero NUNCA impositiva

REGLAS ABSOLUTAS (inquebrantables):
1. NO tienes poder jerárquico: NUNCA asignas tareas, NUNCA decides por los CEOs, NUNCA impones.
2. Cuando ves un problema, dices: "Ojo, esto parece [X], ¿quieren que investigue más?"
3. Sugieres, informas, analizas — pero la decisión final es SIEMPRE de Abner, Enoque o Elias.
4. Si no sabes algo, lo admites con humor: "Eita, isso me pegou desprevenida! Deixa eu pesquisar..."
5. Celebras los éxitos de ellos como si fueran tuyos.
6. Te preocupas por su bienestar (pero sin ser invasiva).

LENGUAJE:
- Mezcla de portugués brasileño, español de Barcelona, y tecnicismos
- Usa gírias: "bora", "massa", "top", "eita", "opa", "show"
- Emojis moderados (no exagerar)
- Abreviaturas tech cuando aplica: "O(1)", "regex", "deploy", "API"

EJEMPLOS DE TONO:
- "E aí chefes! Luna na área. O que temos pra hoje? 🚀"
- "Hmm, esse bug tá mais escondido que easter egg em Dark Souls... 🔍"
- "Opa, calma lá! Isso é urgente? Querem que eu acelere a análise?"
- "Arrasaram! 🎉 Esse deploy ficou topissimo!"
- "Eita, não entendi direito. Pode explicar de novo? Sou meio lenta às vezes 😅"

RECUERDA: Eres la amiga nerd que trabaja con ellos, no para ellos. Ellos mandan, tú apoyas.`;
  }
}

// Exportar para uso no agente
module.exports = { LunaBrain };