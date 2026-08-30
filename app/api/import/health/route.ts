import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { healthImportInputSchema } from '@/lib/schemas/health-import';
import { HEALTH_CSV_MAX_BYTES, parseHealthCsv } from '@/lib/import/health-csv';
import { currentBodyweightFromEntries } from '@/lib/bodyweight';

// How many per-line errors the response reports (the count is always exact).
const MAX_REPORTED_ERRORS = 50;

// POST /api/import/health: import a healthexport / "salute" health CSV (the
// personal wellness flow). Mirrors the other import routes: mode=preview
// parses and plans without writing; mode=confirm performs the import inside
// one transaction, rolling back on any failure. Weight maps to the existing
// BodyweightEntry history (and re-syncs User.bodyweight, exactly like POST
// /api/bodyweight); steps/sleep/HR map to the daily WellnessEntry rows, one
// row per day. The file content is untrusted: hard caps, Zod on every value
// (in the parser and on the body), and no write outside the transaction.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();

    // Shared budget with the other import routes: one allowance per user.
    const rl = rateLimit(`import:${userId}`, 10, 60_000);
    if (!rl.ok) {
      throw new ApiError(429, `Too many import requests. Retry in ${rl.retryAfterSec}s.`);
    }

    // Cheap early reject on a declared oversize. The header is advisory only
    // (absent on chunked bodies, possibly malformed); the real control is the
    // streamed byte cap inside parseJsonBody below.
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > HEALTH_CSV_MAX_BYTES * 1.5) {
      throw new ApiError(413, 'File too large: the limit is 5 MB.');
    }

    const data = await parseJsonBody(req, healthImportInputSchema, {
      maxBytes: HEALTH_CSV_MAX_BYTES * 1.5,
    });
    const parsed = parseHealthCsv(data.csv);
    if (!parsed.ok) {
      throw new ApiError(400, parsed.fatalError ?? 'Unreadable file.');
    }

    const dateKeys = [
      ...new Set([
        ...parsed.weightRows.map((r) => r.dateKey),
        ...Object.keys(parsed.days),
      ]),
    ].sort();

    // Existing data on the imported dates, to skip exact duplicates on
    // re-import. Weight has no unique constraint, so skip rows whose
    // (measuredAt, weightKg) already exist; WellnessEntry is unique per
    // (userId, date), so a day already present is not re-written.
    let existingWeight = new Set<string>();
    const existingWellnessDays = new Set<string>();
    if (dateKeys.length > 0) {
      const rangeStart = new Date(`${dateKeys[0]}T00:00:00.000Z`);
      const rangeEnd = new Date(`${dateKeys[dateKeys.length - 1]}T00:00:00.000Z`);
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
      const [weightRows, wellness] = await Promise.all([
        db.bodyweightEntry.findMany({
          where: { userId, measuredAt: { gte: rangeStart, lt: rangeEnd } },
          select: { measuredAt: true, weightKg: true },
        }),
        db.wellnessEntry.findMany({
          where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
          select: { date: true },
        }),
      ]);
      existingWeight = new Set(
        weightRows.map((r) => `${r.measuredAt.toISOString()}|${r.weightKg}`),
      );
      for (const w of wellness) {
        existingWellnessDays.add(w.date.toISOString().slice(0, 10));
      }
    }

    let weightToCreate = 0;
    let weightDuplicates = 0;
    if (dateKeys.length > 0) {
      for (const row of parsed.weightRows) {
        const key = `${row.measuredAtIso}|${row.weightKg}`;
        if (existingWeight.has(key)) weightDuplicates++;
        else weightToCreate++;
      }
    }

    const wellnessDays = Object.keys(parsed.days).filter((d) => !existingWellnessDays.has(d));
    const wellnessToCreate = wellnessDays.length;

    const common = {
      errorCount: parsed.errors.length,
      errors: parsed.errors.slice(0, MAX_REPORTED_ERRORS),
    };

    if (data.mode === 'preview') {
      return NextResponse.json({
        mode: 'preview',
        weight: { toCreate: weightToCreate, duplicatesSkipped: weightDuplicates },
        wellnessDays: wellnessToCreate,
        ...common,
      });
    }

    if (weightToCreate === 0 && wellnessToCreate === 0) {
      throw new ApiError(400, 'Nothing to import: no valid, non-duplicate entry found.');
    }

    // One transaction per import: a failure anywhere rolls back every row.
    const result = await db.$transaction(
      async (tx) => {
        let createdWeight = 0;
        for (const row of parsed.weightRows) {
          const key = `${row.measuredAtIso}|${row.weightKg}`;
          if (existingWeight.has(key)) continue;
          await tx.bodyweightEntry.create({
            data: {
              userId,
              weightKg: row.weightKg,
              measuredAt: new Date(row.measuredAtIso),
              note: 'Imported from healthexport',
            },
          });
          createdWeight++;
        }

        let createdWellness = 0;
        for (const day of wellnessDays) {
          const m = parsed.days[day]!;
          await tx.wellnessEntry.create({
            data: {
              userId,
              date: new Date(`${day}T00:00:00.000Z`),
              steps: m.steps,
              sleepHours: m.sleepHours,
              avgHr: m.avgHr,
              source: parsed.sources[day] ?? null,
            },
          });
          createdWellness++;
        }

        // Re-sync User.bodyweight to the newest measurement, mirroring the
        // bodyweight POST route (lock the user row so concurrent mutations
        // serialize).
        if (createdWeight > 0) {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
          const entries = await tx.bodyweightEntry.findMany({
            where: { userId },
            orderBy: [{ measuredAt: 'asc' }, { id: 'asc' }],
            select: { weightKg: true, measuredAt: true },
          });
          const current = currentBodyweightFromEntries(entries);
          if (current !== null) {
            await tx.user.update({
              where: { id: userId },
              data: { bodyweight: current },
            });
          }
        }

        return { createdWeight, createdWellness };
      },
      { timeout: 60_000, maxWait: 5_000 },
    );

    return NextResponse.json({
      mode: 'confirm',
      weight: { created: result.createdWeight, duplicatesSkipped: weightDuplicates },
      wellnessDays: result.createdWellness,
      ...common,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
