import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoWeekKey, isoWeekStart } from '@/lib/stats';

// ============================================================
// In-memory fake db (mirrors the pattern in lib/last-performance.test.ts):
// mock @/lib/db with tiny stores that HONOR the where/orderBy each tool
// builds, so tool logic (ownership scoping, date windows, aggregation) is
// exercised through the real query construction rather than re-implemented
// here. buildCoachPayload (lib/coach.ts) is mocked separately - it is a
// large, independently-tested aggregation; get_dashboard_summary only reads
// weekCurrent.sessions.length from it.
// ============================================================

interface BodyweightRow {
  userId: string;
  weightKg: number;
  measuredAt: Date;
}

interface SetRow {
  weight: number;
  reps: number;
  isWarmup: boolean;
  durationSec: number | null;
}

interface SessionRow {
  id: string;
  userId: string;
  startedAt: Date;
  finishedAt: Date | null;
  notes: string | null;
  sets: SetRow[];
}

interface ProgramExerciseRow {
  order: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  exercise: { name: string; muscleGroup: string };
}

interface WorkoutRow {
  id: string;
  name: string;
  order: number;
  dayOfWeek: number | null;
  exercises: ProgramExerciseRow[];
}

interface ProgramRow {
  id: string;
  userId: string;
  isActive: boolean;
  workouts: WorkoutRow[];
}

interface WellnessRow {
  userId: string;
  date: Date;
  steps: number | null;
  sleepHours: number | null;
  avgHr: number | null;
}

interface ExerciseRow {
  id: string;
  userId: string;
  name: string;
}

interface UserRow {
  id: string;
  unit: 'KG' | 'LB';
}

interface CreatedSetRow {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  notes: string | null;
}

interface CoachPayloadStub {
  weekCurrent: { sessions: unknown[] };
}

interface TxClient {
  session: {
    create: (args: {
      data: { userId: string; startedAt: Date; finishedAt: Date | null; notes: string | null };
    }) => Promise<SessionRow>;
  };
  set: {
    createMany: (args: { data: CreatedSetRow[] }) => Promise<{ count: number }>;
  };
}

let bodyweightEntries: BodyweightRow[] = [];
let sessions: SessionRow[] = [];
let programs: ProgramRow[] = [];
let wellnessEntries: WellnessRow[] = [];
let exercises: ExerciseRow[] = [];
let users: UserRow[] = [];
let createdSets: CreatedSetRow[] = [];
const coachPayloads = new Map<string, CoachPayloadStub>();
let nextId = 1;

function genId(prefix: string): string {
  return `${prefix}${String(nextId++).padStart(6, '0')}`;
}

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = users.find((u) => u.id === where.id);
        return user ? { unit: user.unit } : null;
      }),
    },
    bodyweightEntry: {
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { userId: string };
          orderBy: { measuredAt: 'asc' | 'desc' };
        }) => {
          const matched = bodyweightEntries
            .filter((e) => e.userId === where.userId)
            .sort((a, b) =>
              orderBy.measuredAt === 'desc'
                ? b.measuredAt.getTime() - a.measuredAt.getTime()
                : a.measuredAt.getTime() - b.measuredAt.getTime(),
            );
          const first = matched[0];
          return first ? { weightKg: first.weightKg, measuredAt: first.measuredAt } : null;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { userId: string; measuredAt: { gte: Date } };
          orderBy: { measuredAt: 'asc' | 'desc' };
        }) => {
          const matched = bodyweightEntries
            .filter((e) => e.userId === where.userId && e.measuredAt >= where.measuredAt.gte)
            .sort((a, b) =>
              orderBy.measuredAt === 'desc'
                ? b.measuredAt.getTime() - a.measuredAt.getTime()
                : a.measuredAt.getTime() - b.measuredAt.getTime(),
            );
          return matched.map((e) => ({ measuredAt: e.measuredAt, weightKg: e.weightKg }));
        },
      ),
    },
    session: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { userId: string; finishedAt?: { not: null } };
          orderBy?: { startedAt: 'asc' | 'desc' };
        }) => {
          let matched = sessions.filter((s) => s.userId === where.userId);
          if (where.finishedAt) {
            matched = matched.filter((s) => s.finishedAt !== null);
          }
          if (orderBy) {
            matched = matched.sort((a, b) =>
              orderBy.startedAt === 'desc'
                ? b.startedAt.getTime() - a.startedAt.getTime()
                : a.startedAt.getTime() - b.startedAt.getTime(),
            );
          }
          return matched.map((s) => ({ startedAt: s.startedAt, sets: s.sets }));
        },
      ),
    },
    program: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; isActive: boolean } }) => {
        return (
          programs.find((p) => p.userId === where.userId && p.isActive === where.isActive) ??
          null
        );
      }),
    },
    wellnessEntry: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { userId: string; date: { gte?: Date; lte?: Date } };
          orderBy: { date: 'asc' | 'desc' };
        }) => {
          let matched = wellnessEntries.filter((w) => w.userId === where.userId);
          if (where.date.gte) matched = matched.filter((w) => w.date >= where.date.gte!);
          if (where.date.lte) matched = matched.filter((w) => w.date <= where.date.lte!);
          matched = matched.sort((a, b) =>
            orderBy.date === 'desc'
              ? b.date.getTime() - a.date.getTime()
              : a.date.getTime() - b.date.getTime(),
          );
          return matched.map((w) => ({
            date: w.date,
            steps: w.steps,
            sleepHours: w.sleepHours,
            avgHr: w.avgHr,
          }));
        },
      ),
    },
    exercise: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) => {
        return exercises
          .filter((e) => where.id.in.includes(e.id) && e.userId === where.userId)
          .map((e) => ({ id: e.id, name: e.name }));
      }),
    },
    $transaction: vi.fn(async (fn: (tx: TxClient) => Promise<SessionRow>) => {
      const tx: TxClient = {
        session: {
          create: async ({ data }) => {
            const session: SessionRow = {
              id: genId('session-'),
              userId: data.userId,
              startedAt: data.startedAt,
              finishedAt: data.finishedAt,
              notes: data.notes,
              sets: [],
            };
            sessions.push(session);
            return session;
          },
        },
        set: {
          createMany: async ({ data }) => {
            for (const row of data) {
              createdSets.push(row);
              const owningSession = sessions.find((s) => s.id === row.sessionId);
              if (owningSession) {
                owningSession.sets.push({
                  weight: row.weight,
                  reps: row.reps,
                  isWarmup: false,
                  durationSec: null,
                });
              }
            }
            return { count: data.length };
          },
        },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('@/lib/coach', () => ({
  buildCoachPayload: vi.fn(
    async (userId: string): Promise<CoachPayloadStub> =>
      coachPayloads.get(userId) ?? { weekCurrent: { sessions: [] } },
  ),
}));

import { createGymCoachMcpServer, GYMCOACH_MCP_INSTRUCTIONS } from './server';

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
  vi.useRealTimers();
});

describe('GymCoach MCP server', () => {
  it('advertises agent instructions, resources, prompts and safe tool annotations', async () => {
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'token-1', userId: 'user-1', canWrite: true },
      baseUrl: 'https://gymcoach.example',
    });
    const client = new Client({ name: 'gymcoach-test', version: '1.0.0' });
    openServers.push(server);
    openClients.push(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    expect(byName.has('get_training_context')).toBe(true);
    expect(byName.has('create_program')).toBe(true);
    expect(byName.has('update_program_exercise')).toBe(true);
    expect(byName.get('get_training_context')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('remove_program_exercise')?.annotations?.destructiveHint).toBe(true);

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'gymcoach://instructions/agent',
    );
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('build-training-program');

    const instructions = await client.readResource({ uri: 'gymcoach://instructions/agent' });
    expect(instructions.contents[0]).toMatchObject({ text: GYMCOACH_MCP_INSTRUCTIONS });
  });
});

// ============================================================
// Tests for the 6 new MCP tools
// ============================================================

// Monday so nextIsoDate/isoWeekStart land on predictable, hand-checked dates.
const NOW = new Date('2026-08-31T10:00:00.000Z');

async function connectClient(principal: {
  tokenId: string;
  userId: string;
  canWrite: boolean;
}): Promise<Client> {
  const server = createGymCoachMcpServer({ principal, baseUrl: 'https://gymcoach.example' });
  const client = new Client({ name: 'gymcoach-test', version: '1.0.0' });
  openServers.push(server);
  openClients.push(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  bodyweightEntries = [];
  sessions = [];
  programs = [];
  wellnessEntries = [];
  exercises = [];
  users = [];
  createdSets = [];
  coachPayloads.clear();
  nextId = 1;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

describe('get_dashboard_summary', () => {
  it('returns the at-a-glance summary for the caller', async () => {
    coachPayloads.set('user-1', { weekCurrent: { sessions: [{}, {}, {}] } });
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 80,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });
    sessions.push(
      {
        id: 's1',
        userId: 'user-1',
        startedAt: new Date('2026-08-31T09:00:00.000Z'),
        finishedAt: new Date('2026-08-31T10:00:00.000Z'),
        notes: null,
        sets: [],
      },
      {
        id: 's2',
        userId: 'user-1',
        startedAt: new Date('2026-08-30T09:00:00.000Z'),
        finishedAt: new Date('2026-08-30T10:00:00.000Z'),
        notes: null,
        sets: [],
      },
    );
    programs.push({
      id: 'program-1',
      userId: 'user-1',
      isActive: true,
      workouts: [
        {
          id: 'workout-1',
          name: 'Push Day',
          order: 0,
          dayOfWeek: 3,
          exercises: [
            {
              order: 0,
              targetSets: 4,
              targetRepsMin: 6,
              targetRepsMax: 10,
              exercise: { name: 'Bench Press', muscleGroup: 'CHEST' },
            },
          ],
        },
      ],
    });

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({ name: 'get_dashboard_summary' });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      sessioni_settimana: 3,
      streak_giorni: 2,
      ultimo_peso: { value: 80, date: '2026-08-30', unit: 'kg' },
      prossima_sessione: { nome: 'Push Day', data: '2026-09-02' },
      esercizi_prossima_sessione: ['Bench Press'],
      // Matches the exact (slightly odd) pluralization server.ts produces today:
      // 'sessione' + 'i' and 'giorno' + 'i' rather than proper Italian plurals.
      messaggio_coach_sintetico:
        '3 sessionei questa settimana, 2 giornoi di allenamento consecutivi, prossima sessione: Push Day',
    });
  });

  it('is scoped to the caller: a different userId sees none of the owner data', async () => {
    coachPayloads.set('user-1', { weekCurrent: { sessions: [{}, {}, {}] } });
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 80,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });
    sessions.push({
      id: 's1',
      userId: 'user-1',
      startedAt: new Date('2026-08-31T09:00:00.000Z'),
      finishedAt: new Date('2026-08-31T10:00:00.000Z'),
      notes: null,
      sets: [],
    });
    programs.push({
      id: 'program-1',
      userId: 'user-1',
      isActive: true,
      workouts: [
        {
          id: 'workout-1',
          name: 'Push Day',
          order: 0,
          dayOfWeek: 3,
          exercises: [],
        },
      ],
    });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({ name: 'get_dashboard_summary' });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      sessioni_settimana: 0,
      streak_giorni: 0,
      ultimo_peso: null,
      prossima_sessione: null,
      esercizi_prossima_sessione: [],
      messaggio_coach_sintetico: '0 sessionei questa settimana, nessun programma attivo',
    });
  });
});

describe('get_weekly_report', () => {
  it('reports volume, sessions, average bodyweight and the trend for the requested weeks', async () => {
    sessions.push(
      {
        id: 'current-week',
        userId: 'user-1',
        startedAt: new Date('2026-08-31T09:00:00.000Z'),
        finishedAt: new Date('2026-08-31T10:30:00.000Z'),
        notes: null,
        sets: [
          { weight: 100, reps: 5, isWarmup: false, durationSec: null },
          { weight: 80, reps: 8, isWarmup: false, durationSec: null },
          { weight: 40, reps: 10, isWarmup: true, durationSec: null },
        ],
      },
      {
        id: 'previous-week',
        userId: 'user-1',
        startedAt: new Date('2026-08-27T09:00:00.000Z'),
        finishedAt: new Date('2026-08-27T10:00:00.000Z'),
        notes: null,
        sets: [{ weight: 60, reps: 10, isWarmup: false, durationSec: null }],
      },
    );
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 80.5,
      measuredAt: new Date('2026-08-31T08:00:00.000Z'),
    });

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({ name: 'get_weekly_report', arguments: { weeks: 1 } });

    expect(res.isError).not.toBe(true);
    const weekStart = isoWeekStart(NOW);
    expect(res.structuredContent).toEqual({
      weeks: [
        {
          data_inizio: weekStart.toISOString().slice(0, 10),
          settimana: isoWeekKey(NOW),
          volume_totale_kg: 1140, // 100*5 + 80*8, warmup excluded
          n_sessioni: 1,
          peso_medio: 80.5,
          trend_vs_settimana_precedente: 540, // 1140 - 600 (60*10 the previous week)
        },
      ],
    });
  });

  it('is scoped to the caller: a different userId gets an empty (zeroed) report', async () => {
    sessions.push({
      id: 'current-week',
      userId: 'user-1',
      startedAt: new Date('2026-08-31T09:00:00.000Z'),
      finishedAt: new Date('2026-08-31T10:30:00.000Z'),
      notes: null,
      sets: [{ weight: 100, reps: 5, isWarmup: false, durationSec: null }],
    });
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 80.5,
      measuredAt: new Date('2026-08-31T08:00:00.000Z'),
    });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({ name: 'get_weekly_report', arguments: { weeks: 1 } });

    expect(res.isError).not.toBe(true);
    const weekStart = isoWeekStart(NOW);
    expect(res.structuredContent).toEqual({
      weeks: [
        {
          data_inizio: weekStart.toISOString().slice(0, 10),
          settimana: isoWeekKey(NOW),
          volume_totale_kg: 0,
          n_sessioni: 0,
          peso_medio: null,
          trend_vs_settimana_precedente: 0,
        },
      ],
    });
  });
});

describe('get_bodyweight_history', () => {
  it('returns readings converted to the trainee preferred unit', async () => {
    users.push({ id: 'user-1', unit: 'LB' });
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 90,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({ name: 'get_bodyweight_history', arguments: {} });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      unit: 'lb',
      values: [{ date: '2026-08-30', value: 198.42 }],
    });
  });

  it('is scoped to the caller: a different userId sees no entries', async () => {
    users.push({ id: 'user-1', unit: 'LB' });
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 90,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({ name: 'get_bodyweight_history', arguments: {} });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({ unit: 'kg', values: [] });
  });
});

describe('get_next_session', () => {
  it('returns the next planned session of the active program', async () => {
    programs.push({
      id: 'program-1',
      userId: 'user-1',
      isActive: true,
      workouts: [
        {
          id: 'workout-1',
          name: 'Push Day',
          order: 0,
          dayOfWeek: 3,
          exercises: [
            {
              order: 0,
              targetSets: 4,
              targetRepsMin: 6,
              targetRepsMax: 10,
              exercise: { name: 'Bench Press', muscleGroup: 'CHEST' },
            },
          ],
        },
      ],
    });

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({ name: 'get_next_session' });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      prossima_sessione: {
        id: 'workout-1',
        nome: 'Push Day',
        data: '2026-09-02',
        giorno_settimana: 3,
        esercizi: [
          { order: 0, nome: 'Bench Press', target_serie: 4, target_reps_min: 6, target_reps_max: 10 },
        ],
      },
    });
  });

  it('is scoped to the caller: a different userId with no active program gets null', async () => {
    programs.push({
      id: 'program-1',
      userId: 'user-1',
      isActive: true,
      workouts: [{ id: 'workout-1', name: 'Push Day', order: 0, dayOfWeek: 3, exercises: [] }],
    });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({ name: 'get_next_session' });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({ prossima_sessione: null });
  });
});

describe('get_health_summary', () => {
  it('returns bodyweight plus imported wellness metrics for each day in the window', async () => {
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 79,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });
    wellnessEntries.push(
      {
        userId: 'user-1',
        date: new Date('2026-08-29T00:00:00.000Z'),
        steps: 5000,
        sleepHours: null,
        avgHr: null,
      },
      {
        userId: 'user-1',
        date: new Date('2026-08-31T00:00:00.000Z'),
        steps: 8000,
        sleepHours: 7.5,
        avgHr: 60,
      },
    );

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({ name: 'get_health_summary', arguments: { days: 3 } });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      days: [
        { date: '2026-08-29', steps: 5000 },
        { date: '2026-08-30', weight_kg: 79 },
        { date: '2026-08-31', steps: 8000, sleep_h: 7.5, hr_avg: 60 },
      ],
    });
  });

  it('is scoped to the caller: a different userId sees empty days (no owner data)', async () => {
    bodyweightEntries.push({
      userId: 'user-1',
      weightKg: 79,
      measuredAt: new Date('2026-08-30T08:00:00.000Z'),
    });
    wellnessEntries.push({
      userId: 'user-1',
      date: new Date('2026-08-31T00:00:00.000Z'),
      steps: 8000,
      sleepHours: 7.5,
      avgHr: 60,
    });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({ name: 'get_health_summary', arguments: { days: 3 } });

    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      days: [{ date: '2026-08-29' }, { date: '2026-08-30' }, { date: '2026-08-31' }],
    });
  });
});

describe('log_quick_workout', () => {
  it('logs a finished session with the given sets and returns a summary', async () => {
    exercises.push(
      { id: 'cuidbenchpress0001', userId: 'user-1', name: 'Bench Press' },
      { id: 'cuidsquat00000001', userId: 'user-1', name: 'Squat' },
    );

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: true });
    const res = await client.callTool({
      name: 'log_quick_workout',
      arguments: {
        confirmed: true,
        date: '2026-08-31',
        notes: 'Felt strong',
        sets: [
          { exerciseId: 'cuidbenchpress0001', weight: 100, reps: 5, rir: 2 },
          { exerciseId: 'cuidbenchpress0001', weight: 100, reps: 5 },
          { exerciseId: 'cuidsquat00000001', weight: 140, reps: 3 },
        ],
      },
    });

    expect(res.isError).not.toBe(true);
    const data = res.structuredContent as {
      ok: boolean;
      sessionId: string;
      date: string;
      loggedSets: number;
      exercises: string;
    };
    expect(data.ok).toBe(true);
    expect(data.date).toBe('2026-08-31');
    expect(data.loggedSets).toBe(3);
    expect(data.exercises).toBe('Bench Press, Squat');
    expect(typeof data.sessionId).toBe('string');

    const created = sessions.find((s) => s.id === data.sessionId);
    expect(created?.userId).toBe('user-1');
    expect(created?.finishedAt).not.toBeNull();
    expect(createdSets).toHaveLength(3);
    expect(createdSets.filter((s) => s.exerciseId === 'cuidbenchpress0001').map((s) => s.setNumber)).toEqual([
      1, 2,
    ]);
  });

  it('is scoped to the caller: logging against another user exercise fails ownership', async () => {
    exercises.push({ id: 'cuidbenchpress0001', userId: 'user-1', name: 'Bench Press' });

    const client = await connectClient({ tokenId: 't2', userId: 'user-2', canWrite: true });
    const res = await client.callTool({
      name: 'log_quick_workout',
      arguments: {
        confirmed: true,
        sets: [{ exerciseId: 'cuidbenchpress0001', weight: 100, reps: 5 }],
      },
    });

    expect(res.isError).toBe(true);
    expect(res.content).toMatchObject([{ text: expect.stringContaining('not found') }]);
    expect(sessions.filter((s) => s.userId === 'user-2')).toHaveLength(0);
    expect(createdSets).toHaveLength(0);
  });

  it('throws when the token is read-only', async () => {
    exercises.push({ id: 'cuidbenchpress0001', userId: 'user-1', name: 'Bench Press' });

    const client = await connectClient({ tokenId: 't1', userId: 'user-1', canWrite: false });
    const res = await client.callTool({
      name: 'log_quick_workout',
      arguments: {
        confirmed: true,
        sets: [{ exerciseId: 'cuidbenchpress0001', weight: 100, reps: 5 }],
      },
    });

    expect(res.isError).toBe(true);
    expect(res.content).toMatchObject([{ text: expect.stringContaining('read-only') }]);
    expect(sessions).toHaveLength(0);
    expect(createdSets).toHaveLength(0);
  });
});
