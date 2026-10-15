import { NextResponse } from 'next/server';
import {
  getProvidersWithStatus, saveProvidersConfig, setProviderKey,
  removeProvider, addPresetProvider, addCustomProvider,
} from '@/lib/providers';

export const dynamic = 'force-dynamic';

// 2026-10-14: auth opcional por bearer. Se o painel subir com LUNA_API_KEY
// no ambiente, escrita exige Authorization: Bearer <token>. Sem a env, mantém
// o padrão atual (painel bindado em 127.0.0.1). A UI do painel consome GET
// (previews mascarados) — GET continua aberto.
function authorized(req: Request): boolean {
  const expected = process.env.LUNA_API_KEY;
  if (!expected) return true;
  const h = req.headers.get('authorization') || '';
  return h === `Bearer ${expected}`;
}

// GET → ProvidersConfig + keyStatus por provider (presença + preview mascarado)
export async function GET() {
  try {
    return NextResponse.json(await getProvidersWithStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!authorized(req)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const b = await req.json();
    const action = String(b?.action ?? '');

    if (action === 'save') {
      const cfg = saveProvidersConfig(b.config);
      return NextResponse.json({ ok: true, fastBrain: cfg.fastBrain, liveBrain: cfg.liveBrain });
    }

    if (action === 'set-key') {
      const r = setProviderKey(String(b.env ?? ''), String(b.value ?? ''));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true }); // NUNCA retorna o valor da key
    }

    if (action === 'remove-provider') {
      const r = removeProvider(String(b.id ?? ''));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'add-provider') {
      const r = b.custom !== undefined
        ? addCustomProvider(b.custom)
        : addPresetProvider(String(b.presetId ?? ''));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, id: r.id });
    }

    return NextResponse.json({ error: `acao desconhecida: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
