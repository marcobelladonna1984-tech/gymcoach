import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  kcal: z.number().int().min(0).max(10000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(500),
  meal: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT']).default('SNACK'),
  note: z.string().max(500).optional(),
  loggedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, kcal, proteinG, carbsG, fatG, meal, note, loggedAt } = parsed.data;
  const entry = await db.nutritionEntry.create({
    data: {
      userId: auth.userId,
      name,
      kcal,
      proteinG,
      carbsG,
      fatG,
      meal,
      note,
      loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
    },
  });
  return NextResponse.json(entry, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(`${date}T23:59:59.999Z`);
  const entries = await db.nutritionEntry.findMany({
    where: { userId: auth.userId, loggedAt: { gte: from, lte: to } },
    orderBy: { loggedAt: 'asc' },
  });
  return NextResponse.json(entries);
}
