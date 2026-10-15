import { NextResponse } from 'next/server';
import { removeContact } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await removeContact(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
