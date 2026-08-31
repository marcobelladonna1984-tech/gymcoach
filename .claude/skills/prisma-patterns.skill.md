# SKILL: Prisma Patterns for GymCoach

## Scope
All DB queries in this project go through `lib/db.ts` (Prisma client).
Every query MUST be scoped to `principal.userId` — never return cross-user data.

## Safe query pattern

```ts
import { db } from '@/lib/db';

// Always filter by userId
const entries = await db.bodyweightEntry.findMany({
  where: { userId: principal.userId },
  orderBy: { measuredAt: 'desc' },
  take: 30,
});
```

## Multi-step writes — use $transaction

```ts
const [session, set] = await db.$transaction([
  db.session.create({ data: { userId: principal.userId, startedAt: new Date() } }),
  db.set.create({ data: { sessionId: '...', exerciseId, setNumber: 1, weight, reps, completedAt: new Date() } }),
]);
```

## Validate ownership before mutation

```ts
// Re-query with userId to confirm ownership before any update/delete
const program = await db.program.findFirst({
  where: { id: programId, userId: principal.userId },
});
if (!program) throw new Error('Program not found or access denied.');
```

## Key model names (exact, case-sensitive)

- `db.user` `db.session` `db.set` `db.exercise`
- `db.program` `db.workout` `db.programExercise`
- `db.bodyweightEntry` `db.bodyMeasurement`
- `db.readinessCheckin` `db.mcpAccessToken` `db.gym`

## Enums (import from `@prisma/client`)

```ts
import { MuscleGroup, EquipmentType, ExerciseCategory, SetAutoregulationMode } from '@prisma/client';
```

## Never do
- `db.user.findMany()` without userId filter
- Raw SQL via `db.$queryRaw` unless absolutely necessary
- Nested writes that skip ownership validation
