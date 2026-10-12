import { NextResponse } from 'next/server';
import { cancelarFilaInbox } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return NextResponse.json(await cancelarFilaInbox());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
