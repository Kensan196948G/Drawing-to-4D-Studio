import type { StudioDocument } from '../core/types.js';
import type { AppState, StoredCaseMeta } from './types.js';

const INDEX_KEY = 'd4d-studio:index:v1';
const DOC_PREFIX = 'd4d-studio:doc:';
const MAX_DOCUMENT_BYTES = 4_500_000;

interface StoredIndex {
  [code: string]: StoredCaseMeta;
}

function readIndex(): StoredIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredIndex;
  } catch {
    return {};
  }
}

function writeIndex(index: StoredIndex): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listLocalCases(): StoredCaseMeta[] {
  return Object.values(readIndex()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function documentToJson(document: StudioDocument): string {
  return JSON.stringify(document);
}

export function documentBytes(document: StudioDocument): number {
  return new Blob([documentToJson(document)]).size;
}

export function saveLocalCase(
  document: StudioDocument,
): { ok: true; bytes: number } | { ok: false; error: string } {
  const json = documentToJson(document);
  const bytes = new Blob([json]).size;
  if (bytes > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `保存容量が上限（4.5MB）を超えます（${(bytes / 1024 / 1024).toFixed(1)}MB）。案件を削除するか、図面を小さくしてください。`,
    };
  }
  try {
    localStorage.setItem(`${DOC_PREFIX}${document.meta.code}`, json);
  } catch {
    return { ok: false, error: 'ブラウザの保存容量が不足しています。案件を削除してから保存してください。' };
  }
  const index = readIndex();
  index[document.meta.code] = {
    code: document.meta.code,
    name: document.meta.name,
    updatedAt: document.meta.updatedAt,
    parts: 0,
  };
  try {
    writeIndex(index);
  } catch {
    return { ok: false, error: '案件一覧の更新に失敗しました。保存容量を確認してください。' };
  }
  return { ok: true, bytes };
}

export function updateLocalCaseParts(code: string, parts: number): void {
  try {
    const index = readIndex();
    const entry = index[code];
    if (!entry) return;
    entry.parts = parts;
    writeIndex(index);
  } catch {
    /* noop */
  }
}

export function loadLocalCase(code: string): StudioDocument | null {
  try {
    const raw = localStorage.getItem(`${DOC_PREFIX}${code}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudioDocument;
    if (!parsed || parsed.version !== 1 || !parsed.meta || parsed.meta.code !== code) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteLocalCase(code: string): void {
  try {
    localStorage.removeItem(`${DOC_PREFIX}${code}`);
    const index = readIndex();
    delete index[code];
    writeIndex(index);
  } catch {
    /* noop */
  }
}

export function buildDocument(state: AppState): StudioDocument {
  const drawing =
    state.drawing && state.drawingSource
      ? {
          meta: {
            filename: state.drawingSource.filename,
            sizeBytes: state.drawingSource.sizeBytes,
            units: state.drawing.units,
            unitName: state.drawing.unitName,
            layerCount: state.drawing.layers.length,
            entityCount: state.drawing.entities.length,
            bounds: state.drawing.bounds,
            ...(state.drawingSource.sha256 ? { sha256: state.drawingSource.sha256 } : {}),
          },
          layers: state.drawing.layers,
          entities: state.drawing.entities,
        }
      : null;

  return {
    version: 1,
    meta: { ...state.caseMeta, updatedAt: new Date().toISOString() },
    drawing,
    schedule: state.schedule,
    assignments: state.assignments,
    elevations: state.elevations,
    dictionary: state.dictionary,
  };
}
