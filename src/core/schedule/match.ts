import type { ScheduleRow } from '../types.js';
import { normalizeForMatch } from '../worktype/defaults.js';

/** 工種名から「（…）」を除いた基本名。例: 基礎捨石工（投入・均し）→ 基礎捨石工 */
export function baseWorkName(name: string): string {
  const index = name.indexOf('（');
  const halfIndex = name.indexOf('(');
  const cut = index >= 0 ? index : halfIndex;
  return (cut >= 0 ? name.slice(0, cut) : name).trim();
}

/**
 * 工程表の行と工種を対応付ける。
 * 1) 工種コードの一致、2) 工種名の包含（（…）を除いた基本名）の順。
 */
export function matchScheduleRow(
  workTypeCode: string,
  workTypeName: string,
  rows: readonly ScheduleRow[],
): ScheduleRow | undefined {
  const byCode = rows.find((row) => row.code !== '' && row.code === workTypeCode);
  if (byCode) return byCode;

  const base = normalizeForMatch(baseWorkName(workTypeName));
  const full = normalizeForMatch(workTypeName);
  if (!base) return undefined;

  return rows.find((row) => {
    const rowName = normalizeForMatch(row.name);
    if (!rowName) return false;
    return rowName === full || rowName.includes(base) || base.includes(baseWorkName(rowName));
  });
}

export function isMatched(
  workTypeCode: string,
  workTypeName: string,
  rows: readonly ScheduleRow[],
): boolean {
  return matchScheduleRow(workTypeCode, workTypeName, rows) !== undefined;
}
