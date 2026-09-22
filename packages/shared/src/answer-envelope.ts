/**
 * Unwrap do envelope de saída estruturada ANSWER (contrato §5).
 *
 * Bug ao vivo 2026-09-22: o FAST emitiu o JSON com newlines LITERAIS dentro
 * da string "text" (JSON estrito quebrado) — o parse degradava e o envelope
 * inteiro (`{"type":"ANSWER","text":"..."}`) ia parar no body da mensagem
 * e era digitado LITERALMENTE no WhatsApp. Este extrator é tolerante: lê o
 * valor de "text" caractere a caractere (escapes + newlines literais + prosa
 * ao redor do envelope), sem depender de JSON.parse.
 */

/** Extrai o texto de um envelope ANSWER quebrado. null se não for envelope. */
export function extractAnswerEnvelopeText(raw: string): string | null {
  const typeIdx = raw.search(/"type"\s*:\s*"ANSWER"/);
  if (typeIdx < 0) return null;
  const afterType = raw.slice(typeIdx);
  const textMatch = afterType.match(/"text"\s*:\s*"/);
  if (!textMatch || textMatch.index === undefined) return null;
  let i = typeIdx + textMatch.index + textMatch[0].length;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1]!;
      if (n === 'n') { out += '\n'; i += 2; continue; }
      if (n === 't') { out += '\t'; i += 2; continue; }
      if (n === 'r') { i += 2; continue; }
      if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      out += n; // \" \\ \/ etc.
      i += 2;
      continue;
    }
    if (ch === '"') break; // fecha o valor da string
    out += ch; // newlines literais e prosa passam direto
    i += 1;
  }
  const trimmed = out.trim();
  return trimmed ? trimmed : null;
}
