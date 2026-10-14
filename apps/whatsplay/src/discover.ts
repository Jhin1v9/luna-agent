import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { WhatsAppWebTransport } from './browser.js';

/**
 * Descoberta do estado real da sessão WhatsApp Web (decreto F1.4: NÃO inventar
 * QR flow — descobrir primeiro). Sobe o Chrome dedicado, abre o WhatsApp Web,
 * detecta o estado da sessão, tira screenshot + DOM simplificado e reporta.
 *
 *   pnpm --filter whatsplay discover        # detecta e sai
 *   pnpm --filter whatsplay login           # mantém aberto para pareamento manual (QR)
 */

loadDotEnv();
const config = loadConfig();
const log = createLogger({ name: 'whatsplay-discover' });

const userDataDir =
  config.WHATSAPP_USER_DATA_DIR || '/home/nexo/.luna/chrome-whatsapp';
const evidenceDir = '/home/nexo/luna-agent/.brain/luna/incidents';
const loginMode = process.argv.includes('--login');

async function main(): Promise<void> {
  log.info({ chrome: config.WHATSAPP_CHROME_PATH, userDataDir, headless: config.WHATSAPP_HEADLESS }, 'subindo Chrome dedicado para descoberta');
  const transport = new WhatsAppWebTransport({
    chromePath: config.WHATSAPP_CHROME_PATH,
    userDataDir,
    headless: config.WHATSAPP_HEADLESS,
    evidenceDir,
  });

  await transport.launch();
  log.info('página carregada, aguardando render (15s)…');
  await new Promise((r) => setTimeout(r, 15_000));

  const state = await transport.detectSessionState();
  const status = await transport.getStatus();
  const evidence = await transport.captureEvidence('discover');

  const report = {
    session_state: state,
    page_alive: status.pageAlive,
    evidence,
    logged_in: state === 'LOGGED_IN',
    next_step:
      state === 'LOGGED_IN'
        ? 'sessão pronta — WhatsPlay pode operar'
        : 'sessão NÃO pareada neste perfil — rode "pnpm --filter whatsplay login" e escaneie o QR uma vez',
  };
  log.info({ report }, 'descoberta concluída');
  console.log(JSON.stringify(report, null, 2));

  if (loginMode && state !== 'LOGGED_IN') {
    log.info('modo login: navegador ficará aberto por 3min para pareamento manual (QR). Escaneie e aguarde…');
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      if ((await transport.detectSessionState()) === 'LOGGED_IN') {
        log.info('SESSÃO PAREADA ✅ — perfil dedicado gravado.');
        break;
      }
    }
  }

  await transport.close();
}

main().catch((err) => {
  log.fatal({ err }, 'descoberta falhou');
  process.exit(1);
});
