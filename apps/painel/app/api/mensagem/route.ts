import { NextResponse } from 'next/server';
import { sendMessage } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const r = await sendMessage({ chat_id: String(b.chat_id ?? ''), body: String(b.body ?? ''), sender: String(b.sender ?? 'luna') });
    if (!r.ok) return NextResponse.json(r, { status: r.blocked ? 422 : 400 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
