import type { DictionaryTerm, WorkType } from '../types.js';

/**
 * 工種マスタ（初期値）。
 * 工程表CSVの工種コードと対応する。色は3D表示と凡例で共用する。
 */
export const WORK_TYPES: readonly WorkType[] = [
  {
    code: '010',
    name: '準備工・汚濁防止膜設置',
    color: '#8aa4b8',
    sequence: 'instant',
    order: 10,
    defaultTop: null,
    defaultBottom: null,
  },
  {
    code: '020',
    name: '床掘工（グラブ浚渫）',
    color: '#a97b4f',
    sequence: 'extend',
    order: 20,
    defaultTop: -11.0,
    defaultBottom: -13.0,
  },
  {
    code: '030',
    name: '基礎捨石工（投入・均し）',
    color: '#8f8f7a',
    sequence: 'extend',
    order: 30,
    defaultTop: -11.0,
    defaultBottom: -13.5,
  },
  {
    code: '040',
    name: 'ケーソン据付工（5函）',
    color: '#2f6f8f',
    sequence: 'each',
    order: 40,
    defaultTop: 3.5,
    defaultBottom: -11.0,
  },
  {
    code: '045',
    name: '裏込工（裏込石）',
    color: '#b08a5a',
    sequence: 'extend',
    order: 45,
    defaultTop: 3.5,
    defaultBottom: -11.0,
  },
  {
    code: '050',
    name: '上部工（コンクリート）',
    color: '#6b7f8f',
    sequence: 'stack',
    order: 50,
    defaultTop: 3.5,
    defaultBottom: 2.0,
  },
  {
    code: '060',
    name: '裏埋工（埋立）',
    color: '#9b7d5f',
    sequence: 'extend',
    order: 60,
    defaultTop: 4.0,
    defaultBottom: 0.0,
  },
  {
    code: '070',
    name: '付属工（係船柱・防舷材）',
    color: '#c26b4a',
    sequence: 'each',
    order: 70,
    defaultTop: 3.5,
    defaultBottom: 3.3,
  },
  {
    code: '080',
    name: 'エプロン舗装工',
    color: '#7a8a99',
    sequence: 'extend',
    order: 80,
    defaultTop: 4.0,
    defaultBottom: 3.8,
  },
  {
    code: '090',
    name: '片付け・完成検査',
    color: '#6f8f6a',
    sequence: 'instant',
    order: 90,
    defaultTop: null,
    defaultBottom: null,
  },
] as const;

export const WORK_TYPE_BY_CODE: ReadonlyMap<string, WorkType> = new Map(
  WORK_TYPES.map((workType) => [workType.code, workType]),
);

export function workTypeByCode(code: string | null | undefined): WorkType | undefined {
  if (!code) return undefined;
  return WORK_TYPE_BY_CODE.get(code);
}

/**
 * 工種推定の初期辞書。
 * 第1段階はキーワード辞書（AI推定は第2段階）。レイヤ名 → 工種の対応を中心にする。
 */
export const SEED_DICTIONARY: readonly DictionaryTerm[] = [
  // 010 準備工・汚濁防止膜
  t('010', '汚濁防止膜', 'contains', 0.95, 90),
  t('010', '汚濁', 'contains', 0.9, 80),
  t('010', '準備工', 'contains', 0.9, 80),
  t('010', '仮設', 'contains', 0.7, 50),
  // 020 床掘
  t('020', 'EX-床掘', 'contains', 0.97, 120),
  t('020', '床掘', 'contains', 0.96, 110),
  t('020', '掘削', 'contains', 0.92, 100),
  t('020', 'DREDGE', 'contains', 0.9, 90),
  t('020', 'DREDGING', 'contains', 0.9, 90),
  // 030 基礎捨石
  t('030', '基礎捨石', 'contains', 0.96, 115),
  t('030', '捨石', 'contains', 0.94, 105),
  t('030', 'MOUND', 'contains', 0.88, 85),
  t('030', 'RUBBLE', 'contains', 0.86, 80),
  t('030', '均し', 'contains', 0.8, 70),
  // 040 ケーソン
  t('040', 'ケーソン', 'contains', 0.96, 115),
  t('040', 'CAISSON', 'contains', 0.93, 110),
  t('040', '函', 'exact', 0.6, 20),
  // 045 裏込
  t('045', '裏込石', 'contains', 0.95, 110),
  t('045', '裏込', 'contains', 0.93, 100),
  t('045', 'BACKFILL', 'contains', 0.86, 80),
  // 050 上部工
  t('050', '上部工', 'contains', 0.96, 115),
  t('050', 'コンクリート', 'contains', 0.84, 75),
  t('050', 'CONC', 'contains', 0.8, 70),
  t('050', 'PARAPET', 'contains', 0.75, 60),
  // 060 裏埋
  t('060', '裏埋', 'contains', 0.94, 105),
  t('060', '埋立', 'contains', 0.9, 95),
  t('060', '埋戻', 'contains', 0.88, 90),
  t('060', 'FILL', 'contains', 0.7, 40),
  // 070 付属工
  t('070', '係船柱', 'contains', 0.95, 105),
  t('070', '防舷材', 'contains', 0.95, 105),
  t('070', 'FENDER', 'contains', 0.92, 100),
  t('070', 'BOLLARD', 'contains', 0.92, 100),
  t('070', '付属工', 'contains', 0.9, 95),
  // 080 エプロン舗装
  t('080', 'エプロン', 'contains', 0.95, 105),
  t('080', '舗装', 'contains', 0.9, 95),
  t('080', 'PAVEMENT', 'contains', 0.86, 85),
  t('080', 'ASPHALT', 'contains', 0.84, 80),
  // 090 片付け
  t('090', '片付', 'contains', 0.94, 100),
  t('090', '完成検査', 'contains', 0.92, 95),
  t('090', '清掃', 'contains', 0.8, 70),
];

/** 図面の要素であって工種ではないレイヤ（寸法・通り芯など）。 */
export const EXCLUDED_LAYER_PATTERNS: readonly RegExp[] = [
  /^DIM/i,
  /寸法/,
  /法線/,
  /通り芯/,
  /中心線/,
  /^GRID/i,
  /グリッド/,
  /^DEFPOINTS$/i,
  /図枠/,
  /枠線/,
  /表題/,
  /見出し/,
  /^VIEWPORT$/i,
  /ビューポート/,
  // 断面図の参照レイヤ（3D化は平面図から行い、断面は標高注記の参照に使う）
  /^SEC[-_]/i,
  // 文字注記だけのレイヤ（工種の形状ではない）
  /^TEXT$/i,
  /^文字$/,
  /^注記$/,
];

export function isExcludedLayer(layerName: string): boolean {
  const name = layerName.normalize('NFKC').trim();
  return EXCLUDED_LAYER_PATTERNS.some((pattern) => pattern.test(name));
}

/** 辞書の標準化に使う（全角・大文字小文字・空白の揺れを吸収）。 */
export function normalizeForMatch(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
}

function t(
  workTypeCode: string,
  pattern: string,
  matchType: DictionaryTerm['matchType'],
  confidence: number,
  priority: number,
): DictionaryTerm {
  return {
    id: `seed-${workTypeCode}-${matchType}-${normalizeForMatch(pattern).replace(/[^A-Z0-9\u4e00-\u9fff]/g, '_')}`,
    pattern,
    matchType,
    workTypeCode,
    confidence,
    priority,
    source: 'seed',
  };
}
