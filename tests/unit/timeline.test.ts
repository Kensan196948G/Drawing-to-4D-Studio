import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseScheduleCsv, formatDateJst } from '../../src/core/schedule/csv';
import { matchScheduleRow } from '../../src/core/schedule/match';
import { advanceTimeline, computePartProgress, makeTimeline, progressAt } from '../../src/core/timeline/model';
import type { Part, ScheduleRow } from '../../src/core/types';

const csvPath = fileURLToPath(new URL('../../src/web/public/samples/schedule.csv', import.meta.url));
const rows = parseScheduleCsv(readFileSync(csvPath, 'utf8')).rows;

function row(code: string): ScheduleRow {
  const found = rows.find((item) => item.code === code);
  if (!found) throw new Error(`missing row ${code}`);
  return found;
}

function part(id: string, code: string, ordinal: number, x0: number, x1: number, sequence: Part['sequence']): Part {
  return {
    id,
    layer: `L-${code}`,
    workTypeCode: code,
    points: [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: 1 },
      { x: x0, y: 1 },
    ],
    area: x1 - x0,
    closed: true,
    top: 1,
    bottom: 0,
    sequence,
    ordinal,
  };
}

describe('timeline', () => {
  it('computes progress with inclusive end date', () => {
    const target = row('040');
    expect(progressAt(target, target.start)).toBe(0);
    expect(progressAt(target, target.end)).toBe(1);
    const middle = target.start + (target.end - target.start) / 2;
    expect(progressAt(target, middle)).toBeCloseTo(0.5, 5);
  });

  it('builds a timeline covering the whole schedule', () => {
    const timeline = makeTimeline(rows);
    expect(formatDateJst(timeline.start)).toBe('2027/04/01');
    expect(formatDateJst(timeline.end - 86_400_000)).toBe('2028/03/24');
    expect(timeline.current).toBe(timeline.start);
  });

  it('advances and loops at the end', () => {
    const timeline = makeTimeline(rows);
    const next = advanceTimeline(timeline, 10);
    expect(next).toBe(timeline.start + 10 * 86_400_000);
    const looped = advanceTimeline({ ...timeline, current: timeline.end }, 1);
    expect(looped).toBe(timeline.start);
  });

  it('reveals each-part sequencing in order', () => {
    const parts = [0, 1, 2, 3, 4].map((index) =>
      part(`040:${index}`, '040', index, index * 20, index * 20 + 20, 'each'),
    );
    const target = row('040');
    const middle = target.start + (target.end - target.start) / 2;
    const states = computePartProgress(parts, rows, middle);
    expect(states.filter((state) => state.visible)).toHaveLength(3);
    expect(states[0]?.progress).toBe(1);
    expect(states[4]?.visible).toBe(false);
  });

  it('moves the clip plane for extend sequencing', () => {
    const parts = [part('030:0', '030', 0, 0, 100, 'extend')];
    const target = row('030');
    const middle = target.start + (target.end - target.start) / 2;
    const state = computePartProgress(parts, rows, middle)[0];
    expect(state?.visible).toBe(true);
    expect(state?.clipX).toBeCloseTo(50, 0);
  });

  it('scales stacked parts vertically', () => {
    const parts = [part('050:0', '050', 0, 0, 10, 'stack')];
    const target = row('050');
    const middle = target.start + (target.end - target.start) / 2;
    const state = computePartProgress(parts, rows, middle)[0];
    expect(state?.scaleY).toBeCloseTo(0.5, 5);
  });

  it('matches schedule rows by code and by base name', () => {
    expect(matchScheduleRow('030', '基礎捨石工（投入・均し）', rows)?.code).toBe('030');
    expect(matchScheduleRow('', 'ケーソン据付工（5函）', rows)?.code).toBe('040');
    expect(matchScheduleRow('999', '存在しない工種', rows)).toBeUndefined();
  });

  it('hides parts that have no schedule row', () => {
    const parts = [part('999:0', '999', 0, 0, 10, 'instant')];
    const states = computePartProgress(parts, rows, rows[0]?.start ?? 0);
    expect(states[0]?.visible).toBe(false);
  });
});
