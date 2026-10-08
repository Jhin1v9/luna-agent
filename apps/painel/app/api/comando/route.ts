import { NextResponse } from 'next/server';
import { getComando, criarOrdem } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json(await getComando()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 }); }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const r = await criarOrdem(String(b.ordem ?? ''), b.contexto ? String(b.contexto) : undefined);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
