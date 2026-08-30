import { z } from 'zod';
import {
  asNumber,
  headerKey,
  IMPORT_CSV_MAX_BYTES,
  IMPORT_CSV_MAX_ROWS,
  readCsvRecords,
  type CsvLineError,
} from '@/lib/import/csv';

// ============================================================
// Health (wellness) CSV import parser - pure, no DB
// ============================================================
// Parses the healthexport / "salute" spreadsheet format that the personal
// import flow relies on: one row per weigh-in/reading with
// data | ora | peso_kg | passi | sonno_ore | hr_media_bpm | fonte.
//
// Mirrors lib/import/gymcoach-csv.ts and the other parsers: the file content
// is UNTRUSTED user data - no eval, the same hard size and row caps, every
// value Zod-validated before it leaves this module. Bad lines become per-line
// errors; only an unrecognized header or a blown cap is fatal.
//
// Output split:
// - weightRows: each row with a valid peso_kg becomes one BodyweightEntry
//   (measuredAt = data + ora; ora optional -> midday UTC, like the GymCoach
//   parser's noon fallback). Weight is always kg (the skill's contract).
// - days: per-date daily wellness (steps, sleepHours, avgHr) merged with
//   last-non-null wins when the same day repeats; these feed WellnessEntry.
// - sources: per-date free-text source (fonte), stored as-is.

export const HEALTH_CSV_MAX_BYTES = IMPORT_CSV_MAX_BYTES;
export const HEALTH_CSV_MAX_ROWS = IMPORT_CSV_MAX_ROWS;

export const HEALTH_WEIGHT_MIN = 20;
export const HEALTH_WEIGHT_MAX = 300;
export const HEALTH_STEPS_MAX = 200000;
export const HEALTH_SLEEP_MAX = 24;
export const HEALTH_AVG_HR_MIN = 30;
export const HEALTH_AVG_HR_MAX = 220;

// One BodyweightEntry to create.
export interface HealthWeightRow {
  dateKey: string;
  measuredAtIso: string;
  weightKg: number;
}

// Daily wellness metrics for a single calendar day.
export interface HealthDailyWellness {
  steps: number | null;
  sleepHours: number | null;
  avgHr: number | null;
}

export interface HealthCsvParseResult {
  ok: boolean;
  fatalError: string | null;
  weightRows: HealthWeightRow[];
  // dateKey -> merged daily metrics (only days with at least one metric).
  days: Record<string, HealthDailyWellness>;
  // dateKey -> source label (may be null when the column is absent/empty).
  sources: Record<string, string | null>;
  errors: CsvLineError[];
}

// Bounds mirror lib/schemas/bodyweight.ts for weight (20-300 kg, kg unit) and
// sensible physiological windows for the daily metrics.
const weightSchema = z.object({
  weightKg: z.number().min(HEALTH_WEIGHT_MIN).max(HEALTH_WEIGHT_MAX),
});

const dailySchema = z.object({
  steps: z.number().int().min(0).max(HEALTH_STEPS_MAX).nullable(),
  sleepHours: z.number().min(0).max(HEALTH_SLEEP_MAX).nullable(),
  avgHr: z.number().int().min(HEALTH_AVG_HR_MIN).max(HEALTH_AVG_HR_MAX).nullable(),
});

interface HeaderMap {
  data: number;
  ora: number | null;
  pesoKg: number;
  passi: number | null;
  sonnoOre: number | null;
  hrMediaBpm: number | null;
  fonte: number | null;
}

function mapHeader(cells: string[]): HeaderMap | null {
  const keys = cells.map(headerKey);
  const find = (name: string) => {
    const idx = keys.indexOf(name);
    return idx === -1 ? null : idx;
  };

  const data = find('data');
  const pesoKg = find('peso_kg');
  if (data === null || pesoKg === null) return null;
  return {
    data,
    ora: find('ora'),
    pesoKg,
    passi: find('passi'),
    sonnoOre: find('sonno_ore'),
    hrMediaBpm: find('hr_media_bpm'),
    fonte: find('fonte'),
  };
}

// Accept the canonical YYYY-MM-DD and the European DD/MM/YYYY. Returns the
// dateKey or null when the cell is not a real calendar date.
function toDateKey(cell: string): string | null {
  const trimmed = cell.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/.exec(trimmed);
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (
      date.getUTCFullYear() === Number(y) &&
      date.getUTCMonth() === Number(mo) - 1 &&
      date.getUTCDate() === Number(d)
    ) {
      return `${y}-${mo}-${d}`;
    }
    return null;
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (m) {
    const [, d, mo, y] = m;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (
      date.getUTCFullYear() === Number(y) &&
      date.getUTCMonth() === Number(mo) - 1 &&
      date.getUTCDate() === Number(d)
    ) {
      return `${y}-${mo}-${d}`;
    }
  }
  return null;
}

// 'HH:MM' (24h, optional seconds). Returns a full UTC ISO instant anchored to
// dateKey, or null when ora is absent/empty. A missing ora degrades to midday
// UTC, matching the GymCoach parser's noon fallback so weight order within a
// day stays deterministic (latest ora wins for the current-value sync).
function toMeasuredAtIso(dateKey: string, ora: string | undefined): string {
  const o = (ora ?? '').trim();
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(o);
  if (m) {
    const [, hh, mm, ss] = m;
    const h = Number(hh);
    const mi = Number(mm);
    const s = ss === undefined ? 0 : Number(ss);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59) {
      return `${dateKey}T${hh}:${mm}:${(s < 10 ? '0' : '') + s}.000Z`;
    }
  }
  return `${dateKey}T12:00:00.000Z`;
}

function asOptionalNumber(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  const n = asNumber(cell);
  return Number.isFinite(n) ? n : NaN;
}

const firstIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row.';
};

// Parse a healthexport health CSV. Weight is already kg (the skill's contract),
// so there is no unit toggle.
export function parseHealthCsv(text: string): HealthCsvParseResult {
  const fail = (fatalError: string): HealthCsvParseResult => ({
    ok: false,
    fatalError,
    weightRows: [],
    days: {},
    sources: {},
    errors: [],
  });

  if (text.length > HEALTH_CSV_MAX_BYTES) {
    return fail('File too large: the limit is 5 MB.');
  }

  const records = readCsvRecords(text.replace(/^\uFEFF/, ''));
  const header = records[0];
  if (!header) return fail('Empty file.');
  const map = mapHeader(header.fields);
  if (!map) {
    return fail(
      'Unrecognized format: expected a healthexport/health CSV with the columns ' +
        'data, peso_kg (plus optional ora, passi, sonno_ore, hr_media_bpm, fonte).',
    );
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > HEALTH_CSV_MAX_ROWS) {
    return fail(
      `Too many rows: ${dataRecords.length} (the limit is ${HEALTH_CSV_MAX_ROWS}). Split the export and import in parts.`,
    );
  }

  const weightRows: HealthWeightRow[] = [];
  const days: Record<string, HealthDailyWellness> = {};
  const sources: Record<string, string | null> = {};
  const errors: CsvLineError[] = [];

  for (const record of dataRecords) {
    const get = (idx: number | null) =>
      idx === null ? undefined : record.fields[idx];

    const dateKey = toDateKey(get(map.data) ?? '');
    if (!dateKey) {
      errors.push({ line: record.line, reason: 'Invalid or missing data (expected a date).' });
      continue;
    }

    const weightRaw = asOptionalNumber(get(map.pesoKg));
    const weightOk = weightRaw !== null && !Number.isNaN(weightRaw);
    let parsedWeightKg = 0;
    if (weightRaw !== null && Number.isNaN(weightRaw)) {
      errors.push({ line: record.line, reason: 'peso_kg: not a number.' });
      continue;
    }
    if (weightRaw !== null) {
      const parsed = weightSchema.safeParse({ weightKg: weightRaw });
      if (!parsed.success) {
        errors.push({
          line: record.line,
          reason: `peso_kg: ${firstIssue(parsed.error)}`,
        });
        continue;
      }
      parsedWeightKg = parsed.data.weightKg;
    }

    const steps = asOptionalNumber(get(map.passi));
    const sleepHours = asOptionalNumber(get(map.sonnoOre));
    const avgHr = asOptionalNumber(get(map.hrMediaBpm));

    const daily = dailySchema.safeParse({ steps, sleepHours, avgHr });
    if (!daily.success) {
      errors.push({
        line: record.line,
        reason: firstIssue(daily.error),
      });
      continue;
    }

    if (weightOk) {
      weightRows.push({
        dateKey,
        measuredAtIso: toMeasuredAtIso(dateKey, get(map.ora)),
        weightKg: parsedWeightKg,
      });
    }

    const hasDaily =
      daily.data.steps !== null || daily.data.sleepHours !== null || daily.data.avgHr !== null;
    if (hasDaily) {
      const prev = days[dateKey] ?? { steps: null, sleepHours: null, avgHr: null };
      days[dateKey] = {
        steps: daily.data.steps ?? prev.steps,
        sleepHours: daily.data.sleepHours ?? prev.sleepHours,
        avgHr: daily.data.avgHr ?? prev.avgHr,
      };
    }

    const fonte = get(map.fonte)?.trim() || null;
    if (hasDaily || weightOk) {
      if (fonte !== null && !(dateKey in sources)) {
        sources[dateKey] = fonte.slice(0, 200);
      }
    }

    if (!weightOk && !hasDaily) {
      errors.push({ line: record.line, reason: 'No usable data on this row.' });
    }
  }

  return { ok: true, fatalError: null, weightRows, days, sources, errors };
}
