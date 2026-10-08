import { NextResponse } from 'next/server';
import { getInbox } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json(await getInbox()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 }); }
}
