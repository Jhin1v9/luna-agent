import { NextResponse } from 'next/server';
import { getModo, setEnvKey } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getModo());
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const r = setEnvKey(String(b.key), String(b.value));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
