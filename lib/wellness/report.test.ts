import { describe, it, expect } from 'vitest';
import { buildWeeklyHealthReport, movingAverageKg, previousPeriodChange } from './report';

describe('movingAverageKg', () => {
  it('averages the last 4 readings', () => {
    expect(movingAverageKg([80, 80.5, 80.2, 80.6, 80.8])).toBeCloseTo(80.525, 3);
  });

  it('returns null when there are no readings', () => {
    expect(movingAverageKg([])).toBeNull();
  });
});

describe('previousPeriodChange', () => {
  it('compares the current window to the previous one when enough readings exist', () => {
    // 8 readings: current = avg(last 4), previous = avg(first 4).
    const change = previousPeriodChange([80, 80.5, 80.4, 80.6, 79.8, 80, 79.6, 79.4]);
    expect(change.enough).toBe(true);
    const current = (79.8 + 80 + 79.6 + 79.4) / 4;
    const prev = (80 + 80.5 + 80.4 + 80.6) / 4;
    expect(change.kg).toBeCloseTo(Math.round((current - prev) * 10) / 10, 3);
  });

  it('reports not enough when fewer than 6 readings exist', () => {
    expect(previousPeriodChange([80, 80.5, 80.4]).enough).toBe(false);
    expect(previousPeriodChange([80, 80.5, 80.4, 80.6, 79.8]).enough).toBe(false);
  });
});

describe('buildWeeklyHealthReport', () => {
  const bodyweight = [
    { date: '2026-05-01', weightKg: 80 },
    { date: '2026-05-03', weightKg: 80.5 },
    { date: '2026-05-05', weightKg: 80.2 },
    { date: '2026-05-07', weightKg: 79.8 },
    { date: '2026-05-08', weightKg: 79.6 },
  ];

  const wellness = [
    { date: '2026-05-04', steps: 8000, sleepHours: 7, avgHr: 60 },
    { date: '2026-05-05', steps: 9500, sleepHours: 7.5, avgHr: 58 },
    { date: '2026-05-06', steps: 7000, sleepHours: null, avgHr: null },
    { date: '2026-05-09', steps: 6000, sleepHours: 6, avgHr: 61 },
  ];

  it('computes the weight moving average and the wellness window', () => {
    const r = buildWeeklyHealthReport({ reportDate: '2026-05-09', bodyweight, wellness });
    expect(r.health.weight.readings).toBe(5);
    expect(r.health.weight.enough).toBe(true);
    const expected = (80.5 + 80.2 + 79.8 + 79.6) / 4;
    expect(r.health.weight.movingAverageKg).toBeCloseTo(Math.round(expected * 10) / 10, 3);

    // 7-day window 2026-05-03..09 -> only days with data count.
    expect(r.health.steps.days).toBe(4); // 05-04, 05-05, 05-06, 05-09
    expect(r.health.avgHr.days).toBe(3); // 05-04, 05-05, 05-09
  });

  it('produces Italian prose that quotes the key figures', () => {
    const r = buildWeeklyHealthReport({ reportDate: '2026-05-09', bodyweight, wellness });
    expect(r.output).toMatch(/Media mobile del peso/);
    expect(r.output).toMatch(/kg/);
    expect(r.output).toMatch(/intelligenza artificiale/i);
  });

  it('reports missing data instead of inventing it', () => {
    const r = buildWeeklyHealthReport({ reportDate: '2026-05-09', bodyweight: [], wellness: [] });
    expect(r.health.weight.movingAverageKg).toBeNull();
    expect(r.health.steps.average).toBeNull();
    expect(r.output).toMatch(/Nessuna rilevazione di peso/);
  });
});
