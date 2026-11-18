import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatDateJst, parseDateValue, parseScheduleCsv, scheduleRange } from '../../src/core/schedule/csv';

const samplePath = fileURLToPath(new URL('../../src/web/public/samples/schedule.csv', import.meta.url));

describe('schedule CSV', () => {
  it('parses the sample schedule with BOM and Japanese headers', () => {
    const text = readFileSync(samplePath, 'utf8');
    const schedule = parseScheduleCsv(text, 'schedule.csv');
    expect(schedule.badRows).toEqual([]);
    expect(schedule.rows).toHaveLength(10);
    const first = schedule.rows[0];
    expect(first).toBeDefined();
    expect(first?.code).toBe('010');
    expect(first?.name).toBe('準備工・汚濁防止膜設置');
    expect(first?.start).toBe(Date.UTC(2027, 3, 1));
    // 終了日は「その日を含む」ので翌日 0 時
    expect(first?.end).toBe(Date.UTC(2027, 3, 29));
    expect(formatDateJst(first?.start ?? 0)).toBe('2027/04/01');
    expect(formatDateJst((first?.end ?? 0) - 86_400_000)).toBe('2027/04/28');
    const last = schedule.rows[9];
    expect(last?.code).toBe('090');
    expect(schedule.columns).toEqual({ code: 0, name: 1, start: 2, end: 3 });
  });

  it('detects the header even when only 工種（名） is present', () => {
    const text = '工種,開始日,終了日\n床掘,2027/5/10,2027/7/9\n';
    const schedule = parseScheduleCsv(text);
    expect(schedule.rows).toHaveLength(1);
    expect(schedule.rows[0]?.name).toBe('床掘');
    expect(schedule.rows[0]?.code).toBe('');
  });

  it('falls back to positional columns when there is no header', () => {
    const text = '010,準備工,2027/4/1,2027/4/28\n020,床掘工,2027/5/10,2027/7/9\n';
    const schedule = parseScheduleCsv(text);
    expect(schedule.rows).toHaveLength(2);
    expect(schedule.rows[1]?.code).toBe('020');
    expect(schedule.rows[1]?.name).toBe('床掘工');
  });

  it('reports bad rows and accepts Excel serial dates', () => {
    const text =
      'コード,工種名,開始日,終了日\n010,準備工,2027/4/1,2027/4/28\n020,床掘,2027/5/10,2027/5/1\n030,捨石,abc,2027/9/24\n040,ケーソン,46500,46530\n';
    const schedule = parseScheduleCsv(text);
    expect(schedule.badRows.length).toBe(2);
    expect(schedule.rows).toHaveLength(2);
    expect(schedule.rows[1]?.start).toBe(Date.UTC(1899, 11, 30) + 46_500 * 86_400_000);
  });

  it('parses full-width digits and Japanese era-like formats', () => {
    expect(parseDateValue('２０２７／０４／０１')).toBe(Date.UTC(2027, 3, 1));
    expect(parseDateValue('2027年4月1日')).toBe(Date.UTC(2027, 3, 1));
    expect(parseDateValue('2027-4-1')).toBe(Date.UTC(2027, 3, 1));
    expect(parseDateValue('')).toBeNull();
  });

  it('computes the overall range', () => {
    const schedule = parseScheduleCsv(readFileSync(samplePath, 'utf8'));
    const range = scheduleRange(schedule.rows);
    expect(formatDateJst(range.start)).toBe('2027/04/01');
    expect(formatDateJst(range.end - 86_400_000)).toBe('2028/03/24');
  });
});
