#!/usr/bin/env node
/**
 * wa-peek.mjs — Olhos da Luna no WhatsApp Web: conecta no Chrome CDP do
 * whatsplay (porta 9333) e INSPECIONA/AJUSTA o que precisar.
 *
 * Uso:
 *   node scripts/wa-peek.mjs shot                 ← print da lista lateral
 *   node scripts/wa-peek.mjs search "Reformas"    ← busca e printa resultados
 *   node scripts/wa-peek.mjs open "Nome do Chat"  ← abre chat, printa, fecha
 *   node scripts/wa-peek.mjs unarchive "Nome"     ← abre chat arquivado e desarquiva
 *
 * DECRETO OWNER 2026-10-01: "o WhatsApp é da Luna e ela faz o que quiser
 * nele" — não achou um grupo? Vai lá, tira print, vê o que aconteceu.
 * Renomeou? Arruma. Arquivou? Desarquiva. Variável aberta em tudo.
 *
 * Segurança: sempre restaura o estado (busca limpa, painel fechado) — o
 * daemon do whatsplay segue dono do ciclo. Prints em .brain/peek/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps', 'whatsplay', 'src', 'index.ts'));
const { chromium } = require('playwright-core');

const SHOTS = path.join(ROOT, '.brain', 'peek');
fs.mkdirSync(SHOTS, { recursive: true });

const [, , action, ...rest] = process.argv;
const term = rest.join(' ');
const PORT = Number(process.env.WHATSAPP_CDP_PORT ?? 9333);

if (!action) {
  console.log('Uso: node scripts/wa-peek.mjs shot | search "termo" | open "nome" | unarchive "nome"');
  process.exit(2);
}

const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`).catch(() => null);
if (!browser) { console.error(`ERRO: Chrome CDP não responde na porta ${PORT} — whatsplay está no ar?`); process.exit(1); }
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('web.whatsapp')) ?? ctx.pages()[0];

const ts = Date.now();
const cdp = await ctx.newCDPSession(page).catch(() => null);
const snap = async (label) => {
  if (!cdp) { console.log('(sem sessão CDP — print pulado)'); return null; }
  const file = path.join(SHOTS, `${label}-${ts}.png`);
  try {
    const { data } = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8_000)),
    ]);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`print: ${file}`);
    return file;
  } catch {
    console.log('(print indisponível — compositor travado; seguindo com texto do DOM)');
    return null;
  }
};

// Extrai títulos + preview da lista lateral ou de resultados de busca (texto, sem pixel)
async function dumpChats(label) {
  const items = await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"], #side [role="row"], #side [role="listitem"]');
    rows.forEach((row) => {
      const titleEl = row.querySelector('span[title]');
      const previewEl = row.querySelector('span[dir="ltr"], .selectable-text');
      const section = row.closest('[data-testid="cell-frame-container"]')?.parentElement?.querySelector('[role="heading"], span[title]')?.textContent || '';
      out.push({
        title: titleEl?.getAttribute('title') || titleEl?.textContent || '',
        preview: (previewEl?.textContent || '').slice(0, 100),
        archived: /archiv|arquivad/i.test(row.textContent || ''),
      });
    });
    return out;
  }).catch((e) => [{ erro: e.message }]);
  const file = path.join(SHOTS, `${label}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
  console.log(`lista (${items.length} itens):`);
  items.forEach((i, n) => console.log(`  ${n + 1}. ${i.title || i.erro}${i.archived ? ' [ARQUIVADO]' : ''} — ${(i.preview || '').slice(0, 60)}`));
  console.log(`json: ${file}`);
  return items;
}

// Limpa busca residual e garante lista limpa
async function resetToList() {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const box = document.querySelector('#side [data-testid="chat-list-search"]') ||
                document.querySelector('#side input[aria-label*="Buscar" i]') ||
                document.querySelector('#side input[aria-label*="Search" i]');
    if (box && box.value) { box.focus(); document.execCommand('selectAll'); document.execCommand('delete'); }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

const title = () => page.evaluate(() => {
  const h = document.querySelector('header [data-testid="conversation-info-header"], #main header');
  return h ? (h.textContent || '').slice(0, 120) : null;
}).catch(() => null);

try {
  if (action === 'shot') {
    await resetToList();
    await dumpChats('lista');
    await snap('lista');
  }

  if (action === 'search' || action === 'open' || action === 'unarchive') {
    if (!term) { console.error('ERRO: informe o termo.'); process.exit(2); }
    await resetToList();
    const search = page.locator(
      '#side [data-testid="chat-list-search-container"] input:visible, #side input[aria-label*="Buscar" i]:visible, #side [role="textbox"]:visible'
    ).first();
    await search.click({ timeout: 3_000 }).catch(() => {});
    await page.keyboard.insertText(term);
    await page.waitForTimeout(1_500);
    await dumpChats(`busca-${term.slice(0, 20).replace(/\W+/g, '_')}`);
    await snap(`busca-${term.slice(0, 20).replace(/\W+/g, '_')}`);

    if (action === 'open' || action === 'unarchive') {
      await page.keyboard.press('Escape').catch(() => {});
      await search.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.insertText(term);
      await page.waitForTimeout(1_000);
      await search.click({ timeout: 1_500 }).catch(() => {});
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2_000);
      const t = await title();
      console.log('chat aberto:', t);
      await snap(`chat-${term.slice(0, 20).replace(/\W+/g, '_')}`);

      if (action === 'unarchive') {
        // Banner de arquivado no topo do painel? Clica em Desarquivar.
        const btn = page.locator('button:has-text("Desarchivar"), button:has-text("Desarquivar"), button:has-text("Unarchive"), [role="button"]:has-text("Desarchivar"), [role="button"]:has-text("Desarquivar")').first();
        const clicked = await btn.click({ timeout: 3_000 }).then(() => true).catch(() => false);
        if (clicked) {
          await page.waitForTimeout(1_200);
          console.log('DESARQUIVADO ✅');
          await snap('desarquivado');
        } else {
          // fallback: menu do chat → Desarquivar
          console.log('banner não achado — tentando menu do chat...');
          const menu = page.locator('#main header [data-testid="menu"], #main header [aria-label*="menu" i]').first();
          await menu.click({ timeout: 2_500 }).catch(() => {});
          await page.waitForTimeout(800);
          const item = page.locator('[role="button"]:has-text("Desarchivar"), [role="button"]:has-text("Desarquivar"), li:has-text("Desarchivar"), li:has-text("Desarquivar")').first();
          const ok = await item.click({ timeout: 2_500 }).then(() => true).catch(() => false);
          await page.waitForTimeout(1_200);
          console.log(ok ? 'DESARQUIVADO via menu ✅' : 'NÃO encontrei opção de desarquivar — veja o print');
          await snap('desarquivar-tentativa');
        }
      }
      // fecha o painel: voltar pra lista
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => { document.querySelector('#side [data-testid="search-back"], #side button[aria-label*="cerrar" i]')?.click(); }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
} finally {
  await resetToList().catch(() => {});
  await cdp?.detach().catch(() => {});
  browser.close(); // CDP: só solta a conexão, NÃO fecha o Chrome
}

console.log('OK — estado restaurado (lista limpa, painel fechado).');
