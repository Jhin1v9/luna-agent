// ============================================================
// INTENT PARSER v19.0 — MODO CONCIERGE
// Entende comandos naturais em PT-BR usando LLM local (3B params)
// Retorna JSON estruturado com ações a executar
// ============================================================

const fs = require('fs');

// ── LRU Cache simples com TTL ──
class LRUCache {
  constructor(maxSize = 50, ttlMs = 300000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }
  _makeKey(text, context) {
    const author = context.authorName || '';
    const buf = JSON.stringify(context.bufferSummary || {});
    return `${text}::${author}::${buf}`;
  }
  get(text, context) {
    const key = this._makeKey(text, context);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Promover para o fim (MRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }
  set(text, context, value) {
    const key = this._makeKey(text, context);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, ts: Date.now() });
  }
  clear() { this.cache.clear(); }
  stats() { return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs }; }
}

// Mapeia nomes dos CEOs para IDs do sistema
function mapResponsavel(name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  if (n === 'abner') return 'abner';
  if (n === 'nonoke' || n === 'enoque') return 'nonoke';
  if (n === 'elias') return 'elias';
  return n;
}

class IntentParser {
  constructor(config = {}) {
    this.genAI = config.genAI || null;
    this.geminiModel = config.geminiModel || 'gemini-2.5-flash-lite';
    this.timeout = config.timeout || 15000;
    this.confidenceThreshold = config.confidenceThreshold || 0.75;
    this.cache = new LRUCache(config.cacheSize || 50, config.cacheTTL || 300000); // 5min default

    // Regex de fallback para comandos óbvios (rápido, sem LLM)
    this.patterns = {
      task: {
        regex: /\b(criar?\s+tarefa|anotar?\s+tarefa|adicionar?\s+tarefa|nova\s+tarefa|bota\s+tarefa|coloca\s+tarefa|faz(?:er)?\s+tarefa)\b/i,
        action: 'criar_tarefa',
        extract: (text) => {
          // Limpa a frase removendo prefixos comuns
          let cleaned = text.replace(/\b(luna[,!]?\s*|cria(?:r)?\s+|anota(?:r)?\s+|faz(?:er)?\s+|bota\s+|coloca\s+|adiciona(?:r)?\s+|nova\s+)\b/gi, ' ').trim();
          cleaned = cleaned.replace(/\b(?:uma?\s+)?tarefa\s*[:\-]?\s*/i, ' ').trim();

          // Extrair responsável: "pro Elias", "pra Nonoke", "para o Abner"
          const respPatterns = [
            /\b(?:pro|pra)\s+([A-Za-zÀ-ÿ]+)/i,
            /\bpara\s+(?:o\s+|a\s+)?([A-Za-zÀ-ÿ]+)/i,
            /\batribuir\s+(?:ao|à|a)\s+([A-Za-zÀ-ÿ]+)/i
          ];
          let responsavel = null;
          for (const pat of respPatterns) {
            const m = text.match(pat);
            if (m) { responsavel = mapResponsavel(m[1]); break; }
          }

          // Remove a parte do responsável do título
          if (responsavel) {
            cleaned = cleaned.replace(/\b(?:pro|pra|para(?:\s+(?:o|a))?)\s+[A-Za-zÀ-ÿ]+\s*[:\-]?\s*/i, ' ').trim();
            cleaned = cleaned.replace(/\batribuir\s+(?:ao|à|a)\s+[A-Za-zÀ-ÿ]+\s*[:\-]?\s*/i, ' ').trim();
          }

          let titulo = cleaned || text;
          titulo = titulo.replace(/\btarefa\s*[:\-]?\s*/i, '').trim();
          if (titulo.length < 2) titulo = text;

          const prioridade = /P0|urgente|cr[ií]tica/i.test(text) ? 'P0' : /P1/i.test(text) ? 'P1' : 'P2';
          return { titulo, prioridade, responsavel };
        }
      },
      lead: {
        regex: /\b(novo\s+cliente|novo\s+lead|lead\s+(?:do|da|de)|cliente\s+(?:novo|potencial)|potencial\s+cliente)\b/i,
        action: 'criar_lead',
        extract: (text) => {
          const m = text.match(/(?:cliente|lead)\s*:?\s*([^,]+?)(?:\s*(?:telefone|tel|email|@|,|$))/i);
          return { nome: m?.[1]?.trim() || 'Lead não identificado', contexto: text };
        }
      },
      payment: {
        regex: /\b(pagou|recebeu|recebi|entrada\s+de|depositou|transferiu)\s+.*?\b(\d+[\.,]?\d*)\b/i,
        action: 'registrar_pagamento',
        extract: (text) => {
          const valorMatch = text.match(/(?:pagou|recebeu|recebi|entrada|depositou|transferiu).*?(\d+[\.,]?\d*)/i);
          const deMatch = text.match(/(?:pagou|recebeu|recebi|entrada|depositou|transferiu).*?(?:de|do|da|do cliente)\s+([A-Za-zÀ-ÿ\s]+?)(?:\s+(?:valor|no\s+dia|em|pela|por|$))/i);
          const descMatch = text.match(/(?:por|referente\s+a|pela|de)\s+(.+?)(?:\s*(?:valor|no dia|$))/i);
          return {
            valor: parseFloat((valorMatch?.[1] || '0').replace(',', '.')),
            de: deMatch?.[1]?.trim() || 'Não identificado',
            descricao: descMatch?.[1]?.trim() || 'Pagamento registrado via Luna',
            tipo: /reforma|obra|serviço|projeto/i.test(text) ? 'servico' : 'outro'
          };
        }
      },
      expense: {
        regex: /\b(pagamos|pagou|gastou|gastamos|despesa|sa[ií]da|sa[ií]da\s+de|compramos|comprou|investimos|investiu)\b/i,
        action: 'registrar_despesa',
        extract: (text) => {
          const valorMatch = text.match(/(\d+[\.,]?\d*)/);
          // Extrair descrição: tudo depois de "com/de/para/no/na/em" após o valor
          let desc = text;
          // Remove o valor numérico e moeda da descrição
          desc = desc.replace(/\d+[\.,]?\d*\s*(?:euros?|eur|€)?/i, '');
          // Remove palavras de ação
          desc = desc.replace(/\b(gastamos|gastou|pagamos|pagou|despesa|compramos|investimos|sa[ií]da)\b/gi, '');
          // Captura tudo depois de "com", "de", "para", "no", "na", "em"
          const descMatch = desc.match(/(?:com|de|para|no|na|em)\s+(.+)/i);
          desc = descMatch?.[1]?.trim() || desc.trim();
          // Limpa pontuação no início/fim
          desc = desc.replace(/^[\s\-:]+|[\s\-:]+$/g, '');
          return {
            valor: parseFloat((valorMatch?.[1] || '0').replace(',', '.')),
            descricao: desc || text,
            tipo: 'despesa'
          };
        }
      },
      done: {
        regex: /\b(consegui|fiz|terminei|finalizei|consertei|corrigi|resolvi|subi|publiquei|atualizei|acabei)\b/i,
        action: 'confirmar_tarefa',
        extract: (text) => {
          const m = text.match(/(?:consegui|fiz|terminei|finalizei|consertei|corrigi|resolvi|subi|publiquei|atualizei|acabei)\s+(?:com\s+|a\s+|o\s+)?(.+)/i);
          return { titulo: m?.[1]?.trim() || text };
        }
      },
      status: {
        regex: /\b(?:status(?!\s+do\s+(?:sistema|servidor|stack|server|caixa|financeiro))|resumo(?!\s+do\s+sistema)|como\s+anda|o\s+que\s+tem|quais\s+as|me\s+(?:manda|dá|da)\s+(?:o\s+)?resumo)\b/i,
        action: 'consultar_status',
        extract: () => ({ filtro: 'geral' })
      },
      greeting: {
        regex: /\b(oi|olá|ola|opa|e aí|e ai|bom dia|boa tarde|boa noite)\b/i,
        action: 'social',
        extract: () => ({ tipo: 'saudacao' })
      },
      comment: {
        regex: /\b(comenta(?:r)?(?:\s+na)?(?:\s+tarefa)?|adiciona(?:r)?\s+coment[áa]rio(?:\s+na)?(?:\s+tarefa)?)\b/i,
        action: 'adicionar_comentario',
        extract: (text) => {
          const m1 = text.match(/(?:comenta(?:r)?\s+na\s+tarefa|adiciona(?:r)?\s+coment[áa]rio\s+na\s+tarefa)\s+(.+?)\s*:\s*(.+)/i);
          if (m1) return { taskTitle: m1[1].trim(), commentText: m1[2].trim() };
          const m2 = text.match(/comenta(?:r)?\s+(.+?)\s*:\s*(.+)/i);
          if (m2) return { taskTitle: m2[1].trim(), commentText: m2[2].trim() };
          const m3 = text.match(/(?:adiciona(?:r)?\s+coment[áa]rio\s+na\s+tarefa|comenta(?:r)?\s+na\s+tarefa)\s+(.+)/i);
          if (m3) return { taskTitle: m3[1].trim(), commentText: '' };
          return { taskTitle: text, commentText: '' };
        }
      },
      update_status: {
        regex: /\b(marca(?:r)?\s+tarefa|coloca(?:r)?\s+tarefa|tarefa\s+(?:est[áa]|ficou)|pend[êe]ncia\s+(?:da\s+)?tarefa)\b/i,
        action: 'atualizar_status',
        extract: (text) => {
          let status = 'pending';
          if (/\b(conclu[íi]da|finalizada|pronta|feita)\b/i.test(text)) status = 'completed';
          else if (/\b(andamento|em\s+progresso)\b/i.test(text)) status = 'in_progress';
          else if (/\b(pendente|pend[êe]ncia)\b/i.test(text)) status = 'pending';
          const m = text.match(/(?:marca(?:r)?|coloca(?:r)?)\s+tarefa\s+(.+?)\s+(?:como|em)\s+/i) ||
                    text.match(/tarefa\s+(.+?)\s+(?:est[áa]|ficou)\s+/i) ||
                    text.match(/pend[êe]ncia\s+(?:da\s+)?tarefa\s+(.+)/i);
          return { taskTitle: m?.[1]?.trim() || text, status };
        }
      },
      payment_split: {
        regex: /\b(recebemos|recebeu|entrada\s+de|pagamento\s+de).*?(\d+[\.,]?\d*).*?(cliente|de|do|da)\b/i,
        action: 'registrar_pagamento_com_split',
        extract: (text) => {
          const valorMatch = text.match(/(?:recebemos|recebeu|entrada|pagamento).*?(\d+[\.,]?\d*)/i);
          const deMatch = text.match(/(?:cliente|de|do|da)\s+([A-Za-zÀ-ÿ\s]+?)(?:\s+(?:valor|no\s+dia|divide|split|$))/i);
          return {
            valor: parseFloat((valorMatch?.[1] || '0').replace(',', '.')),
            de: deMatch?.[1]?.trim() || 'Cliente',
            descricao: text
          };
        }
      },
      expense_split: {
        regex: /\b(despesa|gastos|pagamos|sa[íi]da)\s+.*?(\d+[\.,]?\d*).*?(divide|split|entre|para)\b/i,
        action: 'registrar_despesa_com_split',
        extract: (text) => {
          const valorMatch = text.match(/(?:despesa|gastos|pagamos|sa[íi]da).*?(\d+[\.,]?\d*)/i);
          return {
            valor: parseFloat((valorMatch?.[1] || '0').replace(',', '.')),
            descricao: text,
            splitAmong: ['abner', 'nonoke', 'elias']
          };
        }
      },
      query_tasks: {
        regex: /\b(quais\s+tarefas|lista\s+tarefas|tarefas\s+pendentes|minhas\s+tarefas|o\s+que\s+tem\s+pra\s+fazer|quantas\s+tarefas|mostrar\s+tarefas)\b/i,
        action: 'consultar_tarefas',
        extract: (text) => {
          let filtro = 'pendentes';
          if (/\bP0\b|urgente/i.test(text)) filtro = 'p0';
          if (/\bhoje\b|hoje/i.test(text)) filtro = 'hoje';
          return { filtro };
        }
      },
      query_leads: {
        regex: /\b(quais\s+leads|lista\s+leads|novos\s+clientes|pipeline|oportunidades)\b/i,
        action: 'consultar_leads',
        extract: () => ({ filtro: 'todos' })
      },
      query_finance: {
        regex: /\b(como\s+est[áa]\s+(?:o\s+)?financeiro|resumo\s+financeiro|caixa(?!\s+de\s+entrada)|saldo|recebimentos|gastos)\b/i,
        action: 'consultar_financeiro',
        extract: () => ({ filtro: 'geral' })
      },
      delete_task: {
        regex: /\b(apaga(?:r)?|deleta(?:r)?|remove(?:r)?|exclui(?:r)?|cancela(?:r)?|elimina(?:r)?)\s+(?:a\s+|esta\s+|essa\s+|a\s+)?(?:tarefa|task)\b/i,
        action: 'excluir_tarefa',
        extract: (text) => {
          const m = text.match(/(?:apaga|deleta|remove|exclui|cancela|elimina)\s+(?:a\s+|esta\s+|essa\s+|a\s+)?(?:tarefa|task)\s*(?:"|'| chamada | de |:)?\s*(.+)/i);
          return { titulo: m?.[1]?.trim() || '' };
        }
      },
      delete_payment: {
        regex: /\b(apaga(?:r)?|deleta(?:r)?|remove(?:r)?|exclui(?:r)?|cancela(?:r)?|elimina(?:r)?)\s+(?:o\s+|este\s+|esse\s+)?(?:pagamento|recibo|entrada|recebimento)\s*(?:"|'| do | de |:)?\s*(.+)/i,
        action: 'excluir_pagamento',
        extract: (text) => {
          const m = text.match(/(?:apaga|deleta|remove|exclui|cancela|elimina)\s+(?:o\s+|este\s+|esse\s+)?(?:pagamento|recibo|entrada|recebimento)\s*(?:"|'| do | de |:)?\s*(.+)/i);
          return { id: m?.[1]?.trim() || text, confirmar: true };
        }
      },
      delete_expense: {
        regex: /\b(apaga(?:r)?|deleta(?:r)?|remove(?:r)?|exclui(?:r)?|cancela(?:r)?|elimina(?:r)?)\s+(?:a\s+|esta\s+|essa\s+)?(?:despesa|gasto|sa[ií]da)\s*(?:"|'| do | de |:)?\s*(.+)/i,
        action: 'excluir_despesa',
        extract: (text) => {
          const m = text.match(/(?:apaga|deleta|remove|exclui|cancela|elimina)\s+(?:a\s+|esta\s+|essa\s+)?(?:despesa|gasto|sa[ií]da)\s*(?:"|'| do | de |:)?\s*(.+)/i);
          return { id: m?.[1]?.trim() || text, confirmar: true };
        }
      },
      delete_lead: {
        regex: /\b(apaga(?:r)?|deleta(?:r)?|remove(?:r)?|exclui(?:r)?|cancela(?:r)?|elimina(?:r)?)\s+(?:o\s+|este\s+|esse\s+|a\s+|esta\s+|essa\s+)?(?:lead|cliente|potencial)\s*(?:"|'| do | da | de |:)?\s*(.+)/i,
        action: 'excluir_lead',
        extract: (text) => {
          const m = text.match(/(?:apaga|deleta|remove|exclui|cancela|elimina)\s+(?:o\s+|este\s+|esse\s+|a\s+|esta\s+|essa\s+)?(?:lead|cliente|potencial)\s*(?:"|'| do | da | de |:)?\s*(.+)/i);
          return { nome: m?.[1]?.trim() || text, confirmar: true };
        }
      },
      query_email: {
        regex: /(?<!\b(?:enviar|mandar|compor|escrever|criar|fazer|redigir|draftar|responder|reponder|reply)\s+(?:um\s+|uma\s+)?)\b(emails?|caixa\s+de\s+entrada|inbox|ver\s+emails?|checar\s+emails?|novos?\s+emails?|mensagens\s+do\s+email)\b/i,
        action: 'consultar_emails',
        extract: (text) => {
          const unreadOnly = /\b(não\s+lido|nao\s+lido|novo|novos|pendente)\b/i.test(text);
          return { filtro: unreadOnly ? 'nao_lidos' : 'todos' };
        }
      },
      query_whatsapp: {
        regex: /\b(men[çc][õo]es\s+(?:do\s+)?whatsapp|check\s+whatsapp|whatsapp|men[çc][õo]es\s+pendentes)\b/i,
        action: 'consultar_whatsapp',
        extract: () => ({ filtro: 'geral' })
      },
      // ── EMAIL: enviar/responder ──
      send_email: {
        regex: /\b(enviar|mandar|compor|escrever|criar|fazer|redigir|draftar)\s+(?:um\s+|uma\s+)?(?:email|e-mail|correio|mensagem)\b/i,
        action: 'enviar_email',
        extract: (text) => {
          const destMatch = text.match(/(?:para|pra|pro)\s+([A-Za-zÀ-ÿ\s]+?)(?:\s+(?:sobre|assunto|com|dizendo|falando|falar)|$)/i);
          const assuntoMatch = text.match(/(?:sobre|assunto|falando|falar)\s+(.+)/i);
          return { destinatario: destMatch?.[1]?.trim() || null, assunto: assuntoMatch?.[1]?.trim() || null, contexto: text };
        }
      },
      reply_email: {
        regex: /\b(responder|reponder|reply|resposta\s+a)\s+(?:o\s+|ao\s+|a\s+)?(?:email|e-mail|correio|mensagem)\b/i,
        action: 'responder_email',
        extract: (text) => {
          const idMatch = text.match(/(?:email|e-mail|mensagem)\s+(?:do|da|de|nº|numero|número)?\s*(.+?)(?:\s+(?:dizendo|com|sobre|falando)|$)/i);
          return { emailId: idMatch?.[1]?.trim() || null, contexto: text };
        }
      },
      // ── SOCIAL / CONHECIMENTO GERAL ──
      social_knowledge: {
        regex: /\b(previs[aã]o\s+do\s+tempo|clima|not[íi]cia|not[íi]cias|jornal|capital\s+(?:de|da|do|dos)|quem\s+(?:foi|é|s[aã]o)|o\s+que\s+(?:é|s[aã]o|significa)|qual\s+(?:a|o|é|foi)|como\s+(?:funciona|é|faz|vai|explicar|explica)|hist[óo]ria\s+(?:de|da|do)|geografia|ci[êe]ncia|curiosidade|fato|trivia|significado\s+de|tradu[çc][ãa]o|por\s+que|porque|quando|onde|quantos?|defini[çc][ãa]o\s+de|explique|explique\s+me|me\s+explique)\b/i,
        action: 'social',
        extract: (text) => ({ tipo: 'conhecimento_geral', texto: text })
      },
      // ── IDEIA ──
      idea: {
        regex: /\b(?:ideia\s*:|ideia\s+para|nova\s+ideia|anotar\s+ideia|salvar\s+ideia|registrar\s+ideia)(?=\s|$)/i,
        action: 'criar_ideia',
        extract: (text) => {
          const m = text.match(/(?:ideia:?|nova\s+ideia|ideia\s+para|anotar\s+ideia|salvar\s+ideia|registrar\s+ideia)\s*(.+)/i);
          return { titulo: m?.[1]?.trim() || text, descricao: '' };
        }
      },
      // ── LISTAGENS ──
      list_projects: {
        regex: /\b(listar?\s+projetos?|projetos?\s+existentes?|quais\s+projetos?|ver\s+projetos?|mostrar\s+projetos?)\b/i,
        action: 'listar_projetos',
        extract: () => ({ filtro: 'todos' })
      },
      list_ideas: {
        regex: /\b(listar?\s+ideias?|ideias?\s+salvas?|ver\s+ideias?|quais\s+ideias?|mostrar\s+ideias?)\b/i,
        action: 'listar_ideias',
        extract: () => ({ filtro: 'todas' })
      },
      list_links: {
        regex: /\b(listar?\s+links?|ver\s+links?|links?\s+salvos?|quais\s+links?|mostrar\s+links?)\b/i,
        action: 'listar_links',
        extract: () => ({ filtro: 'todos' })
      },
      list_notifications: {
        regex: /\b(listar?\s+notifica[çc][õo]es?|ver\s+notifica[çc][õo]es?|notifica[çc][õo]es?\s+novas?|alertas?|mostrar\s+notifica)/i,
        action: 'listar_notificacoes',
        extract: () => ({ filtro: 'nao_lidas' })
      },
      list_clients: {
        regex: /\b(listar?\s+clientes?|ver\s+clientes?|quais\s+clientes?|mostrar\s+clientes?)\b/i,
        action: 'listar_clientes',
        extract: () => ({ filtro: 'todos' })
      },
      list_quotes: {
        regex: /\b(listar?\s+or[çc]amentos?|ver\s+or[çc]amentos?|quais\s+or[çc]amentos?|mostrar\s+or[çc]amentos?)\b/i,
        action: 'listar_orcamentos',
        extract: () => ({ filtro: 'todos' })
      },
      // ── STACK / SISTEMA ──
      check_stack: {
        regex: /\b(status\s+do\s+sistema|status\s+do\s+servidor|como\s+est[áa]\s+o\s+sistema|verificar\s+stack|health\s+check|servidor|uptime|logs\s+do\s+sistema)\b/i,
        action: 'verificar_stack',
        extract: () => ({ filtro: 'geral' })
      },
      // ── PROJETO ──
      create_project: {
        regex: /\b(novo\s+projeto|criar\s+projeto|projeto\s+(?:novo|para|de))\b/i,
        action: 'criar_projeto',
        extract: (text) => {
          const m = text.match(/(?:projeto)\s*[:\-]?\s*(.+)/i);
          return { nome: m?.[1]?.trim() || text, descricao: '', status: 'pending' };
        }
      },
      // ── ORÇAMENTO ──
      create_quote: {
        regex: /\b(novo\s+or[çc]amento|criar\s+or[çc]amento|or[çc]amento\s+(?:de|para|do))\b/i,
        action: 'criar_orcamento',
        extract: (text) => {
          const valorMatch = text.match(/(\d+[\.,]?\d*)/);
          return { valor: parseFloat((valorMatch?.[1] || '0').replace(',', '.')), titulo: text };
        }
      },
      // ── CLIENTE ──
      create_client: {
        regex: /\b(novo\s+cliente\s+(?:nome|cadastrar|adicionar)|cadastrar\s+cliente|adicionar\s+cliente)\b/i,
        action: 'criar_cliente',
        extract: (text) => {
          const m = text.match(/(?:cliente|nome)\s*[:\-]?\s*([A-Za-zÀ-ÿ\s]+?)(?:\s+(?:email|telefone|tel|@)|$)/i);
          return { nome: m?.[1]?.trim() || 'Cliente não identificado' };
        }
      },
      // ── NAVEGAÇÃO ──
      navigate: {
        regex: /\b(vai?\s+(?:para|pra|pro)|mostra?\s+(?:a\s+)?(?:p[áa]gina\s+de\s+)?|abre?\s+(?:a\s+)?(?:p[áa]gina\s+de\s+)?|navega?\s+(?:para|pra|pro)|ir\s+(?:para|pra|pro)|quero\s+ver\s+(?:a\s+)?|me\s+mostra?\s+(?:a\s+)?)(?:tarefas?|tasks?|financeiro|caixa|emails?|leads?|whatsapp|projetos?|or[çc]amentos?|clientes?|dashboard|configura[çc][õo]es?|settings|relat[óo]rios?|ideias?|links?)\b/i,
        action: 'navegar',
        extract: (text) => {
          const destMap = {
            tarefa: '/tarefas', tarefas: '/tarefas', task: '/tarefas', tasks: '/tarefas',
            financeiro: '/financeiro', caixa: '/financeiro/caixa',
            email: '/email', emails: '/email', inbox: '/email',
            lead: '/leads', leads: '/leads',
            whatsapp: '/whatsapp',
            projeto: '/projetos', projetos: '/projetos', project: '/projetos',
            orcamento: '/orcamentos', orcamentos: '/orcamentos', orçamento: '/orcamentos', orçamentos: '/orcamentos',
            cliente: '/clientes', clientes: '/clientes', workspace: '/workspace',
            dashboard: '/dashboard', inicio: '/dashboard',
            configuracao: '/settings', configuracoes: '/settings', settings: '/settings',
            relatorio: '/relatorios', relatorios: '/relatorios',
            ideia: '/ideias', ideias: '/ideias',
            link: '/ferramentas', links: '/ferramentas',
          };
          const lower = text.toLowerCase();
          let destino = '/dashboard';
          for (const [key, route] of Object.entries(destMap)) {
            if (lower.includes(key)) { destino = route; break; }
          }
          return { destino, pagina: destino };
        }
      },
      // ── FILTRO ──
      filter: {
        regex: /\b(filtra?\s+(?:por\s+)?|mostra?\s+(?:s[oó]\s+)?|s[oó]\s+(?:mostra?\s+)?)(?:pendentes?|conclu[ií]das?|P0|P1|P2|urgentes?|cr[ií]ticas?|minhas?|de\s+[A-Za-zÀ-ÿ]+)\b/i,
        action: 'filtrar',
        extract: (text) => {
          const lower = text.toLowerCase();
          let status = null;
          let priority = null;
          let assignee = null;
          if (/pendente/.test(lower)) status = 'pendente';
          if (/conclu[íi]da/.test(lower)) status = 'concluido';
          if (/P0|urgente|cr[íi]tica/.test(lower)) priority = 'P0';
          if (/P1/.test(lower)) priority = 'P1';
          if (/P2/.test(lower)) priority = 'P2';
          const respMatch = text.match(/(?:de|do|da|para|pro|pra)\s+([A-Za-zÀ-ÿ]+)/i);
          if (respMatch) assignee = respMatch[1].toLowerCase();
          if (/minhas?/.test(lower)) assignee = 'me';
          return { status, priority, assignee };
        }
      }
    };
  }

  // ============================================================
  // API PÚBLICA: parse()
  // Recebe texto + contexto, retorna intenções estruturadas
  // ============================================================
  async parse(text, context = {}) {
    const clean = text.replace(/@luna|@kimi|@kimiclaw/gi, '').trim();
    if (!clean) return { intent: 'vazio', actions: [], confidence: 1, needsConfirmation: false };

    // 1. FAST PATH: Regex para comandos óbvios
    const fast = this.fastParse(clean);
    if (fast && fast.confidence >= 0.8) {
      return fast;
    }

    // 2. CACHE: evita chamadas repetidas ao Gemini
    const cached = this.cache.get(clean, context);
    if (cached) {
      return { ...cached, note: (cached.note ? cached.note + ' ' : '') + 'cached' };
    }

    // 3. LLM PATH: Modelo remoto para entender contexto
    try {
      const llmResult = await this.llmParse(clean, context);
      // Merge: se regex deu algo e LLM deu algo, prioriza LLM mas mantém regex como fallback
      if (fast && llmResult.confidence < this.confidenceThreshold) {
        const result = { ...fast, llmConfidence: llmResult.confidence, note: 'fallback_regex' };
        this.cache.set(clean, context, result);
        return result;
      }
      this.cache.set(clean, context, llmResult);
      return llmResult;
    } catch (err) {
      // 4. FALLBACK: Regex ou unknown
      if (fast) return { ...fast, note: 'llm_error_fallback' };
      return { intent: 'unknown', actions: [], confidence: 0.3, needsConfirmation: false, error: err.message };
    }
  }

  // ============================================================
  // FAST PATH: Regex patterns
  // ============================================================
  fastParse(text) {
    const actions = [];
    let intent = 'unknown';
    let maxConfidence = 0;

    for (const [key, pattern] of Object.entries(this.patterns)) {
      if (pattern.regex.test(text)) {
        const params = pattern.extract(text);
        const confidence = key === 'greeting' ? 0.98 : 0.85;
        actions.push({ type: pattern.action, params, confidence, source: 'regex' });
        if (confidence > maxConfidence) {
          maxConfidence = confidence;
          intent = pattern.action;
        }
      }
    }

    if (actions.length === 0) return null;

    // Se múltiplas ações, intent = 'multi_acao'
    if (actions.length > 1) intent = 'multi_acao';

    return {
      intent,
      actions,
      confidence: maxConfidence,
      needsConfirmation: actions.some(a => [
        'registrar_pagamento', 'registrar_pagamento_com_split',
        'registrar_despesa', 'registrar_despesa_com_split',
        'confirmar_tarefa', 'criar_tarefa', 'criar_lead',
        'adicionar_comentario', 'atualizar_status',
        'excluir_tarefa', 'excluir_pagamento', 'excluir_despesa', 'excluir_lead',
        'excluir_projeto', 'excluir_orcamento', 'excluir_despesa', 'excluir_ideia',
        'pagar_despesa', 'receber_split', 'ajustar_caixa', 'reconciliar_caixa',
        'enviar_email', 'responder_email', 'marcar_spam', 'mover_para_lixeira',
        'aprovar_rascunho', 'rejeitar_rascunho',
        'excluir_link', 'excluir_alerta_operacao', 'excluir_notificacao',
        'excluir_relatorio_bug', 'trocar_usuario'
      ].includes(a.type)),
      source: 'regex'
    };
  }

  // ============================================================
  // LLM PATH: Gemini API para entendimento profundo
  // ============================================================
  async llmParse(text, context = {}) {
    const response = await this.callGemini(text, context);
    return this.parseLLMResponse(response, text);
  }

  buildPrompt(text, context) {
    const author = context.authorName || 'CEO';
    const bufferSummary = context.bufferSummary || {};
    const dashboard = context.dashboardContext || {};
    
    // Build dashboard context section
    let dashboardSection = '';
    if (dashboard.currentModule) {
      dashboardSection += `\n- Página atual: ${dashboard.currentModule}`;
    }
    if (dashboard.currentRoute) {
      dashboardSection += `\n- Rota: ${dashboard.currentRoute}`;
    }
    if (dashboard.dashboardState) {
      const s = dashboard.dashboardState;
      dashboardSection += `\n- Tarefas pendentes: ${s.pendingTasks || 0}/${s.totalTasks || 0}`;
      dashboardSection += `\n- Notificações não lidas: ${s.unreadNotifications || 0}`;
      dashboardSection += `\n- Saldo caixa: €${s.cashBalance || 0}`;
      dashboardSection += `\n- Leads recentes: ${s.recentLeads || 0}`;
    }
    if (dashboard.userFocus) {
      dashboardSection += `\n- Foco do usuário: ${dashboard.userFocus.elementLabel || dashboard.userFocus.elementType || 'desconhecido'}`;
    }

    return `Você é o módulo de interpretação de comandos da Luna, assistente da NEXO Digital.
Sua única função é analisar o que o usuário quer e retornar um JSON válido.

CONTEXTO ATUAL:
- Autor: ${author}
- Tarefas pendentes: ${bufferSummary.tasks || 0}
- Leads novos: ${bufferSummary.leads || 0}
- Sinais financeiros: ${bufferSummary.finance || 0}${dashboardSection}

TEXTO DO USUÁRIO:
"""${text}"""

INSTRUÇÕES:
1. Identifique a intenção principal e quaisquer ações secundárias.
2. Extraia todos os parâmetros relevantes (nome, valor, descrição, prioridade).
3. Se o texto for apenas conversa social, PERGUNTA DE CONHECIMENTO GERAL ou curiosidade, use "social" com actions vazio.
4. "consulta" ou "consultar_status" deve ser usado APENAS quando o usuário pedir informações SOBRE O SISTEMA NEXO (tarefas, leads, caixa, status).
5. Para pagamentos/despesas: sempre extraia o valor numérico.
6. Para tarefas: extraia o título/descrição.
7. Para leads: extraia o nome do cliente e contexto.
8. Se não for uma ação executável no sistema NEXO, retorne intent "social" e actions [].

REGRAS DE PRIORIDADE:
- "P0" = urgente/crítico
- "P1" = importante
- "P2" = normal (padrão)

AÇÕES SUPORTADAS:
- criar_tarefa: { titulo, descricao?, prioridade?, responsavel? }
- criar_lead: { nome, contexto, telefone?, email?, prioridade? }
- registrar_pagamento: { valor, de, descricao, tipo? }
- registrar_pagamento_com_split: { valor, de, descricao } — quando o usuário pedir para dividir o pagamento
- registrar_despesa: { valor, para, descricao, tipo? }
- registrar_despesa_com_split: { valor, descricao, splitAmong? } — quando pedir para dividir a despesa
- confirmar_tarefa: { titulo, tarefa_id? }
- consultar_status: { filtro? }
- consultar_tarefas: { filtro? } — lista tarefas (pendentes, p0, hoje)
- consultar_leads: { filtro? } — lista leads do pipeline
- consultar_financeiro: { filtro? } — resumo financeiro completo
- consultar_whatsapp: { filtro? } — resumo de menções/mensagens
- verificar_mencoes: { filtro? } — alias para consultar_whatsapp
- criar_ideia: { titulo, descricao? } — cria nova ideia
- listar_ideias: { filtro? } — lista ideias existentes
- criar_projeto: { nome, descricao?, tipo?, status? } — cria novo projeto
- listar_projetos: { filtro? } — lista projetos existentes
- criar_cliente: { nome, email?, telefone? } — cadastra cliente
- listar_clientes: { filtro? } — lista clientes
- criar_orcamento: { titulo, valor, cliente?, descricao? } — cria orçamento
- escanear_whatsapp: {} — força scan do WhatsApp
- limpar_buffer_whatsapp: {} — limpa buffer de mensagens
- marcar_email_lido: { id } — marca email como lido
- arquivar_email: { id } — arquiva email
- listar_links: { filtro? } — lista links salvos
- listar_notificacoes: { filtro? } — lista notificações
- verificar_stack: {} — status do sistema
- social: { tipo }
- ideia: { texto }
- link: { url, contexto? }

FORMATO DE RESPOSTA (JSON puro, sem markdown):
{
  "intent": "nome_da_intencao",
  "actions": [
    { "type": "acao", "params": { ... }, "confidence": 0.95 }
  ],
  "needsConfirmation": true/false,
  "confidence": 0.0-1.0,
  "explanation": "breve explicação do que entendeu"
}

JSON:`;
  }

  async callGemini(text, context = {}) {
    if (!this.genAI) {
      throw new Error('Gemini não configurado');
    }

    const author = context.authorName || 'CEO';
    const bufferSummary = context.bufferSummary || {};

    const systemInstruction = `Você é o módulo de interpretação de comandos da Luna, assistente da NEXO Digital.
Sua única função é analisar o que o usuário quer e retornar um JSON válido.
Responda APENAS com JSON válido. Não use markdown, não explique, apenas JSON.

REGRA CRÍTICA:
- Se o usuário fizer uma pergunta de CONHECIMENTO GERAL (ciência, história, geografia, curiosidades, fatos) que NÃO está relacionada aos dados do NEXO, retorne intent "social" e actions [].
- "consulta" ou "consultar_status" deve ser usado APENAS quando o usuário pedir informações sobre o sistema NEXO (tarefas, leads, financeiro, status).
- Se não for uma ação executável no sistema NEXO, retorne intent "social" e actions vazio.`;

    const prompt = `CONTEXTO ATUAL:
- Autor: ${author}
- Tarefas pendentes: ${bufferSummary.tasks || 0}
- Leads novos: ${bufferSummary.leads || 0}
- Sinais financeiros: ${bufferSummary.finance || 0}

TEXTO DO USUÁRIO:
"""${text}"""

INSTRUÇÕES:
1. Identifique a intenção principal e quaisquer ações secundárias.
2. Extraia todos os parâmetros relevantes (nome, valor, descrição, prioridade).
3. Se o texto for apenas conversa social, use "social".
4. Se for apenas pedido de informação, use "consulta".
5. Para pagamentos/despesas: sempre extraia o valor numérico.
6. Para tarefas: extraia o título/descrição.
7. Para leads: extraia o nome do cliente e contexto.

REGRAS DE PRIORIDADE:
- "P0" = urgente/crítico
- "P1" = importante
- "P2" = normal (padrão)

AÇÕES SUPORTADAS:
- criar_tarefa: { titulo, descricao?, prioridade?, responsavel? }
- criar_lead: { nome, contexto, telefone?, email?, prioridade? }
- registrar_pagamento: { valor, de, descricao, tipo? }
- registrar_despesa: { valor, para, descricao, tipo? }
- confirmar_tarefa: { titulo, tarefa_id? }
- consultar_status: { filtro? }
- criar_ideia: { titulo, descricao? }
- listar_ideias: { filtro? }
- criar_projeto: { nome, descricao? }
- listar_projetos: { filtro? }
- criar_cliente: { nome, email?, telefone? }
- listar_clientes: { filtro? }
- criar_orcamento: { titulo, valor, cliente? }
- escanear_whatsapp: {}
- limpar_buffer_whatsapp: {}
- marcar_email_lido: { id }
- arquivar_email: { id }
- listar_links: { filtro? }
- listar_notificacoes: { filtro? }
- verificar_stack: {}
- social: { tipo }
- ideia: { texto }
- link: { url, contexto? }

FORMATO DE RESPOSTA (JSON puro, sem markdown):
{
  "intent": "nome_da_intencao",
  "actions": [
    { "type": "acao", "params": { ... }, "confidence": 0.95 }
  ],
  "needsConfirmation": true/false,
  "confidence": 0.0-1.0,
  "explanation": "breve explicação do que entendeu"
}

JSON:`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const result = await this.genAI.models.generateContent({
        model: this.geminiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          temperature: 0.1,
          maxOutputTokens: 1024
        }
      });

      clearTimeout(timeout);
      return result.text || '';
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  parseLLMResponse(response, originalText) {
    if (!response) {
      return { intent: 'unknown', actions: [], confidence: 0, needsConfirmation: false };
    }

    // Extrair JSON da resposta
    let jsonStr = response.trim();
    const codeBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    else {
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validar e normalizar
      const actions = (parsed.actions || []).map(a => ({
        type: a.type || 'unknown',
        params: a.params || {},
        confidence: Math.min(Math.max(a.confidence || parsed.confidence || 0.7, 0), 1),
        source: 'llm'
      }));

      // Se o LLM não retornou ações mas tem intent, converte
      if (actions.length === 0 && parsed.intent && parsed.intent !== 'unknown' && parsed.intent !== 'social' && parsed.intent !== 'consulta') {
        actions.push({ type: parsed.intent, params: {}, confidence: parsed.confidence || 0.6, source: 'llm' });
      }

      const confidence = Math.min(Math.max(parsed.confidence || 0.7, 0), 1);

      return {
        intent: parsed.intent || 'unknown',
        actions,
        confidence,
        needsConfirmation: parsed.needsConfirmation ?? this.shouldConfirm(actions),
        explanation: parsed.explanation || '',
        source: 'llm'
      };
    } catch (err) {
      // Se não conseguiu parsear JSON, tenta fallback regex
      const fast = this.fastParse(originalText);
      if (fast) return { ...fast, note: 'llm_parse_error', llmRaw: response.slice(0, 200) };

      return {
        intent: 'unknown',
        actions: [],
        confidence: 0.2,
        needsConfirmation: false,
        error: `JSON parse: ${err.message}`,
        llmRaw: response.slice(0, 200)
      };
    }
  }

  shouldConfirm(actions) {
    const criticalActions = [
      'registrar_pagamento', 'registrar_pagamento_com_split',
      'registrar_despesa', 'registrar_despesa_com_split',
      'confirmar_tarefa', 'criar_tarefa', 'criar_lead',
      'adicionar_comentario', 'atualizar_status',
      'excluir_tarefa', 'excluir_pagamento', 'excluir_despesa', 'excluir_lead',
      'excluir_projeto', 'excluir_orcamento', 'excluir_ideia',
      'pagar_despesa', 'receber_split', 'ajustar_caixa', 'reconciliar_caixa',
      'enviar_email', 'responder_email', 'marcar_spam', 'mover_para_lixeira',
      'aprovar_rascunho', 'rejeitar_rascunho',
      'excluir_link', 'excluir_alerta_operacao', 'excluir_notificacao',
      'excluir_relatorio_bug', 'trocar_usuario'
    ];
    return actions.some(a => criticalActions.includes(a.type));
  }

  // ============================================================
  // UTILIDADE: Detectar se o texto merece processamento LLM
  // ============================================================
  isComplexCommand(text) {
    const indicators = [
      /\be\s+/i,                    // múltiplas ações com "e"
      /\btamb[eé]m\b/i,             // "também"
      /\b(dividir|split|parte\s+de)\b/i,
      /\b(\d+[\.,]?\d*\s*(?:euro|eur|€))\b/i,
      /\b(?:anota|cria|registra).*\be\s+(?:anota|cria|registra|depois|também)\b/i,
      /\b(pagou|recebeu).*\be\s+.*\b(pagou|recebeu|anota|lead)\b/i
    ];
    return indicators.some(r => r.test(text));
  }
}

module.exports = { IntentParser };
