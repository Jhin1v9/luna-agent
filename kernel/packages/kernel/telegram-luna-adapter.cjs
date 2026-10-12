// ============================================================
// LUNA TELEGRAM ADAPTER v4.0 — Kernel Unificado
// Adapter fino: apenas transport layer. Toda inteligência vive no Luna Soul.
// ============================================================

const fs = require('fs');
const path = require('path');

// Load .env manually before any module that needs env vars
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0 && !line.startsWith('#')) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  });
}

const lunaConfig = require('./config/luna-config');
const telegramBotPaths = [
  path.join(lunaConfig.NEXO_DIR, 'services', 'telegram-bot-client.cjs'),
  path.join(lunaConfig.NEXO_DIR, 'backend', 'services', 'telegram-bot-client.cjs'),
];
const telegramBotPath = telegramBotPaths.find(p => fs.existsSync(p));
if (!telegramBotPath) {
  console.error('❌ telegram-bot-client.cjs não encontrado em:', telegramBotPaths.join(' / '));
  process.exit(1);
}
const getTelegramBot = require(telegramBotPath);
const { LunaSoul } = require('./luna-soul.cjs');
const { SessionManager } = require('./session-manager.cjs');
const { DASHBOARD_TOOL_REGISTRY } = require('./dashboard-tool-registry.cjs');

const SESSION_DIR = path.join(__dirname, '..', 'data', 'telegram-sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ── CONFIG ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN não configurado');
  process.exit(1);
}

// ── ADAPTER ──
class TelegramLunaAdapter {
  constructor() {
    this.bot = getTelegramBot(TOKEN, { polling: true });
    this.luna = null;
    this.activeStreams = new Map(); // chatId → { messageId, lastEdit }
    this.activeUsers = new Set();   // evita overlapping requests
    this.awakeChats = new Set();    // chats em modo persistente (wake)
    this._loadAwakeState();
  }

  async start() {
    console.log('🚀 Iniciando Luna Telegram Adapter v4.0...');

    this.sessionManager = new SessionManager();
    this.luna = new LunaSoul({});
    await this.luna.init();
    console.log('✅ Luna Soul inicializado');

    this._setupHandlers();
    console.log('✅ Telegram polling ativo');

    const me = await this.bot.getMe();
    console.log(`🤖 Bot: @${me.username}`);
  }

  stop() {
    // v10.3-fix: Don't stopPolling on singleton — other services may be using it
    console.log('🛑 Telegram Adapter parado (bot continua ativo)');
  }

  _setupHandlers() {
    // ── Comandos ──
    this.bot.onText(/^\/start/, (msg) => this._cmdStart(msg));
    this.bot.onText(/^\/modo\s+(.+)/, (msg, match) => this._cmdModo(msg, match));
    this.bot.onText(/^\/persona\s+(.+)/, (msg, match) => this._cmdModo(msg, match));
    this.bot.onText(/^\/status/, (msg) => this._cmdStatus(msg));
    this.bot.onText(/^\/newaba/, (msg) => this._cmdNewAba(msg));
    this.bot.onText(/^\/kimi(?:\s+(on|off))?/, (msg, match) => this._cmdKimi(msg, match));

    // ── Mensagens genéricas ──
    this.bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      await this._handleUserMessage(msg);
    });

    // ── Callbacks inline (votações) ──
    this.bot.on('callback_query', async (query) => {
      await this._handleCallbackQuery(query);
    });

    // ── Erros ──
    this.bot.on('polling_error', (err) => {
      console.warn('[TG] Polling error:', err.message || err);
    });
  }

  async _handleCallbackQuery(query) {
    const data = query.data || '';
    if (!data.startsWith('vote:')) return;

    const parts = data.split(':');
    if (parts.length !== 3) return;
    const [, sessionId, voteValue] = parts;

    // Mapear chatId para userId do dashboard
    const chatId = String(query.from.id);
    const voter = this._resolveVoterFromChatId(chatId);
    if (!voter) {
      await this.bot.answerCallbackQuery(query.id, { text: '❌ Usuário não mapeado para votação. Configure seu telegramId no dashboard.', show_alert: true });
      return;
    }

    try {
      const response = await fetch('http://localhost:3456/api/voting/telegram-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, voter, vote: voteValue, secret: process.env.TELEGRAM_BOT_TOKEN })
      });
      const result = await response.json();

      if (result.success) {
        const session = result.session;
        const emoji = voteValue === 'yes' ? '✅' : '❌';
        await this.bot.answerCallbackQuery(query.id, { text: `${emoji} Voto registrado!` });
        // Editar mensagem para remover botões se sessão fechou
        if (session.status !== 'open' && session.status !== 'voting') {
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
          } catch (e) {
            // ignorar erro de edição
          }
        }
      } else {
        await this.bot.answerCallbackQuery(query.id, { text: `⚠️ ${result.error || 'Erro ao votar'}`, show_alert: true });
      }
    } catch (err) {
      console.error('[TG] Erro ao processar voto:', err.message);
      await this.bot.answerCallbackQuery(query.id, { text: '❌ Erro ao processar voto. Tente pelo dashboard.', show_alert: true });
    }
  }

  _resolveVoterFromChatId(chatId) {
    try {
      const usersFile = path.join(lunaConfig.NEXO_DIR, 'backend', 'data', 'users.json');
      if (!fs.existsSync(usersFile)) return null;
      const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      for (const [userId, user] of Object.entries(data.users || {})) {
        if (String(user.telegramId) === chatId) return userId;
      }
    } catch (e) {
      console.error('[TG] Erro ao resolver voter:', e.message);
    }
    return null;
  }

  // ── COMANDOS ──

  async _cmdStart(msg) {
    const chatId = msg.chat.id;
    const name = msg.from?.first_name || 'usuário';
    await this.bot.sendMessage(chatId,
      `🌙 *Olá, ${name}!* Sou Luna, sua agente autônoma unificada.\n\n` +
      `Posso ajudar com:\n` +
      `• 💻 Código e arquivos no seu PC\n` +
      `• 📋 Tarefas e leads no dashboard\n` +
      `• 🔍 Pesquisa na internet\n\n` +
      `*Comandos:*\n` +
      `/kimi — ativar modo persistente (respondo todas as msgs)\n` +
      `/kimi off — desativar modo persistente\n` +
      `/modo [engenheiro|arquiteto|produto|devops|default] — trocar persona\n` +
      `/newaba — nova sessão de chat\n` +
      `/status — status do sistema`,
      { parse_mode: 'Markdown' }
    );
  }

  async _cmdModo(msg, match) {
    const chatId = msg.chat.id;
    const persona = match[1].trim().toLowerCase();
    const valid = ['engenheiro', 'arquiteto', 'produto', 'devops', 'default', 'dev'];

    if (!valid.includes(persona)) {
      await this.bot.sendMessage(chatId,
        `⚠️ Persona desconhecida: *${persona}*\n` +
        `Disponíveis: ${valid.join(', ')}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Persiste preferência
    const prefPath = path.join(SESSION_DIR, `${chatId}-persona.json`);
    fs.writeFileSync(prefPath, JSON.stringify({ persona, updatedAt: new Date().toISOString() }));

    await this.bot.sendMessage(chatId, `✅ Persona alterada para: *${persona}*`, { parse_mode: 'Markdown' });
  }

  async _cmdStatus(msg) {
    const chatId = msg.chat.id;
    const status = this.luna?.kimiBridge?.getStatus?.() || { running: false };
    const isAwake = this.awakeChats.has(chatId);
    await this.bot.sendMessage(chatId,
      `📊 *Status Luna*\n\n` +
      `Chrome: ${status.running ? '🟢 Conectado' : '🔴 Desconectado'}\n` +
      `Modo persistente: ${isAwake ? '🟢 Ativo (respondo todas as msgs)' : '🔴 Inativo'}\n` +
      `Sessões ativas: ${this.activeStreams.size}\n` +
      `Usuários processando: ${this.activeUsers.size}`,
      { parse_mode: 'Markdown' }
    );
  }

  async _cmdNewAba(msg) {
    const chatId = msg.chat.id;
    const userId = `telegram-${chatId}`;
    const sessionId = userId;
    try {
      await this.luna.newThread(userId);
      this.sessionManager.clearContext(sessionId);
      await this.bot.sendMessage(chatId, '🆕 *Nova sessão iniciada!*', { parse_mode: 'Markdown' });
    } catch (e) {
      await this.bot.sendMessage(chatId, `❌ Erro: ${e.message}`);
    }
  }

  async _cmdKimi(msg, match) {
    const chatId = msg.chat.id;
    const arg = (match[1] || '').trim().toLowerCase();

    if (arg === 'off') {
      this.awakeChats.delete(chatId);
      this._saveAwakeState();
      await this.bot.sendMessage(chatId,
        `😴 *Luna dormindo...*\n\nNão vou mais responder mensagens automáticas.\nMande \`/kimi\` quando quiser me acordar!`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // /kimi ou /kimi on → acorda
    const wasAwake = this.awakeChats.has(chatId);
    this.awakeChats.add(chatId);
    this._saveAwakeState();

    if (!wasAwake) {
      await this.bot.sendMessage(chatId,
        `🌙 *Luna acordou!*\n\nEstou no modo persistente — vou responder *todas* as suas mensagens até você mandar \`/kimi off\`.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await this.bot.sendMessage(chatId,
        `🌙 *Já estou acordada!*\n\nModo persistente ativo. Mande \`/kimi off\` para eu dormir.`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  _loadAwakeState() {
    try {
      const p = path.join(SESSION_DIR, 'awake-chats.json');
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data)) data.forEach(id => this.awakeChats.add(id));
    } catch { /* ignora se não existe */ }
  }

  _saveAwakeState() {
    try {
      const p = path.join(SESSION_DIR, 'awake-chats.json');
      fs.writeFileSync(p, JSON.stringify([...this.awakeChats]));
    } catch (e) { console.warn('[TG] Erro ao salvar awake state:', e.message); }
  }

  _getCategoryForTool(toolName) {
    for (const cat of Object.values(DASHBOARD_TOOL_REGISTRY)) {
      if (cat.tools.some(t => t.name === toolName)) return cat;
    }
    return null;
  }

  // ── MENSAGEM PRINCIPAL ──

  async _handleUserMessage(msg) {
    const chatId = msg.chat.id;
    const userId = `telegram-${chatId}`;
    const text = msg.text;
    const name = msg.from?.first_name || 'usuário';

    // Se o chat NÃO está no modo persistente, ignora mensagens genéricas
    if (!this.awakeChats.has(chatId)) {
      return;
    }

    // Evita overlapping
    if (this.activeUsers.has(userId)) {
      await this.bot.sendMessage(chatId, '⏳ Aguarde a resposta anterior...', {
        reply_to_message_id: msg.message_id,
      });
      return;
    }
    this.activeUsers.add(userId);

    // Carrega persona salva
    const prefPath = path.join(SESSION_DIR, `${chatId}-persona.json`);
    let persona = 'default';
    try {
      const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
      persona = pref.persona;
    } catch {}

    // Cria/recupera sessão persistente por chat
    const sessionId = `telegram-${chatId}`;
    let session = this.sessionManager.loadSession(sessionId);
    if (!session) {
      session = this.sessionManager.createSession({
        id: sessionId,
        title: `Telegram ${chatId}`,
        mode: 'CHAT',
        persona,
        metadata: { source: 'telegram', chatId },
      });
    }

    // Envia "Pensando..."
    const thinkingMsg = await this.bot.sendMessage(chatId, '🌙 *Só um instantinho, tô vendo isso pra você...*', {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id,
    });

    this.activeStreams.set(chatId, {
      messageId: thinkingMsg.message_id,
      lastText: '',
      editCount: 0,
    });

    try {
      const stream = this.luna.processMessageStream(text, {
        sessionId: session.id,
        userId,
        mode: session.mode,
        persona,
        channel: 'telegram',
      });

      let fullResponse = '';
      let hasStartedResponding = false;

      for await (const ev of stream) {
        switch (ev.type) {
          case 'thinking_start':
            // "Pensando..." message already sent before the loop
            break;

          case 'thinking_delta':
            // Opcional: mostrar thinking ao vivo (pode ser barulho no Telegram)
            break;

          case 'response_delta': {
            fullResponse = ev.fullResponse || '';
            hasStartedResponding = true;
            await this._updateMessage(chatId, fullResponse);
            break;
          }

          case 'response_done': {
            const meta = this.activeStreams.get(chatId);
            const text = this._sanitizeText(ev.response || '');
            if (meta && text) {
              // Evita reenvio se o response_delta já editou para o mesmo texto
              if (text.slice(0, 4000) !== meta.lastText) {
                await this._finalizeMessage(chatId, text);
              }
            } else if (text) {
              await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            break;
          }

          case 'action_start': {
            const toolName = ev.tool || 'tool';
            const cat = this._getCategoryForTool(toolName);
            const emoji = cat?.emoji || '🔧';
            const label = cat?.label || 'Ação';
            await this.bot.sendMessage(chatId, `${emoji} *${label}* — Só um segundinho...`, { parse_mode: 'Markdown' });
            break;
          }

          case 'action_end': {
            const res = ev.result;
            const cat = this._getCategoryForTool(ev.tool);
            const icon = res?.success !== false ? '✅' : '❌';
            const label = cat?.label || 'Ação';
            await this.bot.sendMessage(chatId, `${icon} *${label}* ${res?.success !== false ? 'concluída' : 'falhou'}.`, { parse_mode: 'Markdown' });
            break;
          }

          case 'error': {
            await this.bot.sendMessage(chatId, `❌ *Erro:* ${this._sanitizeText(ev.message || ev.error || 'desconhecido')}`, {
              parse_mode: 'Markdown',
            });
            break;
          }

          case 'done': {
            // Mensagem final já foi definida por response_done
            break;
          }
        }
      }

      // Se nunca chegou response_delta, edita com o que temos
      if (!hasStartedResponding && fullResponse) {
        await this._finalizeMessage(chatId, fullResponse);
      }

    } catch (e) {
      console.error('[TG] Erro no stream:', e);
      await this.bot.sendMessage(chatId, `❌ Erro interno: ${e.message}`);
    } finally {
      this.activeUsers.delete(userId);
      this.activeStreams.delete(chatId);
    }
  }

  // ── HELPERS DE UI ──

  _sanitizeText(text) {
    if (!text) return '';
    // Converte \n literal (dois chars: backslash + n) em quebra de linha real
    // Isso acontece quando o Kimi retorna texto com newlines escapados
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');
  }

  async _updateMessage(chatId, text) {
    const meta = this.activeStreams.get(chatId);
    if (!meta) return;

    // Sanitiza newlines escapados antes de enviar pro Telegram
    text = this._sanitizeText(text);

    // Telegram limit: 4096 chars. Trunca para edição.
    const safe = text.slice(0, 4000);
    if (safe === meta.lastText) return; // evita edições desnecessárias

    // Rate limit: no máximo 1 edição a cada 2s
    const now = Date.now();
    if (now - meta.lastEdit < 2000) return;

    try {
      await this.bot.editMessageText(safe, {
        chat_id: chatId,
        message_id: meta.messageId,
        parse_mode: 'Markdown',
      });
      meta.lastText = safe;
      meta.lastEdit = now;
      meta.editCount++;
    } catch (e) {
      // Edit conflicts (message not modified) são normais
      if (!e.message?.includes('not modified')) {
        console.warn('[TG] Edit error:', e.message);
      }
    }
  }

  async _finalizeMessage(chatId, text) {
    const meta = this.activeStreams.get(chatId);
    if (!meta) return;

    text = this._sanitizeText(text);
    const safe = text.slice(0, 4000);
    try {
      await this.bot.editMessageText(safe, {
        chat_id: chatId,
        message_id: meta.messageId,
        parse_mode: 'Markdown',
      });
    } catch {
      // Se edit falhar, manda nova mensagem
      await this.bot.sendMessage(chatId, safe, { parse_mode: 'Markdown' });
    }
  }
}

// ── CLI / SINGLETON ──
let instance = null;

async function start() {
  if (!instance) instance = new TelegramLunaAdapter();
  await instance.start();
  return instance;
}

function stop() {
  if (instance) instance.stop();
  instance = null;
}

module.exports = { TelegramLunaAdapter, start, stop };

// Se executado diretamente
if (require.main === module) {
  start().catch(e => {
    console.error('❌ Falha ao iniciar:', e);
    process.exit(1);
  });
  process.on('SIGINT', () => { stop(); process.exit(0); });
}
