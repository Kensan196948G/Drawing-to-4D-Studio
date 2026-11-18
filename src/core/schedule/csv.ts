import type { BadScheduleRow, ParsedSchedule, ScheduleRow } from '../types.js';

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** RFC4180 相当の最小 CSV パーサ（BOM・引用符・CRLF・タブ区切りに対応）。 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === '\t') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** 工程表CSVを解析する。列名が無い場合は 4 列（コード・名称・開始・終了）とみなす。 */
export function parseScheduleCsv(text: string, sourceName = 'schedule.csv'): ParsedSchedule {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      sourceName,
      rows: [],
      badRows: [{ line: 0, reason: '工程表が空です。', raw: '' }],
      columns: { code: -1, name: 0, start: 1, end: 2 },
    };
  }

  const header = rows[0] ?? [];
  const normalizedHeader = header.map((cell) => cell.normalize('NFKC').trim().toLowerCase());
  const find = (pattern: RegExp) => normalizedHeader.findIndex((cell) => pattern.test(cell));

  let code = find(/コード|code|wbs|番号|^no$/);
  // 「工種コード」を工種名と誤認しないよう、コード列を除外して探す。
  let name = normalizedHeader.findIndex(
    (cell, index) => index !== code && /工種名?|名称|作業|name|task/.test(cell),
  );
  let start = find(/開始|着手|start|begin/);
  let end = find(/終了|完了|end|finish/);
  let dataRows: string[][];
  let lineOffset: number;

  const headerLooksValid = name >= 0 && start >= 0 && end >= 0;
  if (headerLooksValid) {
    dataRows = rows.slice(1);
    lineOffset = 2;
  } else {
    // ヘッダが無い、または列名が想定外: 列数から推定する。
    const width = Math.max(...rows.map((row) => row.length));
    if (width >= 4) {
      code = 0;
      name = 1;
      start = 2;
      end = 3;
    } else if (width === 3) {
      code = -1;
      name = 0;
      start = 1;
      end = 2;
    } else {
      code = -1;
      name = 0;
      start = 1;
      end = 2;
    }
    dataRows = rows;
    lineOffset = 1;
  }

  const parsedRows: ScheduleRow[] = [];
  const badRows: BadScheduleRow[] = [];

  dataRows.forEach((row, index) => {
    const line = index + lineOffset;
    const raw = row.join(',');
    if (row.every((cell) => cell.trim() === '')) return;
    const rowName = (row[name] ?? '').trim();
    if (!rowName) {
      badRows.push({ line, reason: '工種名が空です。', raw });
      return;
    }
    const startMs = parseDateValue(row[start] ?? '');
    const endMs = parseDateValue(row[end] ?? '');
    if (startMs === null) {
      badRows.push({ line, reason: '開始日を読み取れませんでした。', raw });
      return;
    }
    if (endMs === null) {
      badRows.push({ line, reason: '終了日を読み取れませんでした。', raw });
      return;
    }
    if (endMs < startMs) {
      badRows.push({ line, reason: '終了日が開始日より前です。', raw });
      return;
    }
    parsedRows.push({
      code: normalizeCode(code >= 0 ? (row[code] ?? '') : ''),
      name: rowName,
      start: startMs,
      end: endMs + MS_PER_DAY,
    });
  });

  return {
    sourceName,
    rows: parsedRows,
    badRows,
    columns: { code, name, start, end },
  };
}

function normalizeCode(value: string): string {
  const trimmed = value.normalize('NFKC').trim().replace(/^'/, '');
  if (trimmed === '') return '';
  if (/^\d{1,3}$/.test(trimmed)) return trimmed.padStart(3, '0');
  return trimmed;
}

/** 日付文字列を UTC 深夜 0 時の epoch ms に変換する。 */
export function parseDateValue(value: string): number | null {
  const normalized = value.normalize('NFKC').trim();
  if (normalized === '') return null;

  const ymd = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(normalized);
  if (ymd) {
    const year = Number.parseInt(ymd[1] ?? '', 10);
    const month = Number.parseInt(ymd[2] ?? '', 10);
    const day = Number.parseInt(ymd[3] ?? '', 10);
    if (!isValidDate(year, month, day)) return null;
    return Date.UTC(year, month - 1, day);
  }

  const serial = /^\d{5}(?:\.\d+)?$/.exec(normalized);
  if (serial) {
    const days = Math.floor(Number.parseFloat(normalized));
    if (days >= 20_000 && days <= 80_000) return EXCEL_EPOCH + days * MS_PER_DAY;
  }
  return null;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** JST の YYYY/MM/DD 表示。 */
export function formatDateJst(epochMs: number): string {
  const jst = new Date(epochMs + 9 * 3_600_000);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/** JST の YYYY-MM-DD（input[type=date] 用）。 */
export function formatDateInput(epochMs: number): string {
  return formatDateJst(epochMs).replaceAll('/', '-');
}

export function dateFromInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (!isValidDate(year, month, day)) return null;
  return Date.UTC(year, month - 1, day);
}

export function addDays(epochMs: number, days: number): number {
  return epochMs + days * MS_PER_DAY;
}

export function diffDays(from: number, to: number): number {
  return Math.round((to - from) / MS_PER_DAY);
}

export function scheduleRange(rows: ScheduleRow[]): { start: number; end: number } {
  if (rows.length === 0) {
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    return { start: today, end: today + 30 * MS_PER_DAY };
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.start < start) start = row.start;
    if (row.end > end) end = row.end;
  }
  return { start, end };
}
