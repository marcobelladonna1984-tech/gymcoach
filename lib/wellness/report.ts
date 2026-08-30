// Weekly health report builder (personal wellness import flow).
//
// Fed by the health CSV import: BodyweightEntry rows (weight, per
// measurement) plus WellnessEntry rows (daily steps / sleep / average HR).
// These pure helpers derive the numbers the weekly report quotes, following
// the personal-trainer rules: weight uses the exact recent measurements
// (never the derived scale metrics), and the moving average is over the last
// 3-4 readings rather than a single latest value. Code and identifiers are
// English; only the generated prose ("output") is Italian, because the report
// is a personal, Italian-facing artifact.

export interface BodyweightPoint {
  // YYYY-MM-DD calendar key of the measurement.
  date: string;
  weightKg: number;
}

export interface DailyWellness {
  // YYYY-MM-DD calendar key.
  date: string;
  steps: number | null;
  sleepHours: number | null;
  avgHr: number | null;
}

export interface WeeklyHealthReport {
  reportDate: string;
  health: {
    // Average of the last 3-4 available bodyweight readings (1 decimal).
    weight: { movingAverageKg: number | null; readings: number; enough: boolean };
    // Difference between the current moving average and the moving average of
    // the 3-4 readings immediately before it.
    weightChangeVsPrev: { kg: number | null; enough: boolean };
    // Averaged over the 7 days ending on reportDate (inclusive).
    steps: { days: number; average: number | null };
    sleep: { days: number; average: number | null };
    avgHr: { days: number; average: number | null };
  };
  // Italian prose, ready to show in chat or write to a report file.
  output: string;
}

const MOVING_AVG_READINGS = 4;
const REPORT_WINDOW_DAYS = 7;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Average of the trailing n readings at the end of a sorted (by date,
// then insertion) list.
function trailingAverage(sorted: number[], n: number): number | null {
  const window = sorted.slice(-n);
  return average(window);
}

// Parse a key into a Date at UTC midnight.
function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Inclusive [start, end] date-key range, ascending, capped at 1000 days.
function dayKeys(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  const start = keyToDate(startKey);
  const end = keyToDate(endKey);
  const cursor = new Date(start);
  for (let i = 0; i < 1000; i++) {
    if (cursor.getTime() > end.getTime()) break;
    out.push(toKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function buildWeeklyHealthReport(input: {
  reportDate: string;
  bodyweight: BodyweightPoint[];
  wellness: DailyWellness[];
}): WeeklyHealthReport {
  const { reportDate, bodyweight, wellness } = input;

  // Bodyweight, chronological, deduped to the most recent reading per date
  // (the current value should follow the latest measurement of a day).
  const weightByDate = new Map<string, number>();
  for (const p of bodyweight) weightByDate.set(p.date, p.weightKg);
  const weightSeries = [...weightByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, w]) => w);

  const readings = weightSeries.length;
  const moving = movingAverageKg(weightSeries);
  const change = previousPeriodChange(weightSeries);

  // Wellness averaged over the 7 days ending on reportDate (inclusive).
  const windowStart = new Date(keyToDate(reportDate));
  windowStart.setUTCDate(windowStart.getUTCDate() - (REPORT_WINDOW_DAYS - 1));
  const days = dayKeys(toKey(windowStart), reportDate);
  const byDay = new Map(wellness.map((w) => [w.date, w]));
  const steps: number[] = [];
  const sleep: number[] = [];
  const avgHr: number[] = [];
  for (const d of days) {
    const row = byDay.get(d);
    if (!row) continue;
    if (row.steps !== null) steps.push(row.steps);
    if (row.sleepHours !== null) sleep.push(row.sleepHours);
    if (row.avgHr !== null) avgHr.push(row.avgHr);
  }

  const report: WeeklyHealthReport = {
    reportDate,
    health: {
      weight: {
        movingAverageKg: moving === null ? null : round1(moving),
        readings,
        enough: readings >= 3,
      },
      weightChangeVsPrev: change,
      steps: { days: steps.length, average: round(average(steps)) },
      sleep: { days: sleep.length, average: average(sleep) },
      avgHr: { days: avgHr.length, average: round(average(avgHr)) },
    },
    output: '',
  };

  report.output = renderItalian(report);
  return report;
}

// -- internal helpers, exported for tests -----------------------------------

export function movingAverageKg(sortedWeights: number[]): number | null {
  return trailingAverage(sortedWeights, MOVING_AVG_READINGS);
}

export function previousPeriodChange(sortedWeights: number[]): {
  kg: number | null;
  enough: boolean;
} {
  if (sortedWeights.length < 2 * 3) return { kg: null, enough: false };
  const current = trailingAverage(sortedWeights, MOVING_AVG_READINGS);
  const prev = trailingAverage(sortedWeights.slice(0, -MOVING_AVG_READINGS), MOVING_AVG_READINGS);
  if (current === null || prev === null) return { kg: null, enough: false };
  return { kg: round1(current - prev), enough: true };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function kgText(value: number): string {
  // Italian decimal comma.
  return value.toFixed(1).replace('.', ',');
}

function renderItalian(r: WeeklyHealthReport): string {
  const { health } = r;
  const lines: string[] = [];
  lines.push(`Report settimanale salute - ${r.reportDate}`);
  lines.push("Sono un'intelligenza artificiale, non un medico: questo report descrive i dati, non fa diagnosi.");

  // Weight section.
  const w = health.weight;
  if (w.movingAverageKg !== null && w.enough) {
    const chg = health.weightChangeVsPrev;
    let weightLine = `Media mobile del peso (ultime ${Math.min(w.readings, 4)} rilevazioni): ${kgText(w.movingAverageKg)} kg.`;
    if (chg.enough && chg.kg !== null) {
      const sign = chg.kg > 0 ? '+' : '';
      weightLine += ` Variazione rispetto al periodo precedente: ${sign}${kgText(chg.kg)} kg.`;
    } else {
      weightLine += ' Non ci sono abbastanza rilevazioni precedenti per calcolare la variazione settimanale.';
    }
    lines.push(weightLine);
  } else if (w.movingAverageKg !== null) {
    lines.push(
      `Peso medio delle ${w.readings} rilevazioni disponibili: ${kgText(w.movingAverageKg)} kg (servono almeno 3 rilevazioni per una media mobile affidabile).`,
    );
  } else {
    lines.push('Nessuna rilevazione di peso disponibile nel periodo.');
  }

  // Wellness context.
  const ctx: string[] = [];
  const steps = health.steps;
  const sleep = health.sleep;
  const hr = health.avgHr;
  if (steps.average !== null) ctx.push(`passi medi ${Math.round(steps.average)} su ${steps.days} giorni`);
  if (sleep.average !== null) ctx.push(`sonno medio ${kgText(sleep.average)} ore su ${sleep.days} giorni`);
  if (hr.average !== null) ctx.push(`FC media ${Math.round(hr.average)} bpm su ${hr.days} giorni`);
  if (ctx.length > 0) {
    lines.push(`Contesto della settimana: ${ctx.join(', ')}.`);
  } else {
    lines.push('Nessun dato di passi, sonno o frequenza cardiaca disponibile nel periodo.');
  }

  lines.push('Nota: della bilancia conta solo il peso; le altre metriche bilancia sono derivate dal peso.');

  return lines.join('\n');
}
