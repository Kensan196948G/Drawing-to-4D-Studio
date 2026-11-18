import type {
  Part,
  PartProgress,
  ScheduleRow,
  TimelineRange,
  WorkType,
} from '../types.js';
import { matchScheduleRow } from '../schedule/match.js';
import { scheduleRange } from '../schedule/csv.js';
import { workTypeByCode } from '../worktype/defaults.js';
import { polygonBounds } from '../geometry/polygon.js';

/** 工程表の範囲からタイムラインを作る。 */
export function makeTimeline(rows: readonly ScheduleRow[], current?: number): TimelineRange {
  const range = scheduleRange([...rows]);
  const start = range.start;
  const end = Math.max(range.end, start + 1);
  return {
    start,
    end,
    current: clamp(current ?? start, start, end),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 行の進捗 0..1（開始前 0、終了後 1）。 */
export function progressAt(row: ScheduleRow, date: number): number {
  if (date <= row.start) return 0;
  if (date >= row.end) return 1;
  const span = row.end - row.start;
  if (span <= 0) return 1;
  return clamp((date - row.start) / span, 0, 1);
}

export interface PartSchedule {
  row?: ScheduleRow;
  progress: number;
}

export function scheduleForPart(part: Part, rows: readonly ScheduleRow[], date: number): PartSchedule {
  const workType = workTypeByCode(part.workTypeCode);
  if (!workType) return { progress: 0 };
  const row = matchScheduleRow(workType.code, workType.name, rows);
  if (!row) return { progress: 0 };
  return { row, progress: progressAt(row, date) };
}

/** 4D表示の各時刻における部材の状態を計算する。 */
export function computePartProgress(
  parts: readonly Part[],
  rows: readonly ScheduleRow[],
  date: number,
): PartProgress[] {
  const groups = new Map<string, Part[]>();
  for (const part of parts) {
    const list = groups.get(part.workTypeCode);
    if (list) list.push(part);
    else groups.set(part.workTypeCode, [part]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.ordinal - b.ordinal);

  const result: PartProgress[] = [];
  for (const part of parts) {
    const workType = workTypeByCode(part.workTypeCode);
    if (!workType) {
      result.push({ partId: part.id, visible: false, progress: 0 });
      continue;
    }
    const row = matchScheduleRow(workType.code, workType.name, rows);
    if (!row) {
      result.push({ partId: part.id, visible: false, progress: 0 });
      continue;
    }
    const progress = progressAt(row, date);
    const state = sequenceState(part, workType, progress, groups.get(part.workTypeCode) ?? [part]);
    result.push({ partId: part.id, ...state });
  }
  return result;
}

function sequenceState(
  part: Part,
  workType: WorkType,
  progress: number,
  group: readonly Part[],
): { visible: boolean; progress: number; clipX?: number; scaleY?: number } {
  switch (workType.sequence) {
    case 'extend': {
      const bounds = polygonBounds(part.points);
      const clipX = bounds.minX + (bounds.maxX - bounds.minX) * progress;
      return { visible: progress > 0, progress, clipX };
    }
    case 'each': {
      const index = Math.max(0, group.findIndex((item) => item.id === part.id));
      const count = Math.max(1, group.length);
      const local = clamp(progress * count - index, 0, 1);
      return { visible: local > 0, progress: local };
    }
    case 'stack':
      return { visible: progress > 0, progress, scaleY: progress };
    case 'instant':
    default:
      return { visible: progress > 0, progress };
  }
}

/** 工種ごとの進捗（ガント表示用）。 */
export function workTypeProgress(
  rows: readonly ScheduleRow[],
  date: number,
): { code: string; name: string; start: number; end: number; progress: number }[] {
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    start: row.start,
    end: row.end,
    progress: progressAt(row, date),
  }));
}

/** タイムラインの現在日を進める（終端でループ）。 */
export function advanceTimeline(timeline: TimelineRange, days: number): number {
  const next = timeline.current + days * 86_400_000;
  if (next > timeline.end) return timeline.start;
  return Math.max(timeline.start, next);
}

/** 未対応の工種（工程表と結べない部材）を数える。 */
export function unmatchedSummary(
  parts: readonly Part[],
  rows: readonly ScheduleRow[],
): { matched: number; total: number; unmatchedCodes: string[] } {
  const codes = new Set(parts.map((part) => part.workTypeCode));
  const unmatched: string[] = [];
  let matched = 0;
  for (const code of codes) {
    const workType = workTypeByCode(code);
    if (!workType) {
      unmatched.push(code);
      continue;
    }
    if (matchScheduleRow(code, workType.name, rows)) matched += 1;
    else unmatched.push(code);
  }
  return { matched, total: codes.size, unmatchedCodes: unmatched };
}
