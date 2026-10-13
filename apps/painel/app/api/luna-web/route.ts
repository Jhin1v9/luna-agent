import { NextResponse } from 'next/server';
import { envAll } from '@/lib/store';
import { getProvidersConfig } from '@/lib/providers';

export const dynamic = 'force-dynamic';

// luna-kernel local — transporte API configurável via .env dele
const KERNEL = 'http://127.0.0.1:3458';

// GET → proxy do status do kernel (timeout 3s; offline = {ok:false, kernelOnline:false})
export async function GET() {
  try {
    const r = await fetch(`${KERNEL}/api/luna-web/providers`, { signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return NextResponse.json({ ok: false, kernelOnline: false, detail: `HTTP ${r.status}` });
    const d = await r.json().catch(() => ({}));
    // o endpoint do kernel já mascara secrets — só repassamos
    return NextResponse.json({ ...(d as object), kernelOnline: true });
  } catch {
    return NextResponse.json({ ok: false, kernelOnline: false });
  }
}

// POST {useLiveConfig, transport, providerId?, model?} → grava envs no .env do kernel
// (server-to-server; a key só transita entre painel e kernel local, nunca volta na resposta)
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const useLiveConfig = Boolean(b?.useLiveConfig);
    const transport = String(b?.transport ?? 'auto');
    if (!['auto', 'api', 'cdp'].includes(transport)) {
      return NextResponse.json({ error: `transport invalido: ${transport}` }, { status: 400 });
    }

    const env: Record<string, string> = {
      LUNA_WEB_USE_AGENT_CONFIG: useLiveConfig ? 'true' : 'false',
      LUNA_TRANSPORT: transport,
    };

    const providerId = b?.providerId ? String(b.providerId) : null;
    if (!useLiveConfig && providerId) {
      // modo manual: provider do config/providers.json da raiz
      const cfg = getProvidersConfig();
      const p = cfg.providers.find((x) => x.id === providerId);
      if (!p) return NextResponse.json({ error: `provider nao encontrado: ${providerId}` }, { status: 400 });
      if (p.transport !== 'openai') return NextResponse.json({ error: 'modo manual so aceita provider transport openai' }, { status: 400 });
      env.LUNA_API_BASE_URL = p.baseUrl;
      env.LUNA_API_MODEL = b?.model ? String(b.model) : p.model;
      if (p.apiKeyEnv) {
        const key = envAll()[p.apiKeyEnv];
        if (!key) return NextResponse.json({ error: `key ${p.apiKeyEnv} ausente no .env` }, { status: 400 });
        env.LUNA_API_KEY = key;
      }
    } else {
      // volta pro modo roda/live: valor vazio = ausente (factory do kernel trata assim)
      env.LUNA_API_BASE_URL = '';
      env.LUNA_API_MODEL = '';
      env.LUNA_API_KEY = '';
    }

    const r = await fetch(`${KERNEL}/api/config`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ ok: false, kernelOnline: true, error: (d as { error?: string }).error ?? `HTTP ${r.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, kernelOnline: true, saved: (d as { saved?: string[] }).saved ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, kernelOnline: false, error: (e as Error).message.slice(0, 140) }, { status: 502 });
  }
}
