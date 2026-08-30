import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireSession();
  const entry = await db.nutritionEntry.findUnique({ where: { id: params.id } });
  if (!entry || entry.userId !== auth.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await db.nutritionEntry.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
}
