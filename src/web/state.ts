import type { AppState, Theme } from './types.js';
import { SEED_DICTIONARY, WORK_TYPES } from '../core/worktype/defaults.js';
import { defaultElevations } from '../core/worktype/elevation.js';

export function loadDictionary(): AppState['dictionary'] | null {
  try {
    const raw = localStorage.getItem('d4d-studio:dictionary:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AppState['dictionary']) : null;
  } catch {
    return null;
  }
}

export function saveDictionary(dictionary: AppState['dictionary']): void {
  try {
    localStorage.setItem('d4d-studio:dictionary:v1', JSON.stringify(dictionary));
  } catch {
    /* 容量超過などは無視（辞書は再学習できる） */
  }
}

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem('d4d-studio:theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* noop */
  }
  return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem('d4d-studio:theme', theme);
  } catch {
    /* noop */
  }
}

export function defaultCaseCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `CASE-${y}${m}${d}`;
}

export function createState(): AppState {
  return {
    step: 1,
    busy: false,
    busyMessage: '',
    importError: null,
    drawing: null,
    drawingSource: null,
    sampleLoaded: false,
    schedule: null,
    scheduleSourceName: null,
    assignments: [],
    elevations: defaultElevations(),
    dictionary: loadDictionary() ?? [...SEED_DICTIONARY],
    workTypes: [...WORK_TYPES],
    parts: [],
    buildWarnings: [],
    buildUnmatched: [],
    timeline: null,
    currentDate: 0,
    playing: false,
    speed: 7,
    highlightLayer: null,
    selectedPartId: null,
    highlightCode: null,
    learnFlags: {},
    filterUnconfirmed: false,
    api: 'unknown',
    caseMeta: { code: defaultCaseCode(), name: '岸壁工事（サンプル）', description: '', updatedAt: '' },
    toast: null,
    theme: loadTheme(),
  };
}

/** 3D対象で未確定の行数。 */
export function pendingCount(state: AppState): number {
  return state.assignments.filter(
    (assignment) => !assignment.excluded && !assignment.confirmed && assignment.workTypeCode !== null,
  ).length;
}

/** 確定済みの工種数（除外を除く）。 */
export function confirmedWorkTypeCount(state: AppState): number {
  const codes = new Set<string>();
  for (const assignment of state.assignments) {
    if (assignment.confirmed && assignment.workTypeCode && !assignment.excluded) {
      codes.add(assignment.workTypeCode);
    }
  }
  return codes.size;
}
