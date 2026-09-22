/**
 * Scripts executados DENTRO da página (page.evaluate).
 *
 * Por que strings e não funções TS: o transformador do tsx injeta um helper
 * `__name` em funções — dentro da página ele não existe (ReferenceError
 * encontrado na smoke F1.4). Script como string literal passa intacto.
 * Os seletores continuam vindo como argumento (SELECTORS — única fonte).
 */

/** Probes estruturais para a heurística pura de estado (state.ts). Sem canvas solto. */
export const STATE_PROBES_SCRIPT = `(() => ({
  paneSide: document.querySelectorAll('#pane-side').length,
  chatListTestId: document.querySelectorAll('[data-testid="chat-list"]').length,
  chatListRoleGrid: document.querySelectorAll('#pane-side [role="grid"], [role="grid"]').length,
  landingWrapper: document.querySelectorAll('.landing-wrapper').length,
  landingMain: document.querySelectorAll('.landing-main').length,
  qrTestId: document.querySelectorAll('[data-testid="qrcode"]').length,
  qrRef: document.querySelectorAll('[data-ref]').length,
  canvasInLanding: document.querySelectorAll('.landing-wrapper canvas, .landing-main canvas').length,
}))()`;

/**
 * A pasta "Archivados/Arquivados/Archived" pode estar aberta (a sessão restaura
 * o último estado da UI). Detecta pelo HEADING — cuidado: no menu principal a
 * entrada da pasta também tem esse texto, mas dentro de cell-frame-title.
 */
export const ARCHIVED_OPEN_SCRIPT = `(() => {
  const els = document.querySelectorAll('span, div, h1, h2, h3');
  for (const e of els) {
    if (e.children.length > 0) continue;
    const t = (e.textContent || '').trim();
    if (!/^(archivados?|arquivados?|archived)$/i.test(t)) continue;
    if (e.closest('[data-testid="cell-frame-title"]')) continue; // entrada do menu, não o header
    return true;
  }
  return false;
})()`;

export const COLLECT_UNREAD_CHATS_SCRIPT = `(sel) => {
  const out = [];
  for (const item of document.querySelectorAll(sel.chatItem)) {
    if (!item.querySelector(sel.unreadBadge)) continue;
    const titleEl = item.querySelector('[title]');
    const name = titleEl ? titleEl.getAttribute('title') : '';
    if (!name) continue;
    out.push({ chat_id: item.getAttribute('data-id') || name, chat_name: name });
  }
  return out;
}`;

export const READ_PANEL_MESSAGES_SCRIPT = `(sel) => {
  const rows = Array.from(document.querySelectorAll(sel.messageRow)).slice(-30);
  const SELF = /^(tú|você|voce|you|tu)$/i;
  return rows.map((row) => {
    const textEl = row.querySelector(sel.messageText);
    // Direção: marcador estrutural tail-in/tail-out (validado ao vivo 2026-09-21);
    // fallback: padrão aria "Remetente:" (Self = Tú/Você/You).
    let direction = row.querySelector('[data-testid="tail-in"]') ? 'inbound'
      : row.querySelector('[data-testid="tail-out"]') ? 'outbound' : null;
    let sender = '';
    if (!direction) {
      for (const el of row.querySelectorAll('[aria-label]')) {
        const aria = el.getAttribute('aria-label') || '';
        const m = aria.match(/^(.*?)\\s*:\\s*$/);
        if (m) { sender = m[1].trim(); direction = SELF.test(sender) ? 'outbound' : 'inbound'; break; }
      }
    }
    if (!direction) direction = 'inbound'; // fallback explícito: sem marcadores, assume inbound
    // Autor: seletor semântico [data-testid="author"] (grupo); outbound = "Tú".
    const authorEl = row.querySelector('[data-testid="author"]');
    const author = authorEl ? (authorEl.textContent || '').trim() : direction === 'outbound' ? 'Tú' : null;
    const quotedEl = row.querySelector('[data-pre-plain-text]');
    return { direction, sender, author, text: textEl ? (textEl.textContent || '').trim() : '', quoted: quotedEl ? (quotedEl.textContent || '').trim() : null };
  });
}`;

export const READ_CONVERSATION_SCRIPT = `({ sel, lim }) => {
  const rows = Array.from(document.querySelectorAll(sel.messageRow)).slice(-lim);
  const SELF = /^(tú|você|voce|you|tu)$/i;
  return rows.map((row) => {
    const textEl = row.querySelector(sel.messageText);
    let direction = row.querySelector('[data-testid="tail-in"]') ? 'inbound'
      : row.querySelector('[data-testid="tail-out"]') ? 'outbound' : null;
    let sender = '';
    if (!direction) {
      for (const el of row.querySelectorAll('[aria-label]')) {
        const aria = el.getAttribute('aria-label') || '';
        const m = aria.match(/^(.*?)\\s*:\\s*$/);
        if (m) { sender = m[1].trim(); direction = SELF.test(sender) ? 'outbound' : 'inbound'; break; }
      }
    }
    if (!direction) direction = 'inbound';
    const authorEl = row.querySelector('[data-testid="author"]');
    const author = authorEl ? (authorEl.textContent || '').trim() : direction === 'outbound' ? 'Tú' : null;
    return { sender, author, direction, text: textEl ? (textEl.textContent || '').trim() : '', mid: row.getAttribute('data-id') || '' };
  });
}`;


export const MUTATION_OBSERVER_SCRIPT = `(sel) => {
  const collect = () => {
    const out = [];
    const items = document.querySelectorAll(sel.chatItem);
    for (const item of items) {
      if (!item.querySelector(sel.unreadBadge)) continue;
      const titleEl = item.querySelector('[title], [aria-label]');
      const name = titleEl
        ? titleEl.getAttribute('title') || titleEl.getAttribute('aria-label')
        : '';
      const dataId = item.getAttribute('data-id') || '';
      if (name) {
        out.push({
          chat_id: dataId || name,
          chat_name: name,
          external_id: 'badge:' + (dataId || name) + ':' + Date.now(),
          text: '',
          is_group: false,
          mentioned_luna: false,
          reply_to_luna: false,
          received_at: new Date().toISOString(),
        });
      }
    }
    return out;
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const unread = collect();
      if (unread.length > 0) window.onWaMutation(unread);
    }, 800);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  return true;
}`;

export const SIMPLIFIED_DOM_SCRIPT = `(() => {
  const lines = [];
  const walk = (el, depth) => {
    if (depth > 6 || lines.length > 400) return;
    const text = (el.textContent || '').trim().slice(0, 80);
    if (text) lines.push('  '.repeat(depth) + el.tagName.toLowerCase() + ': ' + text);
    const kids = el.children;
    for (let i = 0; i < kids.length && lines.length <= 400; i++) walk(kids[i], depth + 1);
  };
  walk(document.body, 0);
  return lines.join('\\n');
})()`;

/** Título do chat aberto no painel (verificação pós-clique). Só conta se o
 *  elemento estiver VISÍVEL — DOM oculto do WA Web mantém título antigo e
 *  gerava falso "aberto" (bug achado ao vivo 2026-09-22). */
export const OPEN_CHAT_TITLE_SCRIPT = `(() => {
  const visible = (e) => !!(e && e.offsetParent !== null && e.getClientRects().length > 0);
  const el = document.querySelector('[data-testid="conversation-info-header-chat-title"]');
  if (el && visible(el)) return (el.textContent || '').trim() || el.getAttribute('title');
  const t = document.querySelector('#main header [title]');
  if (t && visible(t)) return t.getAttribute('title');
  return null;
})()`;
