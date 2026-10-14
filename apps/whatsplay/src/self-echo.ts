/**
 * ECO PRÓPRIO (owner 27/09): relay/citação devolve as falas da Luna como
 * mensagem nova e ela comentava o próprio texto ("veio só com minhas falas
 * de volta kkk") — ruído em loop. Dois sinais inequívocos de relay:
 *   A) texto termina com assinatura "— Luna" (formato do condutor) e o
 *      corpo bate com outbound recente (overlap ≥ 0,7);
 *   B) citação pura das palavras dela de volta (quoted_from_luna e
 *      overlap ≥ 0,85) — se a pessoa acrescentou pergunta/pedido, o overlap
 *      cai e a mensagem passa normal (menção SEMPRE responde com texto novo).
 */

const normTxt = (s: string): string =>
  s
    .replace(/@luna/gi, ' ')
    .replace(/[—–-]\s*luna\s*$/i, ' ') // assinatura do relay no fim
    .replace(/^luna\s*:\s*/gim, ' ') // linhas "Luna: ..." do transcript
    // 2026-10-14 (loop de eco no grupo): a transcrição do sweep prefixa
    // "Tú: " nas falas PRÓPRIAS — sem strip, o eco dela mesma nunca batia.
    .replace(/^(tú|você|voce|you|tu)\s*:\s*/gim, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const echoTokens = (s: string): Set<string> =>
  new Set(normTxt(s).split(/[^a-z0-9à-ú]+/).filter((t) => t.length >= 2));

const overlapWith = (a: Set<string>, body: string): number => {
  if (!a.size) return 0;
  const b = echoTokens(body);
  if (!b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / a.size;
};

export interface SelfEchoVerdict {
  echo: boolean;
  overlap: number;
  relaySignature: boolean;
}

export function detectSelfEcho(text: string, quotedFromLuna: boolean, recentOutbounds: string[]): SelfEchoVerdict {
  const inboundTok = echoTokens(text);
  if (inboundTok.size < 4) return { echo: false, overlap: 0, relaySignature: false };
  const relaySignature = /[—–-]\s*luna\s*$/i.test(text.trim());
  const best = Math.max(0, ...recentOutbounds.map((b) => overlapWith(inboundTok, b ?? '')));
  return {
    echo:
      (relaySignature && best >= 0.7) ||
      (quotedFromLuna && best >= 0.85) ||
      // 2026-10-14: relay VERBATIM da fala da Luna (sem assinatura e sem
      // citação detectada) — overlap quase total é eco, puro.
      best >= 0.9,
    overlap: Number(best.toFixed(2)),
    relaySignature,
  };
}
