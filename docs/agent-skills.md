# Agent Skills — GymCoach Quick Reference

This file is for autonomous agents (Claude Code, OpenCode, etc.) working in this repo.
Read it **before** writing any code. It gives you exact names, patterns and constraints
so you do not have to re-derive them from the source.

---

## 1. Stack at a glance

- **Framework**: Next.js 15 App Router, TypeScript strict
- **ORM**: Prisma 6 — client in `lib/prisma-client` (re-exported from `lib/db`)
- **DB**: PostgreSQL 16
- **Package manager**: npm (Node >= 20, use nvm v22.17.1)
- **Gate**: `bash scripts/verify.sh` — MUST be green before every commit

---

## 2. Prisma models — exact names

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id`, `unit` (KG/LB), `bodyweight`, `activeGymId` | One user per deployment |
| `Session` | `id`, `userId`, `programId?`, `workoutId?`, `startedAt`, `finishedAt?`, `notes?`, `gymId?` | A completed or in-progress workout |
| `Set` | `id`, `sessionId`, `exerciseId`, `setNumber`, `weight`, `reps`, `rir?`, `completedAt`, `isWarmup`, `isDropSet` | Weight always in kg |
| `Exercise` | `id`, `userId`, `name`, `muscleGroup`, `category`, `equipmentType`, `usesBodyweight` | Unique on `(userId, name)` |
| `Program` | `id`, `userId`, `name`, `phase`, `isActive`, `workouts[]` | Inactive by default after create |
| `Workout` | `id`, `programId`, `name`, `order`, `dayOfWeek?`, `exercises[]` | Ordered list of ProgramExercise |
| `ProgramExercise` | `id`, `workoutId`, `exerciseId`, `order`, `targetSets`, `targetRepsMin`, `targetRepsMax`, `targetRIR`, `restSec`, `autoregulationMode` | Write tool target |
| `BodyweightEntry` | `id`, `userId`, `weightKg`, `measuredAt` | History; `User.bodyweight` = current |
| `ReadinessCheckin` | `id`, `userId`, `readiness` (1-5), `sleepQuality` (1-5), `soreness` (JSON), `createdAt` | Optional pre-session signal |
| `McpAccessToken` | `id`, `userId`, `tokenHash`, `canWrite`, `revokedAt?` | Never store raw token |
| `BodyMeasurement` | `id`, `userId`, `site` (enum), `valueCm`, `measuredAt` | Tape-measure tracking |
| `Gym` | `id`, `userId`, `name`, `dumbbellWeights[]`, `plateWeights[]`, `barWeights[]` | Equipment inventory |

### Key enums

```ts
MuscleGroup: CHEST | BACK_WIDTH | BACK_THICKNESS | SHOULDERS_FRONT | SHOULDERS_LATERAL
            | SHOULDERS_REAR | BICEPS | TRICEPS | FOREARMS | QUADS | HAMSTRINGS
            | GLUTES | CALVES | ABS | LOWER_BACK | OTHER

EquipmentType: DUMBBELL | BARBELL | MACHINE | CABLE | BODYWEIGHT | CARDIO | OTHER

ExerciseCategory: COMPOUND | ISOLATION | CARDIO

SetAutoregulationMode: PRESERVE_RIR | PRESERVE_REPS
```

---

## 3. MCP server patterns

**Location**: `lib/mcp/server.ts`

### Mandatory imports already present

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { buildCoachPayload } from '@/lib/coach';
import type { McpPrincipal } from '@/lib/mcp/auth';
```

### result() helper (already defined — reuse, never recreate)

```ts
function result(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}
```

### requireWrite() guard (already defined — call on every write tool)

```ts
function requireWrite(principal: McpPrincipal) {
  if (!principal.canWrite) {
    throw new Error('This GymCoach MCP token is read-only.');
  }
}
```

### explicitConfirmation (already defined — required on all write tools)

```ts
const explicitConfirmation = z
  .literal(true)
  .describe('Set to true only after the trainee explicitly confirmed this saved-data change.');
```

### Tool registration template

```ts
server.registerTool(
  'tool_name',
  {
    title: 'Human readable title',
    description: 'What this tool does. One paragraph.',
    inputSchema: { /* Zod shape */ },           // omit if no input
    annotations: {
      readOnlyHint: true,      // false for write tools
      destructiveHint: false,  // true only for delete operations
      idempotentHint: true,    // false for create operations
      openWorldHint: false,    // always false (closed user dataset)
    },
  },
  async ({ /* destructured inputs */ }) => {
    // read tools: query db, return result()
    // write tools: requireWrite(principal), query, return result()
  },
);
```

### Auth: how principal is scoped

```ts
// principal is always available from ServerOptions closure — never pass it explicitly
principal.userId   // string — always present
principal.canWrite // boolean — check with requireWrite() before mutations
```

---

## 4. Key library helpers

| Helper | Location | What it returns |
|---|---|---|
| `buildCoachPayload(userId)` | `lib/coach.ts` | Full coach context: recent sessions, PRs, fatigue, readiness, active program |
| `db` | `lib/db.ts` | Prisma client instance — use directly |
| `getOwnedProgram(userId, programId?)` | `lib/mcp/server.ts` | Validates ownership, returns programId; omit programId to get active one |
| `lib/stats/` | `lib/stats/` | Volume, tonnage, e1RM, weekly aggregates — check before writing custom queries |

---

## 5. Writing a new read tool — checklist

- [ ] `readOnlyHint: true`, `openWorldHint: false`
- [ ] Scoped to `principal.userId` in every `db.*` query (no cross-user leaks)
- [ ] Return via `result({ ... })` helper
- [ ] Input validated with Zod (use `.default()` for optional params)
- [ ] No new imports needed for DB/auth (already in scope)

## 6. Writing a new write tool — checklist

- [ ] `readOnlyHint: false`
- [ ] First line of handler: `requireWrite(principal)`
- [ ] Input includes `confirmed: explicitConfirmation`
- [ ] Destructive ops: `destructiveHint: true`
- [ ] Use `db.$transaction` for multi-step writes
- [ ] Validate ownership before mutation (re-query with userId filter)

---

## 7. Branch strategy (multi-agent)

When two agents work simultaneously:

| Agent | Branch | Owns |
|---|---|---|
| Claude Code | `feature/mcp-tools-claude` | `lib/mcp/server.ts` only |
| OpenCode | `feature/mcp-discovery-opencode` | `app/mcp/info/route.ts`, `docs/chatgpt-mcp.md` |

Orchestrator (you, via Perplexity) merges both into `feature/nutrition-posture-kitchen` when green.

**Never commit directly to `main`.**

---

## 8. Commit convention

```
feat(mcp): add get_dashboard_summary tool
fix(mcp): scope bodyweight query to userId
docs(mcp): update client connection guide
```

Format: `type(scope): lowercase description` — no em-dash, no period at end.

---

## 9. Gate command

```bash
bash scripts/verify.sh
```

If red: fix the code, never the test. Never skip the gate.
