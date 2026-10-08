import { NextResponse } from 'next/server';
import { getTurnos } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json(await getTurnos()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 }); }
}
