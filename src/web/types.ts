import type {
  Assignment,
  DictionaryTerm,
  DxfDrawing,
  ElevationEntry,
  ParsedSchedule,
  Part,
  PartWarning,
  TimelineRange,
  WorkType,
} from '../core/types.js';

export type Step = 1 | 2 | 3 | 4 | 5;
export type ApiState = 'unknown' | 'online' | 'offline';
export type Theme = 'light' | 'dark';

export interface SourceMeta {
  filename: string;
  sizeBytes: number;
  sha256?: string;
}

export interface CaseMeta {
  code: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface ToastMessage {
  kind: 'ok' | 'warn' | 'err';
  message: string;
  id: number;
}

export interface AppState {
  step: Step;
  busy: boolean;
  busyMessage: string;
  importError: string | null;
  drawing: DxfDrawing | null;
  drawingSource: SourceMeta | null;
  sampleLoaded: boolean;
  schedule: ParsedSchedule | null;
  scheduleSourceName: string | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
  dictionary: DictionaryTerm[];
  workTypes: WorkType[];
  parts: Part[];
  buildWarnings: PartWarning[];
  buildUnmatched: string[];
  timeline: TimelineRange | null;
  currentDate: number;
  playing: boolean;
  speed: 1 | 2 | 7 | 30;
  highlightLayer: string | null;
  selectedPartId: string | null;
  highlightCode: string | null;
  learnFlags: Record<string, boolean>;
  filterUnconfirmed: boolean;
  api: ApiState;
  caseMeta: CaseMeta;
  toast: ToastMessage | null;
  theme: Theme;
}

export interface StoredCaseMeta {
  code: string;
  name: string;
  updatedAt: string;
  parts: number;
}

export interface CaseSummary {
  code: string;
  name: string;
  description: string;
  revision: number;
  updatedAt: string;
  drawing: { filename: string; layerCount: number; entityCount: number } | null;
  confirmedLayers: number;
  enabledElevations: number;
}

export interface ApiCase {
  meta: { code: string; name: string; description: string; revision: number; updatedAt: string };
  drawing: {
    meta: {
      filename: string;
      sizeBytes: number;
      units: number;
      unitName: string;
      layerCount: number;
      entityCount: number;
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      sha256?: string;
    };
    layers: DxfDrawing['layers'];
    entities: DxfDrawing['entities'];
  } | null;
  schedule: ParsedSchedule | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
}

export interface CasePayload {
  meta: { name: string; description: string };
  drawing: ApiCase['drawing'];
  schedule: ParsedSchedule | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
}
