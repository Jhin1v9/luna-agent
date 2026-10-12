const { chromium } = require('playwright');
const path = require('path');

/**
 * WhatsApp Sender — Envia mensagens via WhatsApp Web usando Playwright CDP
 * Conecta no Chrome já aberto (porta 9223) e simula digitação/envio
 */
class WhatsAppSender {
  constructor() {
    this.cdpPort = 9223;
  }

  async sendMessage({ chatName, text }) {
    let browser = null;
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${this.cdpPort}`);
      const context = browser.contexts()[0];
      const page = context.pages()[0];

      if (!page) {
        throw new Error('Nenhuma pagina aberta no Chrome CDP');
      }

      // 1. Clicar na caixa de busca
      const searchSelector = '[data-testid="chat-list-search"], [title="Search or start new chat"], [contenteditable="true"][data-tab="3"]';
      await page.click(searchSelector).catch(() => {});
      await page.fill(searchSelector, chatName).catch(async () => {
        // Fallback: tentar digitar diretamente
        await page.keyboard.type(chatName);
      });
      await page.waitForTimeout(1500);

      // 2. Clicar no primeiro resultado da lista
      const firstResult = '[data-testid="chat-list"] > div:first-child, [data-testid="cell-frame-container"]:first-child';
      await page.click(firstResult).catch(() => {
        throw new Error(`Nao encontrou chat: ${chatName}`);
      });
      await page.waitForTimeout(800);

      // 3. Digitar mensagem no input
      const inputSelector = 'div[contenteditable="true"][data-tab="1"], [data-testid="conversation-compose-box-input"]';
      await page.click(inputSelector).catch(() => {});
      await page.fill(inputSelector, text).catch(async () => {
        // Fallback: digitar caractere por caractere
        await page.keyboard.type(text);
      });
      await page.waitForTimeout(500);

      // 4. Enviar (Enter)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      return { success: true, chat: chatName, text, method: 'playwright' };
    } catch (err) {
      console.error('[WHATSAPP SEND] Erro:', err.message);
      throw err;
    } finally {
      // NÃO fechar o browser — apenas desconectar do CDP
      // O browser é compartilhado com a Luna/MCP
      if (browser) await browser.disconnect().catch(() => {});
    }
  }
}

module.exports = WhatsAppSender;
