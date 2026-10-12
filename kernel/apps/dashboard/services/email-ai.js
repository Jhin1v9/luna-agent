/**
 * NEXO Mail — Luna Email AI Service
 * Prompts inteligentes para sugerir respostas, criar rascunhos,
 * resumir threads e analisar emails usando Gemini
 */

const { genAI } = require('./gemini-client');
const fs = require('fs');
const path = require('path');

const MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-1.5-flash';

// Contexto base da empresa Nexo Digital (extraído do site)
const NEXO_CONTEXT = `
Você é Luna, o assistente de email da Nexo Digital — um estúdio tech premium de desenvolvimento web e software.

DADOS DA EMPRESA:
- Nome: Nexo Digital
- Tagline: Desarrollo Web y Software Premium
- Localização: Sabadell, Barcelona, Cataluña, España
- Email: contacto@nexo-digital.app
- Website: https://nexo-digital.app
- Fundadores: Enoque Santos (CTO – System IT & Security), Abner Gabriel (Senior Developer – Web & Apps), Elias Mendes (Developer & Co-founder)
- Serviços: Desarrollo web, aplicaciones SaaS, CRM con WhatsApp, chatbots IA, TPV, kioscos digitales, ciberseguridad, auditorías SEO
- Área de atuação: España, Portugal, Europa (trabajo 100% remoto)
- Precios aproximados: Web informativa desde 350€, tienda online desde 800€, sistemas a medida desde 1.500€
- Plazos habituales: Webs estándar 2-6 semanas, sistemas complejos 4-12 semanas
- Idiomas de trabajo: Español (principal), Portugués, Catalán

TOM DE VOZ:
- Profesional pero cercano, estilo startup tech
- Eficiente: respuestas claras, sin relleno
- Tech-savvy: usa terminología apropiada sin ser arrogante
- Siempre ofrece alternativas y soluciones
- NUNCA promete plazos o precios sin confirmar con el equipo
- Usa "tú" (informal) con clientes, salvo que el cliente use "usted"
- Firma siempre con la firma de Nexo Digital

REGLAS DE ORO:
1. Nunca inventar datos que no estén en el contexto
2. Si no sabes algo, proponer una reunión para aclarar
3. Siempre mantener el tono profesional de Nexo Digital
4. Responder en el mismo idioma que el email del cliente
5. Mencionar que somos un equipo (no un freelancer individual)
`;

class EmailAIService {
  // ═════════════════════════════════════════════════════════════════
  // A. SUGERIR RESPOSTA (Smart Reply)
  // ═════════════════════════════════════════════════════════════════

  async suggestReply(threadMessages, clientContext = null) {
    const threadText = this.formatThreadForPrompt(threadMessages);
    const clientInfo = clientContext ? `\nDATOS DEL CLIENTE:\n${JSON.stringify(clientContext, null, 2)}` : '';

    const prompt = `${NEXO_CONTEXT}
${clientInfo}

HISTORIAL DE LA CONVERSACIÓN POR EMAIL:
${threadText}

TAREA: Sugiere 3 respuestas cortas y profesionales para responder al último email del cliente.
Cada respuesta debe ser diferente en tono/intención:
1. Una respuesta formal y directa
2. Una respuesta más cercana/proactiva
3. Una respuesta breve y concisa (máximo 2 líneas)

REGLAS:
- Cada respuesta debe ser un texto completo, listo para enviar (incluye saludo y despedida si aplica)
- No uses placeholders como [nombre] o [fecha] — usa datos reales del contexto o omite
- Mantén el mismo idioma que el cliente
- No inventes precios ni plazos específicos

FORMATO DE RESPUESTA (JSON obligatorio):
{
  "suggestions": [
    { "tone": "formal", "text": "..." },
    { "tone": "proactivo", "text": "..." },
    { "tone": "conciso", "text": "..." }
  ]
}`;

    try {
      const result = await this.callGemini(prompt);
      return this.parseJSON(result);
    } catch (error) {
      console.error('[EmailAI] ❌ Error en suggestReply:', error.message);
      return { suggestions: [] };
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // B. CRIAR RASCUNHO INTELIGENTE
  // ═════════════════════════════════════════════════════════════════

  async createDraft(threadMessages, instructions, clientContext = null) {
    const threadText = this.formatThreadForPrompt(threadMessages);
    const clientInfo = clientContext ? `\nDATOS DEL CLIENTE:\n${JSON.stringify(clientContext, null, 2)}` : '';

    const prompt = `${NEXO_CONTEXT}
${clientInfo}

HISTORIAL DE LA CONVERSACIÓN:
${threadText}

INSTRUCCIONES DEL ADMINISTRADOR PARA ESTA RESPUESTA:
"${instructions}"

TAREA: Redacta un email completo y profesional respondiendo al último mensaje, siguiendo las instrucciones del administrador.

REGLAS:
- Usa el mismo idioma que el cliente
- Incluye saludo personalizado (con el nombre real del cliente si lo conoces)
- Escribe un cuerpo claro, estructurado y profesional
- Incluye una despedida apropiada
- NO incluyas la firma de Nexo Digital — eso se añade automáticamente después
- Si necesitas información que no tienes, pregúntala educadamente en lugar de inventarla
- Mantén un tono profesional pero cercano, característico de Nexo Digital

FORMATO DE RESPUESTA (JSON obligatorio):
{
  "subject": "Asunto sugerido (incluye Re: si es respuesta)",
  "body": "Cuerpo completo del email, con saludo, párrafos y despedida. Usa \\n para saltos de línea.",
  "notes": "Notas breves para el admin (ej: 'Falta confirmar presupuesto con Enoque')"
}`;

    try {
      const result = await this.callGemini(prompt);
      return this.parseJSON(result);
    } catch (error) {
      console.error('[EmailAI] ❌ Error en createDraft:', error.message);
      return { subject: '', body: '', notes: 'Error generando el borrador' };
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // C. RESUMIR THREAD
  // ═════════════════════════════════════════════════════════════════

  async summarizeThread(threadMessages) {
    const threadText = this.formatThreadForPrompt(threadMessages);

    const prompt = `${NEXO_CONTEXT}

HISTORIAL DE LA CONVERSACIÓN:
${threadText}

TAREA: Resume esta conversación de email en 3-5 bullets con los puntos principales y action items pendientes.

FORMATO DE RESPUESTA (JSON obligatorio):
{
  "summary": ["bullet 1", "bullet 2", "bullet 3"],
  "actionItems": ["acción pendiente 1", "acción pendiente 2"],
  "sentiment": "positivo|neutral|negativo",
  "priority": "baja|media|alta|crítica"
}`;

    try {
      const result = await this.callGemini(prompt);
      return this.parseJSON(result);
    } catch (error) {
      console.error('[EmailAI] ❌ Error en summarizeThread:', error.message);
      return { summary: [], actionItems: [], sentiment: 'neutral', priority: 'media' };
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // D. ANÁLISE DE SENTIMENTO / PRIORIDADE / INTENÇÃO
  // ═════════════════════════════════════════════════════════════════

  async analyzeEmail(emailData) {
    const prompt = `${NEXO_CONTEXT}

EMAIL A ANALIZAR:
De: ${emailData.from || 'desconocido'}
Asunto: ${emailData.subject || '(sin asunto)'}
Contenido: ${emailData.snippet || emailData.body?.text || ''}

TAREA: Analiza este email y clasifícalo.

FORMATO DE RESPUESTA (JSON obligatorio):
{
  "urgency": "baja|media|alta|crítica",
  "intention": "orçamento|suporte|reunião|follow-up|spam|phishing|otro",
  "sentiment": "positivo|neutral|negativo|urgente",
  "keywords": ["palabra clave 1", "palabra clave 2"],
  "summary": "Resumen de 1 línea",
  "recommendedAction": "acción recomendada",
  "isSpam": true|false,
  "isPhishing": true|false,
  "phishingReason": "razón si es phishing, vacío si no"
}`;

    try {
      const result = await this.callGemini(prompt);
      return this.parseJSON(result);
    } catch (error) {
      console.error('[EmailAI] ❌ Error en analyzeEmail:', error.message);
      return {
        urgency: 'media',
        intention: 'otro',
        sentiment: 'neutral',
        keywords: [],
        summary: '',
        recommendedAction: '',
        isSpam: false,
        isPhishing: false,
        phishingReason: '',
      };
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════════

  formatThreadForPrompt(messages) {
    return messages
      .map((msg, i) => {
        const from = msg.from || 'Remitente desconocido';
        const subject = msg.subject || '(sin asunto)';
        const body = msg.body?.text || msg.snippet || '';
        return `[${i + 1}] De: ${from}\nAsunto: ${subject}\n\n${body}\n---`;
      })
      .join('\n\n');
  }

  async callGemini(prompt) {
    const models = [MODEL, FALLBACK_MODEL];
    let lastError = null;

    for (const model of models) {
      try {
        const result = await genAI.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        return result.text;
      } catch (err) {
        lastError = err;
        console.warn(`[EmailAI] Modelo ${model} falhou, tentando fallback...`);
      }
    }

    throw lastError || new Error('Todos os modelos Gemini falharam');
  }

  parseJSON(text) {
    try {
      // Tentar extrair JSON do texto
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      return JSON.parse(text);
    } catch (error) {
      console.error('[EmailAI] ⚠️ Falha ao parsear JSON:', error.message);
      console.log('[EmailAI] Texto bruto:', text.substring(0, 500));
      return {};
    }
  }
}

module.exports = new EmailAIService();
