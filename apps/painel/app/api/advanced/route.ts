import { NextResponse } from 'next/server';
import { envAll } from '@/lib/store';
import { getAdvancedConfig, savePrompt, setAccessRole } from '@/lib/advanced';
export const dynamic = 'force-dynamic';
function authorized(req: Request): boolean {
  const expected = process.env.LUNA_API_KEY || envAll().LUNA_API_KEY;
  return Boolean(expected) && req.headers.get('authorization') === `Bearer ${expected}`;
}
export async function GET(req: Request) {
  try { if (!authorized(req)) return NextResponse.json({ error: 'token administrativo ausente ou inválido' }, { status: 401 }); return NextResponse.json(await getAdvancedConfig()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 500 }); }
}
export async function POST(req: Request) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: 'token administrativo ausente ou inválido' }, { status: 401 });
    const body = await req.json();
    if (body.action === 'save-prompt') await savePrompt(String(body.kind), String(body.content ?? ''));
    else if (body.action === 'set-role') await setAccessRole(String(body.id), String(body.role));
    else return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 }); }
}
