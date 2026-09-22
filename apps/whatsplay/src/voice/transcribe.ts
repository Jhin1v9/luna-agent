import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

/**
 * Camada simples PRIMEIRO (§26): áudio do WhatsApp → transcrição → pipeline
 * normal de mensagem. Whisper LOCAL (grátis, no inventário do owner) via CLI;
 * sem CLI e sem WHISPER_API_KEY → falha explícita (nunca transcrição fake).
 */

const execFileP = promisify(execFile);

export interface Transcriber {
  transcribe(audioPath: string): Promise<string>;
}

export class WhisperUnavailable extends Error {
  constructor() {
    super(
      'Transcrição indisponível: whisper CLI não encontrado no PATH e WHISPER_API_KEY ausente. ' +
        'Instale o whisper local (pip install openai-whisper) ou configure WHISPER_API_KEY.',
    );
    this.name = 'WhisperUnavailable';
  }
}

/** Whisper local via CLI (whisper arquivo.ogg --model tiny --output_format txt). */
export class LocalWhisper implements Transcriber {
  constructor(private readonly whisperBin = 'whisper') {}

  async transcribe(audioPath: string): Promise<string> {
    if (!existsSync(audioPath)) throw new Error(`arquivo de áudio não existe: ${audioPath}`);
    const { stdout } = await execFileP(
      this.whisperBin,
      [audioPath, '--model', 'tiny', '--output_format', 'txt', '--output_dir', 'C:/Users/Abner/.luna/whisper-out'],
      { timeout: 120_000 },
    );
    void stdout;
    const base = audioPath.replace(/\.[^.]+$/, '');
    const txt = `${base}.txt`;
    const { readFileSync } = await import('node:fs');
    return readFileSync(txt, 'utf8').trim();
  }
}

/** Whisper remoto (se o owner configurar key). OpenAI-compatible audio API. */
export class RemoteWhisper implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audioPath: string): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const form = new FormData();
    form.append('file', new Blob([readFileSync(audioPath)]), 'audio.ogg');
    form.append('model', 'whisper-1');
    const res = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`whisper API HTTP ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

/** Resolve o transcriber disponível; null se nenhum (caller decide o fallback). */
export async function resolveTranscriber(env: NodeJS.ProcessEnv): Promise<Transcriber | null> {
  if (env.WHISPER_API_KEY) return new RemoteWhisper(env.WHISPER_API_KEY, env.WHISPER_BASE_URL);
  const which = await execFileP('where', ['whisper']).catch(() => null);
  if (which?.stdout.trim()) return new LocalWhisper();
  return null;
}

/** Camada simples: áudio → texto (ou null explícito). */
export async function audioToText(
  audioPath: string,
  transcriber: Transcriber | null,
): Promise<{ text: string } | { text: null; motivo: string }> {
  if (!transcriber) return { text: null, motivo: new WhisperUnavailable().message };
  try {
    const text = await transcriber.transcribe(audioPath);
    if (!text) return { text: null, motivo: 'transcrição vazia' };
    return { text };
  } catch (err) {
    return { text: null, motivo: err instanceof Error ? err.message : String(err) };
  }
}
