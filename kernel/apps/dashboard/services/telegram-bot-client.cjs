const TelegramBot = require('node-telegram-bot-api');

let botInstance = null;

module.exports = function getTelegramBot(token, options = {}) {
  if (!token) throw new Error('[TelegramBotClient] token is required');

  // v10.11-fix: polling é opt-in. Apenas o PM2 telegram-bot deve fazer polling.
  // O dashboard usa este cliente somente para envio de notificações (polling: false).
  const polling = options.polling === true;

  // Se já existe uma instância sem polling, mas alguém pede polling (ex: adapter),
  // iniciamos o polling na instância existente para evitar singleton travado.
  if (botInstance) {
    if (polling && typeof botInstance.startPolling === 'function' && !botInstance.isPolling) {
      console.log('[TelegramBotClient] Ativando polling na instância existente');
      botInstance.startPolling();
      botInstance.isPolling = true;
    }
    return botInstance;
  }

  botInstance = new TelegramBot(token, { polling });
  botInstance.isPolling = polling;

  if (polling) {
    botInstance.on('polling_error', (err) => {
      // 409 Conflict pode ocorrer transientemente após restart (Telegram ainda
      // vê a conexão anterior). Não paramos o polling; deixamos o cliente
      // reconectar automaticamente.
      if (err.message?.includes('409 Conflict')) {
        console.warn('[TG] Polling 409 (transitório):', err.message);
        return;
      }
      console.error('[TG] Polling error:', err.message);
    });
  }

  botInstance.on('error', (err) => {
    console.error('[TG] Bot error:', err.message);
  });

  console.log(`[TelegramBotClient] Singleton inicializado (polling=${polling})`);
  return botInstance;
};
