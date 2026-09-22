/**
 * Sanitização do texto outbound (bug ao vivo 2026-09-22): o LLM emite
 * Markdown (`**negrito**`, listas `- `, `#` títulos, crases) e o WhatsApp
 * NÃO renderiza — o destinatário recebe os marcadores crus, "toda esquisita".
 * Aqui converte pra texto limpo e legível em chat.
 */

/** Converte Markdown comum do LLM em texto puro legível no WhatsApp. */
export function sanitizeOutboundText(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n');
  // Blocos de código: mantém o conteúdo, tira as cercas.
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Títulos: "### Foo" → "Foo"; "####" idem.
  s = s.replace(/^#{1,6}\s*/gm, '');
  // Negrito/itálico duplo antes do simples (**text** / __text__).
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  // Itálico simples só quando envolve a palavra inteira (evita falso
  // positivo em "2*3" ou textos com asterisco solto).
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1$2');
  // Listas numeradas "1. " viram "1) " (leitura melhor em chat).
  s = s.replace(/^(\s*)\d+\.\s+/gm, '$1• ');
  // Listas com hífen/travessão viram bullet também.
  s = s.replace(/^(\s*)[-–]\s+/gm, '$1• ');
  // Links [texto](url) → "texto (url)" — nunca some a URL.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // Limpeza de linhas vazias repetidas.
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
