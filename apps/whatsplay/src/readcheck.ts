import { writeFileSync, mkdirSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WhatsAppWebTransport } from './browser.js';
import { SELECTORS } from './selectors.js';

/**
 * Validação de LEITURA (zero envio): coleta não-invasiva de badges de
 * não-lidas + readConversation num único chat (o de MENOS não-lidas, para
 * minimizar o efeito colateral de marcar como lidas).
 *
 * ⚠️ Abrir um chat marca as mensagens como lidas no aparelho — escolha
 * consciente; NENHUM envio é feito aqui.
 *
 *   pnpm --filter whatsplay readcheck
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'whatsplay-readcheck' });

const userDataDir = config.WHATSAPP_USER_DATA_DIR || join(homedir(), '.luna/chrome-whatsapp');
const evidenceDir = fileURLToPath(new URL('../../../.brain/luna/incidents', import.meta.url));

const BADGES_SCRIPT = `(sel) => {
  const seen = new Set();
  const out = [];
  for (const item of document.querySelectorAll(sel.chatItem)) {
    const badge = item.querySelector(sel.unreadBadge);
    const titleEl = item.querySelector('[title]');
    const name = titleEl ? titleEl.getAttribute('title') : '';
    if (!name) continue;
    const chatId = item.getAttribute('data-id') || name;
    if (seen.has(chatId)) continue; // role="row" e cell-frame-container casam o mesmo chat
    seen.add(chatId);
    const unreadText = badge ? (badge.textContent || '').trim() : '0';
    out.push({ chat_id: chatId, chat_name: name, unread: unreadText, has_badge: !!badge });
  }
  return out;
}`;

const PANEL_PROBE_SCRIPT = `(() => {
  const count = (s, root) => (root || document).querySelectorAll(s).length;
  const ids = [];
  document.querySelectorAll('[id]').forEach((el) => { if (ids.length < 30) ids.push(el.id); });
  const testIds = [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => String(e.getAttribute('data-testid'))))];
  const texts = [];
  document.querySelectorAll('.selectable-text').forEach((el) => {
    if (texts.length < 8) texts.push((el.textContent || '').trim().slice(0, 60));
  });
  const main = document.querySelector('#main');
  return {
    mainPresent: !!main,
    ids,
    conversationTestIds: testIds.filter((t) => /conversation|panel|main|messages/i.test(t)).slice(0, 15),
    msgContainer: count('[data-testid="msg-container"]'),
    messageInOut: count('.message-in, .message-out'),
    focusableRows: count('#main [role="row"]'),
    selectableTextCount: count('.selectable-text'),
    sampleTexts: texts,
    mainSnippet: main ? main.innerText.slice(0, 300) : null,
    bodyTail: document.body.innerText.slice(-300),
  };
})()`;

async function main(): Promise<void> {
  log.info({ userDataDir }, 'readcheck: subindo Chrome dedicado (LEITURA apenas)');
  const transport = new WhatsAppWebTransport({
    chromePath: config.WHATSAPP_CHROME_PATH,
    userDataDir,
    headless: config.WHATSAPP_HEADLESS,
    evidenceDir,
  });
  await transport.launch();

  const page = (transport as unknown as { requirePage(): import('playwright-core').Page }).requirePage();

  const state = await transport.detectSessionState();
  log.info({ state }, 'estado da sessão');
  if (state !== 'LOGGED_IN') {
    throw new Error(`sessão não está LOGGED_IN (=${state}) — nada a validar`);
  }
  // Normaliza o estado da UI: sai de "Archivados" se estiver aberta.
  await transport.ensureMainChatList();

  // 1) Coleta NÃO-invasiva: badges de não-lidas (zero cliques).
  const chats = (await page.evaluate(
    `(${BADGES_SCRIPT})(${JSON.stringify(SELECTORS)})`,
  )) as Array<{
    chat_id: string;
    chat_name: string;
    unread: string;
    has_badge: boolean;
  }>;
  const withUnread = chats.filter((c) => c.has_badge);
  log.info({ total_chats: chats.length, chats_with_unread: withUnread.length }, 'badges coletados (sem abrir nenhum chat)');
  for (const c of withUnread) {
    console.log(`  [não-lidas: ${c.unread}] ${c.chat_name}`);
  }

  // 2) readConversation no chat de MENOS não-lidas (efeito colateral mínimo).
  if (withUnread.length > 0) {
    const target = withUnread.reduce((a, b) => (parseInt(a.unread) <= parseInt(b.unread) ? a : b));
    log.warn({ chat: target.chat_name }, 'abrindo chat para readConversation (vai marcar como lidas)');
    const messages = await transport.readConversation(target.chat_id, 5);
    console.log(`── ${target.chat_name}: últimas ${messages.length} mensagens lidas ──`);
    for (const m of messages) {
      console.log(`  [${m.direction}] ${m.sender}: ${m.text.slice(0, 80)}`);
    }
    const panelProbe = await page.evaluate(PANEL_PROBE_SCRIPT);
    console.log('── probe do painel aberto ──');
    console.log(JSON.stringify(panelProbe, null, 2));
    const shot = `${evidenceDir}/readcheck-panel-${Date.now()}.png`;
    await page.screenshot({ path: shot });
    console.log(`screenshot pós-clique: ${shot}`);
  } else {
    console.log('sem não-lidas no momento — readConversation não acionado (sem efeito colateral)');
  }

  const report = { session_state: state, chats_total: chats.length, chats_with_unread: withUnread.length };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    `${evidenceDir}/readcheck-${Date.now()}.json`,
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
  await transport.close();
  log.info('readcheck concluído — nenhuma mensagem enviada');
}

main().catch((err) => {
  log.fatal({ err }, 'readcheck falhou');
  process.exit(1);
});
