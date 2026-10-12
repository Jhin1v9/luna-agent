import { NextResponse } from 'next/server';
import { testProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';

// POST { providerId } → { ok, detail, latencyMs } — detail SEM key (slice 140)
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const providerId = String(b?.providerId ?? '');
    if (!providerId) return NextResponse.json({ error: 'providerId obrigatorio' }, { status: 400 });
    const r = await testProvider(providerId);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
