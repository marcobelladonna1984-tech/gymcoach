import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  isoWeekKey,
  isoWeekStart,
  totalVolume,
} from '@/lib/stats';
import { isCardioSet } from '@/lib/cardio';
import { buildCoachPayload } from '@/lib/coach';
import { buildWeeklyHealthReport } from '@/lib/wellness/report';
import { buildProgramFromGenerated } from '@/lib/program-generation';
import { generatedExerciseSchema, generatedProgramSchema } from '@/lib/schemas/program-generation';
import { programInputSchema } from '@/lib/schemas/program';
import {
  EquipmentType,
  ExerciseCategory,
  MuscleGroup,
  SetAutoregulationMode,
} from '@/lib/prisma-client';
import type { McpPrincipal } from '@/lib/mcp/auth';

export const GYMCOACH_MCP_INSTRUCTIONS = `GymCoach stores the trainee's profile, gyms, equipment, programs, workout history, sets, RIR, goals and recovery signals.

Use read tools before making recommendations. Ground every recommendation in returned GymCoach data and never invent completed sets, available equipment, records or injuries. Respect the active gym's equipment constraints. Use the trainee's language.

Program-writing tools change saved data. Explain the proposed change before calling a write tool. Newly created programs are inactive so the trainee can review them. Activate a program only when the trainee explicitly asks. Never delete or remove a program exercise without explicit confirmation.`;

interface ServerOptions {
  principal: McpPrincipal;
  baseUrl: string;
}

const explicitConfirmation = z
  .literal(true)
  .describe('Set to true only after the trainee explicitly confirmed this saved-data change.');

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function requireWrite(principal: McpPrincipal) {
  if (!principal.canWrite) {
    throw new Error(
      'This GymCoach MCP token is read-only. Create a write-enabled token in Settings.',
    );
  }
}

async function getOwnedProgram(userId: string, programId?: string) {
  const program = programId
    ? await db.program.findFirst({ where: { id: programId, userId }, select: { id: true } })
    : await db.program.findFirst({ where: { userId, isActive: true }, select: { id: true } });
  if (!program) throw new Error(programId ? 'Program not found.' : 'No active program.');
  return program.id;
}

export function createGymCoachMcpServer({ principal, baseUrl }: ServerOptions): McpServer {
  const server = new McpServer(
    {
      name: 'GymCoach',
      version: '1.0.0',
      websiteUrl: baseUrl,
    },
    { instructions: GYMCOACH_MCP_INSTRUCTIONS },
  );

  server.registerResource(
    'gymcoach-agent-instructions',
    'gymcoach://instructions/agent',
    {
      title: 'GymCoach agent instructions',
      description: 'Rules for safely analysing and editing the trainee training data.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'gymcoach://instructions/agent',
          mimeType: 'text/plain',
          text: GYMCOACH_MCP_INSTRUCTIONS,
        },
      ],
    }),
  );

  server.registerPrompt(
    'build-training-program',
    {
      title: 'Build a GymCoach training program',
      description: 'Analyse the trainee context and prepare a structured program for GymCoach.',
      argsSchema: { goal: z.string().trim().min(5).max(2000) },
    },
    async ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Goal: ${goal}\n\nFirst call get_training_context and list_exercises. Design a realistic program that respects the saved gym and equipment. Explain the draft, ask for confirmation, then call create_program.`,
          },
        },
      ],
    }),
  );

  server.registerTool(
    'get_training_context',
    {
      title: 'Get training context',
      description:
        'Returns the trainee profile, recent training, active program, records, goals, fatigue, readiness, conditioning and active gym equipment.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const [coach, user] = await Promise.all([
        buildCoachPayload(principal.userId),
        db.user.findUnique({
          where: { id: principal.userId },
          select: {
            unit: true,
            activeGym: {
              include: {
                exerciseConfigs: {
                  orderBy: { exercise: { name: 'asc' } },
                  include: {
                    exercise: {
                      select: { id: true, name: true, equipmentType: true },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);
      return result({
        instructionsVersion: 1,
        unit: user?.unit ?? 'KG',
        activeGym: user?.activeGym ?? null,
        coach,
      });
    },
  );

  server.registerTool(
    'list_exercises',
    {
      title: 'List exercise catalog',
      description: 'Lists the trainee exercise catalog with stable IDs and equipment categories.',
      inputSchema: {
        search: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(500).default(200),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ search, limit }) => {
      const exercises = await db.exercise.findMany({
        where: {
          userId: principal.userId,
          ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
          usesBodyweight: true,
          defaultRestSec: true,
          notes: true,
        },
      });
      return result({ exercises });
    },
  );

  server.registerTool(
    'list_programs',
    {
      title: 'List training programs',
      description: 'Lists saved programs and their workout counts.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const programs = await db.program.findMany({
        where: { userId: principal.userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          phase: true,
          description: true,
          isActive: true,
          updatedAt: true,
          _count: { select: { workouts: true, sessions: true } },
        },
      });
      return result({ programs });
    },
  );

  server.registerTool(
    'get_program',
    {
      title: 'Get a training program',
      description: 'Returns a complete program with workout, exercise and autoregulation IDs.',
      inputSchema: {
        programId: z.string().cuid().optional().describe('Omit to read the active program.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ programId }) => {
      const id = await getOwnedProgram(principal.userId, programId);
      const program = await db.program.findUnique({
        where: { id },
        include: {
          workouts: {
            orderBy: { order: 'asc' },
            include: {
              exercises: {
                orderBy: { order: 'asc' },
                include: { exercise: true },
              },
            },
          },
        },
      });
      return result({ program });
    },
  );

  server.registerTool(
    'create_program',
    {
      title: 'Create training program',
      description:
        'Creates a complete inactive GymCoach program. Explain the draft and obtain user confirmation before calling.',
      inputSchema: { confirmed: explicitConfirmation, program: generatedProgramSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ program }) => {
      requireWrite(principal);
      const id = await buildProgramFromGenerated(principal.userId, program);
      return result({ ok: true, programId: id, active: false });
    },
  );

  server.registerTool(
    'update_program_metadata',
    {
      title: 'Update program details',
      description: 'Updates a program name, phase and description after user confirmation.',
      inputSchema: {
        confirmed: explicitConfirmation,
        programId: z.string().cuid(),
        values: programInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programId, values }) => {
      requireWrite(principal);
      await getOwnedProgram(principal.userId, programId);
      const program = await db.program.update({
        where: { id: programId },
        data: {
          name: values.name,
          phase: values.phase,
          description: values.description ?? null,
        },
      });
      return result({ ok: true, program });
    },
  );

  server.registerTool(
    'add_program_exercise',
    {
      title: 'Add program exercise',
      description: 'Adds an exercise to an existing workout after user confirmation.',
      inputSchema: {
        confirmed: explicitConfirmation,
        workoutId: z.string().cuid(),
        exercise: generatedExerciseSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workoutId, exercise: input }) => {
      requireWrite(principal);
      const workout = await db.workout.findFirst({
        where: { id: workoutId, program: { userId: principal.userId } },
        select: { id: true },
      });
      if (!workout) throw new Error('Workout not found.');

      const created = await db.$transaction(async (tx) => {
        const exercise = await tx.exercise.upsert({
          where: { userId_name: { userId: principal.userId, name: input.name } },
          update: {},
          create: {
            userId: principal.userId,
            name: input.name,
            muscleGroup: input.muscleGroup,
            category: input.category,
            equipmentType: input.equipmentType ?? 'OTHER',
            defaultRestSec: input.restSec,
          },
        });
        const last = await tx.programExercise.findFirst({
          where: { workoutId },
          orderBy: { order: 'desc' },
          select: { order: true },
        });
        return tx.programExercise.create({
          data: {
            workoutId,
            exerciseId: exercise.id,
            order: (last?.order ?? 0) + 1,
            targetSets: input.targetSets,
            targetRepsMin: input.targetRepsMin,
            targetRepsMax: input.targetRepsMax,
            targetRIR: input.targetRIR,
            restSec: input.restSec,
            autoregulationMode: input.autoregulationMode ?? 'PRESERVE_RIR',
            fatigueRate: input.fatigueRate ?? null,
            loadAdjustmentPct: input.loadAdjustmentPct ?? null,
            supersetGroup: input.supersetGroup ?? null,
            tempo: input.tempo ?? null,
            notes: input.notes ?? null,
          },
          include: { exercise: true },
        });
      });
      return result({ ok: true, programExercise: created });
    },
  );

  server.registerTool(
    'update_program_exercise',
    {
      title: 'Update program exercise',
      description:
        'Changes targets and autoregulation for an existing program exercise after user confirmation.',
      inputSchema: {
        programExerciseId: z.string().cuid(),
        confirmed: explicitConfirmation,
        targetSets: z.number().int().min(1).max(20).optional(),
        targetRepsMin: z.number().int().min(1).max(50).optional(),
        targetRepsMax: z.number().int().min(1).max(50).optional(),
        targetRIR: z.number().int().min(0).max(5).optional(),
        restSec: z.number().int().min(15).max(600).optional(),
        autoregulationMode: z.nativeEnum(SetAutoregulationMode).optional(),
        fatigueRate: z.number().min(0.25).max(2).nullable().optional(),
        loadAdjustmentPct: z.number().min(1).max(5).nullable().optional(),
        supersetGroup: z.number().int().min(1).max(9).nullable().optional(),
        tempo: z.string().trim().max(20).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programExerciseId, confirmed: _confirmed, ...patch }) => {
      requireWrite(principal);
      const current = await db.programExercise.findFirst({
        where: { id: programExerciseId, workout: { program: { userId: principal.userId } } },
      });
      if (!current) throw new Error('Program exercise not found.');

      const min = patch.targetRepsMin ?? current.targetRepsMin;
      const max = patch.targetRepsMax ?? current.targetRepsMax;
      if (max < min)
        throw new Error('targetRepsMax must be greater than or equal to targetRepsMin.');

      const updated = await db.programExercise.update({
        where: { id: programExerciseId },
        data: patch,
        include: { exercise: true },
      });
      return result({ ok: true, programExercise: updated });
    },
  );

  server.registerTool(
    'remove_program_exercise',
    {
      title: 'Remove program exercise',
      description: 'Removes one exercise from a program. Requires explicit user confirmation.',
      inputSchema: { confirmed: explicitConfirmation, programExerciseId: z.string().cuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ programExerciseId }) => {
      requireWrite(principal);
      const current = await db.programExercise.findFirst({
        where: { id: programExerciseId, workout: { program: { userId: principal.userId } } },
        include: { exercise: { select: { name: true } } },
      });
      if (!current) throw new Error('Program exercise not found.');
      await db.programExercise.delete({ where: { id: programExerciseId } });
      return result({ ok: true, removedExercise: current.exercise.name });
    },
  );

  server.registerTool(
    'activate_program',
    {
      title: 'Activate training program',
      description: 'Makes a saved program active. Call only after explicit user confirmation.',
      inputSchema: { confirmed: explicitConfirmation, programId: z.string().cuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programId }) => {
      requireWrite(principal);
      await getOwnedProgram(principal.userId, programId);
      await db.$transaction([
        db.program.updateMany({
          where: { userId: principal.userId, isActive: true, id: { not: programId } },
          data: { isActive: false },
        }),
        db.program.update({ where: { id: programId }, data: { isActive: true } }),
      ]);
      return result({ ok: true, programId, active: true });
    },
  );

  server.registerTool(
    'get_weekly_health_report',
    {
      title: 'Get weekly health report',
      description:
        'Builds the personal weekly health report from imported data: bodyweight (moving average over the last readings and the change vs the previous period) plus daily steps, sleep and average heart rate over the 7 days ending on reportDate. Omit reportDate to default to today.',
      inputSchema: {
        reportDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End of the 7-day window, YYYY-MM-DD. Defaults to today (UTC).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ reportDate }) => {
      const endKey = reportDate ?? new Date().toISOString().slice(0, 10);
      const start = new Date(`${endKey}T00:00:00.000Z`);
      start.setUTCDate(start.getUTCDate() - 30);
      const [bodyweight, wellness] = await Promise.all([
        db.bodyweightEntry.findMany({
          where: { userId: principal.userId, measuredAt: { gte: start } },
          orderBy: { measuredAt: 'asc' },
          select: { measuredAt: true, weightKg: true },
        }),
        db.wellnessEntry.findMany({
          where: { userId: principal.userId, date: { lte: new Date(`${endKey}T00:00:00.000Z`) } },
          orderBy: { date: 'asc' },
        }),
      ]);
      const report = buildWeeklyHealthReport({
        reportDate: endKey,
        bodyweight: bodyweight.map((e) => ({
          date: e.measuredAt.toISOString().slice(0, 10),
          weightKg: e.weightKg,
        })),
        wellness: wellness.map((w) => ({
          date: w.date.toISOString().slice(0, 10),
          steps: w.steps,
          sleepHours: w.sleepHours,
          avgHr: w.avgHr,
        })),
      });
      return result({ health: report.health, output: report.output });
    },
  );

  server.registerTool(
    'get_dashboard_summary',
    {
      title: 'Get dashboard summary',
      description:
        'Returns the at-a-glance dashboard for the trainee: number of sessions in the current week, current training-day streak, latest bodyweight, next planned session (name and date) and a short synthetic coach message.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const [coach, latestWeight, finishedSessions, activeProgram] = await Promise.all([
        buildCoachPayload(principal.userId),
        db.bodyweightEntry.findFirst({
          where: { userId: principal.userId },
          orderBy: { measuredAt: 'desc' },
          select: { weightKg: true, measuredAt: true },
        }),
        db.session.findMany({
          where: { userId: principal.userId, finishedAt: { not: null } },
          select: { startedAt: true },
          orderBy: { startedAt: 'desc' },
        }),
        db.program.findFirst({
          where: { userId: principal.userId, isActive: true },
          include: {
            workouts: {
              orderBy: { order: 'asc' },
              include: { exercises: { orderBy: { order: 'asc' }, select: { exercise: { select: { name: true } } } } },
            },
          },
        }),
      ]);

      const sessioniSettimana = coach.weekCurrent.sessions.length;

      const trainedDays = new Set(
        finishedSessions.map((s) => s.startedAt.toISOString().slice(0, 10)),
      );
      let streakGiorni = 0;
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      const startKey = trainedDays.has(todayKey) ? todayKey : undefined;
      if (!startKey && trainedDays.size === 0) {
        streakGiorni = 0;
      } else {
        const cursor = new Date(`${startKey ?? todayKey}T00:00:00.000Z`);
        if (!startKey) cursor.setUTCDate(cursor.getUTCDate() - 1);
        while (trainedDays.has(cursor.toISOString().slice(0, 10))) {
          streakGiorni += 1;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
      }

      const nextExercises: string[] = [];
      let prossimaSessione: { nome: string; data: string | null } | null = null;
      if (activeProgram && activeProgram.workouts.length > 0) {
        const next = activeProgram.workouts[0]!;
        for (const pe of next.exercises) nextExercises.push(pe.exercise.name);
        prossimaSessione = {
          nome: next.name,
          data: next.dayOfWeek == null ? null : nextIsoDate(next.dayOfWeek),
        };
      }

      const sessioneSettimana = sessioniSettimana;
      const messaggioCoachSintetico = [
        `${sessioneSettimana} sessione${sessioneSettimana === 1 ? '' : 'i'} questa settimana`,
        streakGiorni > 0 ? `, ${streakGiorni} giorno${streakGiorni === 1 ? '' : 'i'} di allenamento consecutivi` : '',
        prossimaSessione ? `, prossima sessione: ${prossimaSessione.nome}` : ', nessun programma attivo',
      ].join('');

      return result({
        sessioni_settimana: sessioneSettimana,
        streak_giorni: streakGiorni,
        ultimo_peso: latestWeight
          ? { value: latestWeight.weightKg, date: latestWeight.measuredAt.toISOString().slice(0, 10), unit: 'kg' }
          : null,
        prossima_sessione: prossimaSessione,
        esercizi_prossima_sessione: nextExercises,
        messaggio_coach_sintetico: messaggioCoachSintetico,
      });
    },
  );

  server.registerTool(
    'get_weekly_report',
    {
      title: 'Get weekly training report',
      description:
        'Returns a training report for the last N ISO weeks (default 1): total volume (kg), number of sessions, average logged bodyweight and the volume trend vs the previous week, for each week.',
      inputSchema: {
        weeks: z.number().int().min(1).max(12).optional().describe('Number of weeks to report (default 1).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ weeks }) => {
      const total = Math.min(Math.max(weeks ?? 1, 1), 12);
      const windowStart = isoWeekStart(new Date());
      windowStart.setUTCDate(windowStart.getUTCDate() - total * 7);

      const [sessions, bodyweight] = await Promise.all([
        db.session.findMany({
          where: { userId: principal.userId, finishedAt: { not: null } },
          select: {
            startedAt: true,
            sets: { select: { weight: true, reps: true, isWarmup: true, durationSec: true } },
          },
        }),
        db.bodyweightEntry.findMany({
          where: { userId: principal.userId, measuredAt: { gte: windowStart } },
          select: { measuredAt: true, weightKg: true },
          orderBy: { measuredAt: 'asc' },
        }),
      ]);

      const weekVolume = new Map<string, number>();
      const weekSessions = new Map<string, number>();
      const weekWeightSum = new Map<string, { sum: number; count: number }>();
      for (const s of sessions) {
        if (s.startedAt < windowStart) continue;
        const key = isoWeekKey(s.startedAt);
        const working = s.sets.filter((set) => !set.isWarmup && !isCardioSet(set));
        weekVolume.set(key, (weekVolume.get(key) ?? 0) + totalVolume(working));
        weekSessions.set(key, (weekSessions.get(key) ?? 0) + 1);
      }
      for (const bw of bodyweight) {
        const key = isoWeekKey(bw.measuredAt);
        const acc = weekWeightSum.get(key) ?? { sum: 0, count: 0 };
        acc.sum += bw.weightKg;
        acc.count += 1;
        weekWeightSum.set(key, acc);
      }

      const weeksOut = [];
      const currentStart = isoWeekStart(new Date());
      for (let i = total - 1; i >= 0; i -= 1) {
        const start = new Date(currentStart);
        start.setUTCDate(start.getUTCDate() - i * 7);
        const key = isoWeekKey(start);
        const prev = new Date(start);
        prev.setUTCDate(prev.getUTCDate() - 7);
        const prevKey = isoWeekKey(prev);
        const volume = weekVolume.get(key) ?? 0;
        const prevVolume = weekVolume.get(prevKey) ?? 0;
        const wt = weekWeightSum.get(key);
        weeksOut.push({
          data_inizio: start.toISOString().slice(0, 10),
          settimana: key,
          volume_totale_kg: Math.round(volume * 100) / 100,
          n_sessioni: weekSessions.get(key) ?? 0,
          peso_medio: wt && wt.count > 0 ? Math.round((wt.sum / wt.count) * 100) / 100 : null,
          trend_vs_settimana_precedente:
            Math.round((volume - prevVolume) * 100) / 100,
        });
      }
      return result({ weeks: weeksOut });
    },
  );

  server.registerTool(
    'get_bodyweight_history',
    {
      title: 'Get bodyweight history',
      description:
        'Returns recent bodyweight readings (default last 30 days, max 365) ordered by date, with the value converted to the trainee preferred unit.',
      inputSchema: {
        days: z.number().int().min(7).max(365).optional().describe('Number of days to look back (default 30).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ days }) => {
      const limit = Math.min(Math.max(days ?? 30, 7), 365);
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - limit);
      const [entries, user] = await Promise.all([
        db.bodyweightEntry.findMany({
          where: { userId: principal.userId, measuredAt: { gte: since } },
          orderBy: { measuredAt: 'asc' },
          select: { measuredAt: true, weightKg: true },
        }),
        db.user.findUnique({ where: { id: principal.userId }, select: { unit: true } }),
      ]);
      const toLb = user?.unit === 'LB';
      return result({
        unit: toLb ? 'lb' : 'kg',
        values: entries.map((e) => ({
          date: e.measuredAt.toISOString().slice(0, 10),
          value: toLb ? Math.round(e.weightKg * 2.20462 * 100) / 100 : e.weightKg,
        })),
      });
    },
  );

  server.registerTool(
    'get_next_session',
    {
      title: 'Get next training session',
      description:
        'Returns the next planned session of the active program: its name and date (from the scheduled weekday) plus the ordered exercise list with target sets and rep range.',
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async () => {
      const program = await db.program.findFirst({
        where: { userId: principal.userId, isActive: true },
        include: {
          workouts: {
            orderBy: { order: 'asc' },
            include: {
              exercises: { orderBy: { order: 'asc' }, include: { exercise: { select: { name: true, muscleGroup: true } } } },
            },
          },
        },
      });
      if (!program || program.workouts.length === 0) {
        return result({ prossima_sessione: null });
      }
      const next = program.workouts[0]!;
      return result({
        prossima_sessione: {
          id: next.id,
          nome: next.name,
          data: next.dayOfWeek == null ? null : nextIsoDate(next.dayOfWeek),
          giorno_settimana: next.dayOfWeek,
          esercizi: next.exercises.map((pe) => ({
            order: pe.order,
            nome: pe.exercise.name,
            target_serie: pe.targetSets,
            target_reps_min: pe.targetRepsMin,
            target_reps_max: pe.targetRepsMax,
          })),
        },
      });
    },
  );

  server.registerTool(
    'log_quick_workout',
    {
      title: 'Log a quick workout',
      description:
        'Logs a finished workout with a flat list of sets, each with its exercise, weight (kg) and reps. Assigns set numbers per exercise and marks the session as completed. Call only after explicit user confirmation.',
      inputSchema: {
        confirmed: explicitConfirmation,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Workout date, YYYY-MM-DD. Defaults to today.'),
        notes: z.string().max(1000).optional().describe('Optional session notes.'),
        sets: z
          .array(
            z.object({
              exerciseId: z.string().cuid(),
              weight: z.number().min(0).describe('Weight in kg.'),
              reps: z.number().int().min(1),
              rir: z.number().int().min(0).max(10).optional().describe('Reps in reserve.'),
              notes: z.string().max(300).optional(),
            }),
          )
          .min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ date, notes, sets }) => {
      requireWrite(principal);
      const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
      const owned = await db.exercise.findMany({
        where: { id: { in: exerciseIds }, userId: principal.userId },
        select: { id: true, name: true },
      });
      if (owned.length !== exerciseIds.length) {
        throw new Error('One or more exercises were not found.');
      }
      const nameById = new Map(owned.map((e) => [e.id, e.name]));
      const day = date ?? new Date().toISOString().slice(0, 10);
      const at = new Date(`${day}T09:00:00.000Z`);
      const counts = new Map<string, number>();
      const created = await db.$transaction(async (tx) => {
        const session = await tx.session.create({
          data: { userId: principal.userId, startedAt: at, finishedAt: at, notes: notes ?? null },
        });
        const rows = sets.map((s) => {
          const n = (counts.get(s.exerciseId) ?? 0) + 1;
          counts.set(s.exerciseId, n);
          return {
            sessionId: session.id,
            exerciseId: s.exerciseId,
            setNumber: n,
            weight: s.weight,
            reps: s.reps,
            rir: s.rir ?? null,
            notes: s.notes ?? null,
          };
        });
        await tx.set.createMany({ data: rows });
        return session;
      });
      const exerciseNames = [...new Set(sets.map((s) => nameById.get(s.exerciseId)))];
      return result({
        ok: true,
        sessionId: created.id,
        date: day,
        loggedSets: sets.length,
        exercises: exerciseNames.join(', '),
      });
    },
  );

  server.registerTool(
    'get_health_summary',
    {
      title: 'Get health summary',
      description:
        'Returns the health summary for the last N days (default 7, max 90): bodyweight plus imported steps, sleep hours and average heart rate for each day where data is available.',
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe('Number of days to look back (default 7).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ days }) => {
      const limit = Math.min(Math.max(days ?? 7, 1), 90);
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - (limit - 1));
      since.setUTCHours(0, 0, 0, 0);
      const [bodyweight, wellness] = await Promise.all([
        db.bodyweightEntry.findMany({
          where: { userId: principal.userId, measuredAt: { gte: since } },
          orderBy: { measuredAt: 'asc' },
          select: { measuredAt: true, weightKg: true },
        }),
        db.wellnessEntry.findMany({
          where: { userId: principal.userId, date: { gte: since } },
          orderBy: { date: 'asc' },
          select: { date: true, steps: true, sleepHours: true, avgHr: true },
        }),
      ]);
      const weightByDay = new Map<string, number>();
      for (const bw of bodyweight) {
        const key = bw.measuredAt.toISOString().slice(0, 10);
        weightByDay.set(key, bw.weightKg);
      }
      const wellnessByDay = new Map<string, { steps: number | null; sleepHours: number | null; avgHr: number | null }>();
      for (const w of wellness) {
        const key = w.date.toISOString().slice(0, 10);
        wellnessByDay.set(key, { steps: w.steps, sleepHours: w.sleepHours, avgHr: w.avgHr });
      }
      const daysOut = [];
      const cursor = new Date(since);
      for (let i = 0; i < limit; i += 1) {
        const key = cursor.toISOString().slice(0, 10);
        const day: { date: string; weight_kg?: number; steps?: number; sleep_h?: number; hr_avg?: number } = { date: key };
        const w = weightByDay.get(key);
        if (w != null) day.weight_kg = w;
        const wh = wellnessByDay.get(key);
        if (wh) {
          if (wh.steps != null) day.steps = wh.steps;
          if (wh.sleepHours != null) day.sleep_h = wh.sleepHours;
          if (wh.avgHr != null) day.hr_avg = wh.avgHr;
        }
        daysOut.push(day);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return result({ days: daysOut });
    },
  );

  return server;
}

function nextIsoDate(dayOfWeek: number): string {
  const now = new Date();
  const todayIso = now.getUTCDay() || 7;
  let diff = (dayOfWeek % 7) - todayIso;
  if (diff < 0) diff += 7;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  return d.toISOString().slice(0, 10);
}

// Exported for schema documentation and future OAuth scopes.
export const MCP_ENUMS = {
  equipmentTypes: Object.values(EquipmentType),
  exerciseCategories: Object.values(ExerciseCategory),
  muscleGroups: Object.values(MuscleGroup),
};

// Canonical list of MCP tool names, kept in sync with registerTool calls above.
// Used by the MCP discovery endpoint (app/mcp/info/route.ts).
export const MCP_TOOL_NAMES = [
  'get_training_context',
  'list_exercises',
  'list_programs',
  'get_program',
  'create_program',
  'update_program_metadata',
  'add_program_exercise',
  'update_program_exercise',
  'remove_program_exercise',
  'activate_program',
  'get_weekly_health_report',
  'get_dashboard_summary',
  'get_weekly_report',
  'get_bodyweight_history',
  'get_next_session',
  'log_quick_workout',
  'get_health_summary',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
