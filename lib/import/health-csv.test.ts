import { describe, it, expect } from 'vitest';
import {
  HEALTH_CSV_MAX_BYTES,
  HEALTH_CSV_MAX_ROWS,
  parseHealthCsv,
} from './health-csv';

const HEADER = 'data,ora,peso_kg,passi,sonno_ore,hr_media_bpm,fonte';

function row(cells: Partial<Record<string, string>> = {}): string {
  const values = {
    data: '2026-05-02',
    ora: '07:30',
    peso_kg: '80.4',
    passi: '9500',
    sonno_ore: '7.5',
    hr_media_bpm: '58',
    fonte: 'renpho',
    ...cells,
  };
  return [values.data, values.ora, values.peso_kg, values.passi, values.sonno_ore, values.hr_media_bpm, values.fonte].join(',');
}

describe('parseHealthCsv - header handling', () => {
  it('accepts the healthexport header (BOM included, any column order)', () => {
    const res = parseHealthCsv('﻿' + [HEADER, row()].join('\n'));
    expect(res.ok).toBe(true);
    expect(res.weightRows).toHaveLength(1);
    expect(Object.keys(res.days)).toHaveLength(1);
    expect(res.errors).toEqual([]);
  });

  it('is case/space-insensitive and tolerates extra columns', () => {
    const shuffled = 'Data,ORA,  peso_kg ,note,passi,hr_media_bpm,sonno_ore';
    // Data row matches the shuffled header order (note is an extra column).
    const dataRow = '2026-05-02,07:30,80.4,a note,9500,58,7.5';
    const res = parseHealthCsv([shuffled, dataRow].join('\n'));
    expect(res.ok).toBe(true);
    expect(res.weightRows).toHaveLength(1);
    expect(res.days['2026-05-02']?.steps).toBe(9500);
  });

  it('rejects a header missing a required column', () => {
    const res = parseHealthCsv('data,ora\n2026-05-02,07:30');
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/unrecognized format/i);
  });

  it('rejects an empty file and enforces the hard caps', () => {
    expect(parseHealthCsv('').ok).toBe(false);

    const big = 'x'.repeat(HEALTH_CSV_MAX_BYTES + 1);
    expect(parseHealthCsv(big).fatalError).toMatch(/too large/i);

    const rows = Array.from({ length: HEALTH_CSV_MAX_ROWS + 1 }, () => row());
    const res = parseHealthCsv([HEADER, ...rows].join('\n'));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/too many rows/i);
  });
});

describe('parseHealthCsv - weight rows', () => {
  it('maps weight with the ora time to a UTC ISO instant', () => {
    const res = parseHealthCsv([HEADER, row()].join('\n'));
    expect(res.weightRows[0]).toEqual({
      dateKey: '2026-05-02',
      measuredAtIso: '2026-05-02T07:30:00.000Z',
      weightKg: 80.4,
    });
  });

  it('falls back to midday UTC when ora is absent', () => {
    const res = parseHealthCsv([HEADER, row({ ora: '' })].join('\n'));
    expect(res.weightRows[0]!.measuredAtIso).toBe('2026-05-02T12:00:00.000Z');
  });

  it('accepts the European DD/MM/YYYY date form', () => {
    const res = parseHealthCsv([HEADER, row({ data: '02/05/2026' })].join('\n'));
    expect(res.weightRows[0]!.dateKey).toBe('2026-05-02');
  });

  it('rejects an out-of-range weight as a per-line error', () => {
    const res = parseHealthCsv([HEADER, row({ peso_kg: '400' })].join('\n'));
    expect(res.ok).toBe(true);
    expect(res.weightRows).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.reason).toMatch(/peso_kg/i);
  });
});

describe('parseHealthCsv - daily wellness', () => {
  it('collects steps, sleep and HR for a day', () => {
    const res = parseHealthCsv([HEADER, row()].join('\n'));
    expect(res.days['2026-05-02']).toEqual({ steps: 9500, sleepHours: 7.5, avgHr: 58 });
    expect(res.sources['2026-05-02']).toBe('renpho');
  });

  it('merges repeated days with last-non-null wins', () => {
    const csv = [HEADER, row({ ora: '07:30', peso_kg: '80.4', passi: '5000', sonno_ore: '', hr_media_bpm: '' }), row({ ora: '22:00', peso_kg: '', passi: '', sonno_ore: '7.5', hr_media_bpm: '58' })].join('\n');
    const res = parseHealthCsv(csv);
    expect(res.weightRows).toHaveLength(1);
    expect(res.days['2026-05-02']).toEqual({ steps: 5000, sleepHours: 7.5, avgHr: 58 });
  });

  it('flags a row with no usable data', () => {
    const res = parseHealthCsv([HEADER, row({ peso_kg: '', passi: '', sonno_ore: '', hr_media_bpm: '' })].join('\n'));
    expect(res.ok).toBe(true);
    expect(res.weightRows).toHaveLength(0);
    expect(Object.keys(res.days)).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.reason).toMatch(/no usable data/i);
  });
});
