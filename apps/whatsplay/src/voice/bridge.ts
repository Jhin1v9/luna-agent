/**
 * F6 — Voz: sistema a três (contrato v1.1 §26). SOFTWARE completo agora;
 * mixagem duplex (VB-Cable x2 + VoiceMeeter) = ação manual do owner guiada
 * por docs/hardware-voz.md.
 *
 * Os 4 papéis:
 *  - Abner — fala na ligação WhatsApp.
 *  - Operador (ChatGPT voz) — a VOZ. Recebe texto da Luna e fala.
 *  - Luna/Kimi — o CÉREBRO. Lê a transcrição, decide, escreve o que o
 *    Operador deve falar.
 *  - VoiceBridge (este módulo) — o RELAY: escreve o texto de Luna no chat da
 *    chamada do ChatGPT e lê a transcrição com cursor (~5s).
 */

export const OPERADOR_VOICE_PROMPT = `Você é a voz da Luna, assistente da NEXO DIGITAL, numa chamada de voz com
Abner, o dono da empresa. Você é um INTERMEDIÁRIO consciente:

- Abner fala com você. A Luna lê a transcrição e te manda POR TEXTO o que
  você deve falar.
- Quando receber instrução da Luna, fale EXATAMENTE o que ela mandar.
- Mantenha a conversa viva: se a Luna estiver executando algo, diga
  "só um momento, estou criando a solicitação" — nunca deixe silêncio morto.
- NUNCA invente resultados, preços ou prazos. Não sabe? Diga que vai
  verificar com a Luna.
- Trate "Luna" como sua colega: "vou falar com a Luna", "a Luna já fez o
  que você pediu".`;

export interface TranscriptTurn {
  speaker: string;
  text: string;
  at: string;
}

/**
 * VoiceBridge — relay entre Luna e a chamada de voz do Operador (ChatGPT).
 * Implementação real = Playwright na aba da chamada (escreve no chat de
 * texto da chamada; lê a transcrição). Aqui a interface estável + relay de
 * texto injetável (testes) — a conexão browser entra quando o owner montar o
 * hardware (guia numerado).
 */
export interface VoiceBridge {
  /** Escreve no chat da chamada o que o Operador deve falar. */
  relay(text: string): Promise<void>;
  /** Lê turnos de transcrição NOVOS a partir do cursor (polling ~5s). */
  readTranscript(cursor: number): Promise<{ turns: TranscriptTurn[]; nextCursor: number }>;
}

/** Marca de espera padronizada (§26): Abner nunca fica em silêncio morto. */
export const HOLD_TEXT = 'só um momento, estou criando a solicitação — Luna';

export class EchoBridge implements VoiceBridge {
  private log: string[] = [];
  async relay(text: string): Promise<void> {
    this.log.push(text);
  }
  async readTranscript(cursor: number): Promise<{ turns: TranscriptTurn[]; nextCursor: number }> {
    void cursor;
    return { turns: [], nextCursor: 0 };
  }
  getLog(): string[] {
    return this.log;
  }
}

/**
 * Loop de uma chamada (software): a cada ~5s lê a transcrição nova → manda os
 * turnos de Abner pra sessão da Luna → pega o texto de resposta → relay pro
 * Operador. `processTurn` é a função da Luna (prompt → texto do operador).
 */
export async function voiceCallLoop(
  bridge: VoiceBridge,
  processTurn: (turns: TranscriptTurn[]) => Promise<string>,
  opts: { pollMs?: number; maxRounds?: number; now?: () => number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 5_000;
  const maxRounds = opts.maxRounds ?? 1_000;
  let cursor = 0;
  for (let round = 0; round < maxRounds; round++) {
    const { turns, nextCursor } = await bridge.readTranscript(cursor);
    cursor = nextCursor;
    const abnerTurns = turns.filter((t) => !/operador|chatgpt|luna/i.test(t.speaker));
    if (abnerTurns.length > 0) {
      const text = await processTurn(abnerTurns);
      if (text.trim()) await bridge.relay(text);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
