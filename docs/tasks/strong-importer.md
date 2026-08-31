# Task: Strong CSV Importer

## Summary

Add an importer that reads a Strong app CSV export and creates the
corresponding GymCoach data (exercises, sessions, sets).

## Strong CSV format

```
Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-01-15,Push Day,3600,Bench Press,1,100,8,,,,,
2024-01-15,Push Day,3600,Bench Press,2,102.5,6,,,,,
2024-01-15,Push Day,3600,Squat,1,140,5,,,,,
```

| CSV field | GymCoach field | Notes |
|---|---|---|
| `Date` | `Session.startedAt` | ISO date |
| `Workout Name` | `Session.notes` | Free text |
| `Duration` | `Session.finishedAt` | startedAt + duration (seconds) |
| `Exercise Name` | `Exercise.name` | Upsert on `(userId, name)` |
| `Set Order` | `Set.setNumber` | |
| `Weight` | `Set.weight` | Always stored kg - detect LB and convert |
| `Reps` | `Set.reps` | |
| `Distance` | `Set.distanceM` | Cardio only |
| `Seconds` | `Set.durationSec` | Cardio only |
| `RPE` | `Set.rir` | RIR = 10 - RPE |

## Implementation plan

### 1. Parser - `lib/import/strong.ts`

- Parse CSV (check if papaparse already in package.json before adding deps)
- Group rows by `(Date, Workout Name)` - one `Session` per group
- Upsert exercises by name (`userId_name` unique constraint)
- Auto-detect LB: if any weight > 200 and `user.unit = KG` - convert (* 0.453592)
- Map RPE to RIR where present (RIR = 10 - RPE)
- Return dry-run preview before writing

### 2. API route - `app/api/import/strong/route.ts`

- `POST` multipart/form-data, field `file` (CSV)
- Auth: existing session auth (`lib/auth`)
- Zod validation: file <= 10MB, mime text/csv
- Step 1 (no `?confirm`): parse and return preview JSON
- Step 2 (`?confirm=true`): write in single `db.$transaction`
- Returns `{ imported: { sessions, exercises, sets } }`

### 3. UI - `app/[locale]/settings/import/page.tsx`

- File picker (CSV only)
- Preview: session count, exercise count, set count, date range
- Confirm button
- Success toast with counts
- Link from Settings page

### 4. Duplicate guard

- Check existing sessions on same `(userId, startedAt)` within +/-5 min
- Show warning in preview, let user skip or overwrite

## Prisma models

- `Session` - `userId`, `startedAt`, `finishedAt?`, `notes?`
- `Set` - `sessionId`, `exerciseId`, `setNumber`, `weight`, `reps`, `rir?`, `durationSec?`, `distanceM?`
- `Exercise` - upsert on `(userId, name)`, defaults: `muscleGroup: OTHER`, `category: COMPOUND`, `equipmentType: OTHER`

## Out of scope (v1)

- Auto-classify muscle group from exercise name (follow-up)
- Import workout templates/programs
- Hevy / other app formats (separate tasks)

## Acceptance criteria

- [ ] Upload real Strong CSV - correct preview counts
- [ ] Confirm - data appears in session history
- [ ] LB conversion correct when `user.unit = KG`
- [ ] RPE to RIR applied where present
- [ ] Duplicate sessions detected and warned
- [ ] `bash scripts/verify.sh` green
- [ ] Unit tests in `lib/import/strong.test.ts`

## Agent assignment

- **Claude Code** - parser (`lib/import/strong.ts`) + API route + unit tests
- **OpenCode** - UI page + settings link
- **Branch**: `feat/strong-importer` (from `feature/nutrition-posture-kitchen`)
