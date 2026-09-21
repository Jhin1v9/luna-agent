/**
 * Scripts executados DENTRO da página (page.evaluate).
 *
 * Por que strings e não funções TS: o transformador do tsx injeta um helper
 * `__name` em funções — dentro da página ele não existe (ReferenceError
 * encontrado na smoke F1.4). Script como string literal passa intacto.
 * Os seletores continuam vindo como argumento (SELECTORS — única fonte).
 */

export const DETECT_STATE_SCRIPT = `(sel) => {
  if (document.querySelector(sel.qrCanvas)) return 'QR_PENDING';
  if (document.querySelector(sel.chatList)) return 'LOGGED_IN';
  return 'LOADING';
}`;

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
  return rows.map((row) => {
    const inbound = row.className.includes('message-in') || !!row.closest('.message-in');
    const textEl = row.querySelector(sel.messageText);
    const quotedEl = row.querySelector('[data-pre-plain-text]');
    return {
      direction: inbound ? 'inbound' : 'outbound',
      text: textEl ? (textEl.textContent || '').trim() : '',
      quoted: quotedEl ? (quotedEl.textContent || '').trim() : null,
    };
  });
}`;

export const READ_CONVERSATION_SCRIPT = `({ sel, lim }) => {
  const rows = Array.from(document.querySelectorAll(sel.messageRow)).slice(-lim);
  return rows.map((row) => {
    const inbound = row.className.includes('message-in');
    const textEl = row.querySelector(sel.messageText);
    const senderEl = row.querySelector('[data-pre-plain-text]');
    return {
      sender: senderEl ? (senderEl.textContent || '').split(':')[0].trim() : '',
      direction: inbound ? 'inbound' : 'outbound',
      text: textEl ? (textEl.textContent || '').trim() : '',
    };
  });
}`;

export const OPEN_CHAT_SCRIPT = `({ sel, key }) => {
  const items = document.querySelectorAll(sel.chatItem);
  for (const item of items) {
    const titleEl = item.querySelector('[title]');
    const title = titleEl ? titleEl.getAttribute('title') : '';
    const dataId = item.getAttribute('data-id') || '';
    if (title === key || dataId === key) {
      item.click();
      return true;
    }
  }
  return false;
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
