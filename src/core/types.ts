/**
 * Drawing-to-4D Studio — 共通用モデル型。
 * ブラウザ（WebUI）と Node（API / テスト）の両方から利用する純粋な型のみを置く。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EntityBase {
  layer: string;
}

export interface LineEntity extends EntityBase {
  type: 'line';
  a: Vec2;
  b: Vec2;
}

export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  /** 頂点（m 単位に正規化済み） */
  points: Vec2[];
  closed: boolean;
  /** 頂点間の bulge（頂点 i → i+1）。無い場合は 0。 */
  bulges: number[];
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  center: Vec2;
  radius: number;
}

export interface ArcEntity extends EntityBase {
  type: 'arc';
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface TextEntity extends EntityBase {
  type: 'text';
  position: Vec2;
  height: number;
  text: string;
  rotation: number;
}

export interface PointEntity extends EntityBase {
  type: 'point';
  position: Vec2;
}

export type DxfEntity = LineEntity | PolylineEntity | CircleEntity | ArcEntity | TextEntity | PointEntity;

export interface DxfLayer {
  name: string;
  color: number;
  linetype: string;
  visible: boolean;
}

export interface EntityCounts {
  line: number;
  polyline: number;
  circle: number;
  arc: number;
  text: number;
  point: number;
}

export interface DxfDrawing {
  layers: DxfLayer[];
  entities: DxfEntity[];
  units: number;
  unitName: string;
  /** DXF 座標 → m へ変換する係数 */
  unitScale: number;
  bounds: Bounds;
  counts: EntityCounts;
  warnings: string[];
}

export type SequenceMode = 'extend' | 'each' | 'stack' | 'instant';

export interface WorkType {
  code: string;
  name: string;
  color: string;
  sequence: SequenceMode;
  order: number;
  /** 標高の初期値（m）。null は「対象外」 */
  defaultTop: number | null;
  defaultBottom: number | null;
}

export type MatchType = 'exact' | 'contains' | 'regex' | 'note';

export interface DictionaryTerm {
  id: string;
  pattern: string;
  matchType: MatchType;
  workTypeCode: string;
  /** 0..1 */
  confidence: number;
  priority: number;
  source: 'seed' | 'learned' | 'manual';
}

export interface Candidate {
  workTypeCode: string;
  confidence: number;
  reason: string;
}

export interface Assignment {
  layer: string;
  entityCounts: EntityCounts;
  candidates: Candidate[];
  workTypeCode: string | null;
  confidence: number;
  source: 'auto' | 'manual' | 'none';
  confirmed: boolean;
  excluded: boolean;
  /** 層に含まれる文字注記（最大 5 件） */
  notes: string[];
}

export interface ElevationEntry {
  workTypeCode: string;
  top: number;
  bottom: number;
  source: 'default' | 'note' | 'manual';
  sequence: SequenceMode;
  /** 3D化の対象にするか（準備工・片付けなど立体を持たない工種は false） */
  enabled: boolean;
}

export interface ElevationSuggestion {
  workTypeCode: string;
  top: number;
  bottom: number;
  label: string;
  matchedText: string;
  confidence: number;
}

export interface ScheduleRow {
  code: string;
  name: string;
  /** UTC 深夜 0 時（ms）。表示は JST を想定。 */
  start: number;
  /** 終了日を含むため、翌日 0 時（ms）。 */
  end: number;
}

export interface BadScheduleRow {
  line: number;
  reason: string;
  raw: string;
}

export interface ParsedSchedule {
  sourceName: string;
  rows: ScheduleRow[];
  badRows: BadScheduleRow[];
  columns: { code: number; name: number; start: number; end: number };
}

export interface Part {
  id: string;
  layer: string;
  workTypeCode: string;
  points: Vec2[];
  /** m²（符号なし） */
  area: number;
  closed: boolean;
  top: number;
  bottom: number;
  sequence: SequenceMode;
  /** 同一層内の通し番号（each の順序に使う） */
  ordinal: number;
}

export interface PartWarning {
  layer: string;
  reason: string;
  detail?: string;
}

export interface BuildResult {
  parts: Part[];
  warnings: PartWarning[];
  /** 工程表と対応できなかった工種コード */
  unmatchedWorkTypes: string[];
  /** 工程表の行と対応した工種コード */
  matchedWorkTypes: string[];
}

export interface TimelineRange {
  start: number;
  end: number;
  current: number;
}

export interface PartProgress {
  partId: string;
  visible: boolean;
  /** 0..1 */
  progress: number;
  /** extend の場合、クリップ位置（world X） */
  clipX?: number;
  /** stack の場合、0..1 の高さ係数 */
  scaleY?: number;
}

export interface ProjectMeta {
  code: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface SavedDrawingMeta {
  filename: string;
  sizeBytes: number;
  units: number;
  unitName: string;
  layerCount: number;
  entityCount: number;
  bounds: Bounds;
}

/** 案件の保存形式（localStorage / API 共通） */
export interface StudioDocument {
  version: 1;
  meta: ProjectMeta;
  drawing: {
    meta: SavedDrawingMeta;
    layers: DxfLayer[];
    entities: DxfEntity[];
  } | null;
  schedule: ParsedSchedule | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
  dictionary: DictionaryTerm[];
}
