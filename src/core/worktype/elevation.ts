import type { DxfDrawing, ElevationEntry, ElevationSuggestion, WorkType } from '../types.js';
import { WORK_TYPES, normalizeForMatch } from './defaults.js';

const NOTE_PATTERN =
  /(マウンド天端|基礎捨石天端|天端高|床掘底|底面|法肩|法尻|天端)\s*[:：]?\s*(?:TP|T\.P\.)?\s*([+\-]?\d+(?:\.\d+)?)\s*m?/i;

interface WorkTypeHint {
  pattern: RegExp;
  code: string;
}

const WORK_TYPE_HINTS: readonly WorkTypeHint[] = [
  { pattern: /汚濁|準備工?/, code: '010' },
  { pattern: /床掘|掘削|DREDGE/i, code: '020' },
  { pattern: /捨石|マウンド|MOUND|均し/i, code: '030' },
  { pattern: /ケーソン|CAISSON/i, code: '040' },
  { pattern: /裏込/, code: '045' },
  { pattern: /上部工|コンクリート|CONC/i, code: '050' },
  { pattern: /裏埋|埋立|埋戻/, code: '060' },
  { pattern: /付属|係船柱|防舷材|FENDER|BOLLARD/i, code: '070' },
  { pattern: /エプロン|舗装|PAVEMENT/i, code: '080' },
  { pattern: /片付|完成検査/, code: '090' },
];

export interface ElevationNote {
  id: string;
  source: string;
  label: string;
  value: number;
  kind: 'top' | 'bottom';
  workTypeCode: string | null;
  confidence: number;
}

/** 初期の標高表（工種マスタの初期値）。 */
export function defaultElevations(): ElevationEntry[] {
  return WORK_TYPES.map((workType) => ({
    workTypeCode: workType.code,
    top: workType.defaultTop ?? 0,
    bottom: workType.defaultBottom ?? 0,
    source: 'default',
    sequence: workType.sequence,
    enabled: workType.defaultTop !== null && workType.defaultBottom !== null,
  }));
}

/** 断面図などの文字注記から標高候補を抽出する。 */
export function extractElevationNotes(drawing: DxfDrawing): ElevationNote[] {
  const notes: ElevationNote[] = [];
  const seen = new Set<string>();
  for (const entity of drawing.entities) {
    if (entity.type !== 'text') continue;
    const text = entity.text.normalize('NFKC').trim();
    if (!text || text.length > 60) continue;
    const match = NOTE_PATTERN.exec(text);
    if (!match) continue;
    const label = match[1] ?? '';
    const rawValue = Number.parseFloat((match[2] ?? '').replaceAll('+', ''));
    if (!Number.isFinite(rawValue)) continue;
    const kind: 'top' | 'bottom' = /底面|床掘底|法尻/.test(label) ? 'bottom' : 'top';
    const hint = WORK_TYPE_HINTS.find((item) => item.pattern.test(text));
    const workTypeCode = hint?.code ?? (label === '天端' || label === '天端高' ? '040' : null);
    const id = `note-${notes.length}`;
    if (seen.has(`${workTypeCode}-${kind}-${rawValue}`)) continue;
    seen.add(`${workTypeCode}-${kind}-${rawValue}`);
    notes.push({
      id,
      source: text,
      label,
      value: rawValue,
      kind,
      workTypeCode,
      confidence: workTypeCode ? (hint ? 0.85 : 0.5) : 0.3,
    });
  }
  return notes;
}

/** 注記を標高表へ反映する（最も確からしい注記を優先）。 */
export function applyElevationNotes(
  elevations: readonly ElevationEntry[],
  notes: readonly ElevationNote[],
): { elevations: ElevationEntry[]; applied: ElevationNote[] } {
  const next = elevations.map((entry) => ({ ...entry }));
  const byKey = new Map(next.map((entry) => [entry.workTypeCode, entry]));
  const applied: ElevationNote[] = [];
  const ordered = [...notes].sort((a, b) => b.confidence - a.confidence);

  for (const note of ordered) {
    if (!note.workTypeCode) continue;
    const entry = byKey.get(note.workTypeCode);
    if (!entry) continue;
    if (note.kind === 'top') entry.top = note.value;
    else entry.bottom = note.value;
    entry.source = 'note';
    entry.enabled = true;
    applied.push(note);
  }
  // 上下が逆転した場合は入れ替え（数値入力の取り違えを安全側に倒す）
  for (const entry of next) {
    if (entry.enabled && entry.top < entry.bottom) [entry.top, entry.bottom] = [entry.bottom, entry.top];
  }
  return { elevations: next, applied };
}

/** 標高表の検証。UI と保存前に使う。 */
export function validateElevations(elevations: readonly ElevationEntry[]): string[] {
  const errors: string[] = [];
  for (const entry of elevations) {
    if (!entry.enabled) continue;
    const workType = WORK_TYPES.find((item) => item.code === entry.workTypeCode);
    const label = workType?.name ?? entry.workTypeCode;
    if (!Number.isFinite(entry.top) || !Number.isFinite(entry.bottom)) {
      errors.push(`${label}: 標高が数値ではありません。`);
      continue;
    }
    if (entry.top <= entry.bottom) errors.push(`${label}: 天端は底面より高い必要があります。`);
    else if (entry.top - entry.bottom > 100) errors.push(`${label}: 高低差が 100m を超えています。入力値を確認してください。`);
  }
  return errors;
}

export function suggestionFromNotes(notes: readonly ElevationNote[]): ElevationSuggestion[] {
  const suggestions: ElevationSuggestion[] = [];
  for (const note of notes) {
    if (!note.workTypeCode) continue;
    const workType = WORK_TYPES.find((item) => item.code === note.workTypeCode);
    if (!workType) continue;
    suggestions.push({
      workTypeCode: note.workTypeCode,
      top: note.kind === 'top' ? note.value : (workType.defaultTop ?? 0),
      bottom: note.kind === 'bottom' ? note.value : (workType.defaultBottom ?? 0),
      label: workType.name,
      matchedText: note.source,
      confidence: note.confidence,
    });
  }
  return suggestions;
}

export function elevationFor(
  elevations: readonly ElevationEntry[],
  workTypeCode: string,
): ElevationEntry | undefined {
  return elevations.find((entry) => entry.workTypeCode === workTypeCode);
}

export function workTypeLabel(workType: WorkType): string {
  return `${workType.code} ${workType.name}`;
}

/** 注記の表示用ラベル（全角などを整える）。 */
export function normalizeNoteText(value: string): string {
  return normalizeForMatch(value);
}
