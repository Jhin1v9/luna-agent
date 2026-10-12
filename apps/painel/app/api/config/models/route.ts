import { NextResponse } from 'next/server';
import { getFccModels } from '@/lib/providers';

export const dynamic = 'force-dynamic';

// GET → { fcc: [...] } — catálogo ao vivo do FCC; falha = lista vazia (não quebra)
export async function GET() {
  const fcc = await getFccModels();
  return NextResponse.json({ fcc });
}
