import { describe, it, expect } from 'vitest';
import { EchoBridge, voiceCallLoop, OPERADOR_VOICE_PROMPT, HOLD_TEXT, type TranscriptTurn } from './bridge.js';
import { audioToText, LocalWhisper, RemoteWhisper, type Transcriber } from './transcribe.js';
import { handleIncomingCall, FALLBACK_CALL_TEXT } from './call-handler.js';

describe('F6 voz — sistema a três (§26)', () => {
  it('Operador Voice Prompt contém os pilares do contrato', () => {
    expect(OPERADOR_VOICE_PROMPT).toContain('INTERMEDIÁRIO');
    expect(OPERADOR_VOICE_PROMPT).toContain('EXATAMENTE o que ela mandar');
    expect(OPERADOR_VOICE_PROMPT).toContain('NUNCA invente');
  });

  it('marca de espera padronizada (nunca silêncio morto)', () => {
    expect(HOLD_TEXT).toContain('só um momento');
  });

  it('voiceCallLoop: turnos de Abner → processTurn → relay; operador/luna ignorados', async () => {
    const bridge = new EchoBridge();
    const abner: TranscriptTurn = { speaker: 'Abner', text: 'Luna, como tá o deploy?', at: 't1' };
    const operador: TranscriptTurn = { speaker: 'Operador', text: 'deixa eu ver', at: 't0' };
    let rounds = 0;
    const fake = {
      relay: (t: string) => bridge.relay(t),
      readTranscript: async (_cursor: number) => {
        rounds++;
        if (rounds === 1) return { turns: [operador, abner], nextCursor: 2 };
        return { turns: [], nextCursor: 2 };
      },
    };
    await voiceCallLoop(fake, async (turns) => {
      expect(turns).toEqual([abner]); // operador filtrado
      return 'Resposta da Luna pro operador falar.';
    }, { pollMs: 1, maxRounds: 2 });
    expect(bridge.getLog()).toEqual(['Resposta da Luna pro operador falar.']);
  });

  it('transcribe: sem transcriber → falha explícita (nunca transcrição fake)', async () => {
    const r = await audioToText('/tmp/x.ogg', null);
    expect(r.text).toBeNull();
    if (r.text === null) expect(r.motivo).toContain('WHISPER_API_KEY');
  });

  it('transcribe: transcriber injetado (mock) → texto vira mensagem normal', async () => {
    const mock: Transcriber = { transcribe: async () => 'preciso atualizar o site' };
    const r = await audioToText('/tmp/x.ogg', mock);
    expect(r).toEqual({ text: 'preciso atualizar o site' });
  });

  it('RemoteWhisper: multipart pro endpoint de transcrição', async () => {
    let seen: { url: string; auth?: string } | null = null;
    const w = new RemoteWhisper('sk-test', 'https://api.test/v1', (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), auth: (init?.headers as Record<string, string>).authorization };
      return new Response(JSON.stringify({ text: 'olá do áudio' }), { status: 200 });
    }) as typeof fetch);
    // existeSync vai falhar pro caminho — injeta leitura? RemoteWhisper lê o arquivo;
    // usamos caminho existente temporário
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/fake-audio.ogg', 'RIFF-fake');
    const text = await w.transcribe('/tmp/fake-audio.ogg');
    expect(text).toBe('olá do áudio');
    expect(seen!.url).toBe('https://api.test/v1/audio/transcriptions');
    expect(seen!.auth).toBe('Bearer sk-test');
    fs.unlinkSync('/tmp/fake-audio.ogg');
  });

  it('JANELA DO HUMANO: owner atende/clica durante os 15s → sistema NÃO age (zero accept, zero msg)', async () => {
    let rings = 0;
    let accepted = false;
    const sent: string[] = [];
    const r = await handleIncomingCall({
      detector: {
        hasIncoming: async () => {
          rings++;
          return rings <= 2; // tocou 2 polls, aí o humano atendeu
        },
        accept: async () => {
          accepted = true;
          return true;
        },
        decline: async () => {},
      },
      isCallerAllowed: async () => true,
      callerChatId: 'Pai',
      sendText: async (_c, t) => {
        sent.push(t);
      },
      onAnswered: async () => {},
      timeoutMs: 3_000,
    });
    expect(r).toBe('none');
    expect(accepted).toBe(false);
    expect(sent).toEqual([]);
  });

  it('15s sem ação + caller NO ESCOPO → msg de fallback + recusa (§26, decreto owner; autoAnswerOnTimeout default false)', async () => {
    const sent: string[] = [];
    let declined = false;
    const r = await handleIncomingCall({
      detector: {
        hasIncoming: async () => true,
        accept: async () => false,
        decline: async () => {
          declined = true;
        },
      },
      isCallerAllowed: async () => true,
      callerChatId: '34685093192@s.whatsapp.net',
      sendText: async (_c, t) => {
        sent.push(t);
      },
      onAnswered: async () => {},
      timeoutMs: 2_500,
    });
    expect(r).toBe('fallback');
    expect(sent).toEqual([FALLBACK_CALL_TEXT]);
    expect(declined).toBe(true);
  });

  it('15s sem ação + autoAnswerOnTimeout=true → atende sozinho (VoiceBridge)', async () => {
    let answered = false;
    let bridged = false;
    const r = await handleIncomingCall({
      detector: {
        hasIncoming: async () => true,
        accept: async () => {
          answered = true;
          return true;
        },
        decline: async () => {},
      },
      isCallerAllowed: async () => true,
      callerChatId: 'Pai',
      sendText: async () => {},
      onAnswered: async () => {
        bridged = true;
      },
      autoAnswerOnTimeout: true,
      timeoutMs: 2_500,
    });
    expect(r).toBe('answered');
    expect(answered).toBe(true);
    expect(bridged).toBe(true);
  });

  it('fallback: caller FORA do escopo → decline, ZERO mensagem (decreto owner)', async () => {
    const sent: string[] = [];
    let declined = false;
    const r = await handleIncomingCall({
      detector: {
        hasIncoming: async () => true,
        accept: async () => false,
        decline: async () => {
          declined = true;
        },
      },
      isCallerAllowed: async () => false,
      callerChatId: '+34-estranho',
      sendText: async (_c, t) => {
        sent.push(t);
      },
      onAnswered: async () => {},
      timeoutMs: 10,
    });
    expect(r).toBe('none');
    expect(sent).toEqual([]);
    expect(declined).toBe(true);
  });
});
