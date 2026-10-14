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

/**
 * Expansor de "ler mais" — decreto owner 2026-10-09: "SEMPRE identificar antes
 * de ler, já clicar, abrir a msg e já era. Clicar certeiramente, sem ter como
 * errar. Tem outro ler mais no mesmo texto? Clica de novo."
 *
 * Como é impecável: o clique é feito por DOM (.click()) SOMENTE em elementos
 * DENTRO do row da mensagem cujo texto seja EXATAMENTE "ler mais"/"leer más"/
 * "read more" (nó folha, zero filhos). Escopo fechado = alvo certo, sem
 * coordenadas de mouse, sem como clicar no lugar errado. Expandir pode revelar
 * OUTRO "ler mais" (texto com bloco citado longo, por ex.) — então o loop
 * reclica até não existir mais (máx 4 passadas). Só depois o texto é lido,
 * agora completo, sem corte.
 */
const EXPANDIR_LER_MAIS_JS = `
  const EXPAND_RE = /^(ler mais|leer m\\u00e1s|read more)$/i;
  const expandirRow = async (row) => {
    for (let passada = 0; passada < 4; passada++) {
      const alvos = Array.from(row.querySelectorAll('span, div, button'))
        .filter((el) => el.children.length === 0 && EXPAND_RE.test((el.textContent || '').trim()));
      if (alvos.length === 0) break;
      for (const alvo of alvos) alvo.click();
      await new Promise((r) => setTimeout(r, 250));
    }
  };
`;

export const READ_PANEL_MESSAGES_SCRIPT = `(sel) => {
  ${EXPANDIR_LER_MAIS_JS}
  const rows = Array.from(document.querySelectorAll(sel.messageRow)).slice(-30);
  const SELF = /^(tú|você|voce|you|tu)$/i;
  return Promise.all(rows.map(async (row) => {
    await expandirRow(row);
    // Bloco citado (reply) — quando existe, seus spans selecionáveis são
    // EXCLUÍDOS do texto da mensagem nova. Antes o textContent puxava o
    // preview da citação junto: quem respondia a msg da Luna com um emoji
    // entregava o "chat inteiro" pra ela (bug reportado pelo owner 26/09).
    // 2026-10-14 (WA atualizou o DOM): data-pre-plain-text agora existe no
    // wrapper de COPIA de TODA mensagem ("[hora, data] Autor: "), nao so
    // em citacoes — o filtro antigo (e o 1o fix por msg-meta, que falhava
    // quando o meta ficava fora do wrapper) excluia o proprio texto da
    // mensagem (sweep cego, inbound morto). Regra correta, validada no DOM
    // vivo: o wrapper da mensagem e o pre-plain EXTERNO; o bloco citado,
    // quando existe, fica ANINHADO dentro dele. So e citacao o pre-plain
    // que tem OUTRO pre-plain como ancestral no row.
    const allPre = Array.from(row.querySelectorAll('[data-pre-plain-text]'));
    const quotedEl = allPre.find((q) => allPre.some((o) => o !== q && o.contains(q))) || null;
    const textEls = Array.from(row.querySelectorAll(sel.messageText))
      .filter((el) => !quotedEl || !quotedEl.contains(el));
    const text = textEls.map((el) => (el.textContent || '').trim()).filter(Boolean).join(' ');
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
    if (!direction) {
      // 2026-10-14 (corrida pós-envio, validado no DOM vivo): mensagem
      // PRÓPRIA recém-enviada chega ao sweep SEM tail-out e SEM o aria
      // "Tú:" montado — caía no fallback inbound e a Luna ingeria a própria
      // fala como se fosse do cliente (loop de eco no grupo). O msg-meta tem
      // o status de entrega ("Enviado"/"Entregado"/"Leído"/"Pendiente"...) —
      // SÓ mensagem nossa tem — então ele é sinal estrutural de outbound.
      const metaEl = row.querySelector('[data-testid="msg-meta"]');
      const statusAria = metaEl
        ? Array.from(metaEl.querySelectorAll('[aria-label]'))
            .concat(metaEl.getAttribute('aria-label') ? [metaEl] : [])
            .map((e) => e.getAttribute('aria-label') || '')
            .join(' ')
        : '';
      if (/pendiente|enviado|entregado|le[ií]do|visto|aguardando/i.test(statusAria)) direction = 'outbound';
    }
    if (!direction) direction = 'inbound'; // fallback explícito: sem marcadores, assume inbound
    // Autor: seletor semântico [data-testid="author"] (grupo); outbound = "Tú".
    const authorEl = row.querySelector('[data-testid="author"]');
    const author = authorEl ? (authorEl.textContent || '').trim() : direction === 'outbound' ? 'Tú' : null;
    // 🖼️ Mídia inbound: imagem do corpo da mensagem (blob:). Avatar fica
    // fora do msg-container, então não pega falso positivo.
    const imgEl = direction === 'inbound' ? row.querySelector('img[src^="blob:"]') : null;
    return { direction, sender, author, text, quoted: quotedEl ? (quotedEl.textContent || '').trim() : null, img: imgEl ? imgEl.src : null };
  }));
}`;

export const READ_CONVERSATION_SCRIPT = `({ sel, lim }) => {
  ${EXPANDIR_LER_MAIS_JS}
  const rows = Array.from(document.querySelectorAll(sel.messageRow)).slice(-lim);
  const SELF = /^(tú|você|voce|you|tu)$/i;
  return Promise.all(rows.map(async (row) => {
    await expandirRow(row);
    // Bloco citado (reply) — igual ao READ_PANEL_MESSAGES_SCRIPT: os spans do
    // quote são EXCLUÍDOS do texto da mensagem nova. Sem isso, responder
    // citando entregava o texto da citada junto, atribuído ao autor da
    // RESPOSTA (bug owner 12/10: "vc manda OLA, eu mando 'oi luna' marcando
    // sua msg e vc fala q eu escrevi OLA").
    // 2026-10-14 (WA atualizou o DOM): data-pre-plain-text agora existe no
    // wrapper de COPIA de TODA mensagem ("[hora, data] Autor: "), nao so
    // em citacoes — o filtro antigo (e o 1o fix por msg-meta, que falhava
    // quando o meta ficava fora do wrapper) excluia o proprio texto da
    // mensagem (sweep cego, inbound morto). Regra correta, validada no DOM
    // vivo: o wrapper da mensagem e o pre-plain EXTERNO; o bloco citado,
    // quando existe, fica ANINHADO dentro dele. So e citacao o pre-plain
    // que tem OUTRO pre-plain como ancestral no row.
    const allPre = Array.from(row.querySelectorAll('[data-pre-plain-text]'));
    const quotedEl = allPre.find((q) => allPre.some((o) => o !== q && o.contains(q))) || null;
    const textEls = Array.from(row.querySelectorAll(sel.messageText))
      .filter((el) => !quotedEl || !quotedEl.contains(el));
    const text = textEls.map((el) => (el.textContent || '').trim()).filter(Boolean).join(' ');
    // Autor da mensagem CITADA: o atributo data-pre-plain-text do WA tem
    // formato "[data] [hora] - Autor: ". É o dono do texto citado, NUNCA o
    // autor da resposta — os dois são coisas diferentes (decreto owner 12/10).
    let quotedAuthor = null;
    if (quotedEl) {
      const pre = quotedEl.getAttribute('data-pre-plain-text') || '';
      const m = pre.match(/-\\s*([^:\\n]+):\\s*$/);
      quotedAuthor = m ? m[1].trim() : null;
    }
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
    if (!direction) {
      // 2026-10-14 (corrida pós-envio, validado no DOM vivo): mensagem
      // PRÓPRIA recém-enviada chega ao sweep SEM tail-out e SEM o aria
      // "Tú:" montado — caía no fallback inbound e a Luna ingeria a própria
      // fala como se fosse do cliente (loop de eco no grupo). O msg-meta tem
      // o status de entrega ("Enviado"/"Entregado"/"Leído"/"Pendiente"...) —
      // SÓ mensagem nossa tem — então ele é sinal estrutural de outbound.
      const metaEl = row.querySelector('[data-testid="msg-meta"]');
      const statusAria = metaEl
        ? Array.from(metaEl.querySelectorAll('[aria-label]'))
            .concat(metaEl.getAttribute('aria-label') ? [metaEl] : [])
            .map((e) => e.getAttribute('aria-label') || '')
            .join(' ')
        : '';
      if (/pendiente|enviado|entregado|le[ií]do|visto|aguardando/i.test(statusAria)) direction = 'outbound';
    }
    if (!direction) direction = 'inbound';
    const authorEl = row.querySelector('[data-testid="author"]');
    const author = authorEl ? (authorEl.textContent || '').trim() : direction === 'outbound' ? 'Tú' : null;
    return { sender, author, direction, text, quoted: quotedEl ? (quotedEl.textContent || '').trim() : null, quotedAuthor, mid: row.getAttribute('data-id') || '' };
  }));
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
