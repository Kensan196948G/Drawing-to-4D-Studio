import type {
  Assignment,
  Candidate,
  DictionaryTerm,
  DxfDrawing,
  DxfEntity,
  EntityCounts,
  PolylineEntity,
} from '../types.js';
import { WORK_TYPES, isExcludedLayer, normalizeForMatch, workTypeByCode } from './defaults.js';

const CODE_IN_LAYER = /(?:^|[_\-#.\s])(\d{3})(?:$|[_\-#.\s])/;

export interface LayerProfile {
  layer: string;
  entities: DxfEntity[];
  counts: EntityCounts;
  texts: string[];
}

/** レイヤ単位に要素をまとめ、文字注記を抽出する。 */
export function profileLayers(drawing: DxfDrawing): LayerProfile[] {
  const map = new Map<string, LayerProfile>();
  for (const entity of drawing.entities) {
    let profile = map.get(entity.layer);
    if (!profile) {
      profile = {
        layer: entity.layer,
        entities: [],
        counts: { line: 0, polyline: 0, circle: 0, arc: 0, text: 0, point: 0 },
        texts: [],
      };
      map.set(entity.layer, profile);
    }
    profile.entities.push(entity);
    profile.counts[entity.type] += 1;
    if (entity.type === 'text') profile.texts.push(entity.text);
  }
  return [...map.values()].sort((a, b) => a.layer.localeCompare(b.layer, 'ja'));
}

/** レイヤ名・文字注記・形の繰り返しから工種候補を推定する。 */
export function estimateAssignments(
  drawing: DxfDrawing,
  dictionary: readonly DictionaryTerm[],
): Assignment[] {
  const profiles = profileLayers(drawing);
  const sortedDictionary = [...dictionary].sort(
    (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length,
  );

  const allTexts = drawing.entities.filter((entity) => entity.type === 'text');
  return profiles.map((profile) => {
    const excluded = isExcludedLayer(profile.layer);
    // レイヤ 0 は CAD の既定レイヤで、内外に多数の注記を含むため注記推定の対象にしない。
    const nearby = profile.layer.trim() === '0' ? [] : nearbyTexts(profile.entities, allTexts);
    const notes = [...new Set([...profile.texts, ...nearby].map((text) => text.trim()).filter(Boolean))].slice(0, 5);
    const candidates: Candidate[] = [];

    if (!excluded) {
      const codeCandidate = matchEmbeddedCode(profile.layer);
      if (codeCandidate) candidates.push(codeCandidate);
      candidates.push(...matchDictionary(profile.layer, notes, sortedDictionary));
      const shapeCandidate = matchRepeatedShapes(profile, candidates);
      if (shapeCandidate) candidates.push(shapeCandidate);
    }

    const deduped = dedupeCandidates(candidates).slice(0, 3);
    const best = deduped[0];
    return {
      layer: profile.layer,
      entityCounts: profile.counts,
      candidates: deduped,
      workTypeCode: excluded ? null : (best?.workTypeCode ?? null),
      confidence: excluded ? 0 : (best?.confidence ?? 0),
      source: excluded ? 'none' : best ? 'auto' : 'none',
      confirmed: false,
      excluded,
      notes,
    } satisfies Assignment;
  });
}

function matchEmbeddedCode(layer: string): Candidate | null {
  const match = CODE_IN_LAYER.exec(normalizeForMatch(layer));
  if (!match) return null;
  const code = match[1];
  if (!code || !workTypeByCode(code)) return null;
  return { workTypeCode: code, confidence: 0.98, reason: 'レイヤ名の工種コード' };
}

function matchDictionary(
  layer: string,
  notes: string[],
  dictionary: readonly DictionaryTerm[],
): Candidate[] {
  const normalizedLayer = normalizeForMatch(layer);
  const normalizedNotes = notes.map(normalizeForMatch);
  const found: Candidate[] = [];

  for (const term of dictionary) {
    if (!workTypeByCode(term.workTypeCode)) continue;
    const pattern = normalizeForMatch(term.pattern);
    if (!pattern) continue;

    if (term.matchType === 'exact' && normalizedLayer === pattern) {
      found.push({ workTypeCode: term.workTypeCode, confidence: term.confidence, reason: `レイヤ名が「${term.pattern}」` });
    } else if (term.matchType === 'contains' && normalizedLayer.includes(pattern)) {
      found.push({ workTypeCode: term.workTypeCode, confidence: term.confidence, reason: `レイヤ名に「${term.pattern}」` });
    } else if (term.matchType === 'regex') {
      try {
        if (new RegExp(term.pattern, 'i').test(layer)) {
          found.push({ workTypeCode: term.workTypeCode, confidence: term.confidence, reason: `レイヤ名が/${term.pattern}/に一致` });
        }
      } catch {
        /* 不正な正規表現は無視 */
      }
    }
    if (term.matchType !== 'note') {
      for (const note of normalizedNotes) {
        if (note.includes(pattern)) {
          found.push({
            workTypeCode: term.workTypeCode,
            confidence: Math.round(term.confidence * 0.7 * 100) / 100,
            reason: `文字注記に「${term.pattern}」`,
          });
        }
      }
    }
  }
  return found;
}

function matchRepeatedShapes(profile: LayerProfile, existing: Candidate[]): Candidate | null {
  if (existing.length > 0) return null;
  if (!workTypeByCode('040')) return null;
  const polygons = profile.entities.filter((entity): entity is PolylineEntity => entity.type === 'polyline' && entity.closed);
  if (polygons.length < 3) return null;
  const areas = polygons.map((polygon) => Math.abs(signedArea(polygon.points))).filter((area) => area > 0.01);
  if (areas.length < 3) return null;
  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return null;
  const similar = areas.filter((area) => Math.abs(area - median) / median <= 0.25);
  if (similar.length < 3) return null;
  return {
    workTypeCode: '040',
    confidence: 0.5,
    reason: '同じ形の閉じた輪郭が複数（ケーソンの可能性）',
  };
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.workTypeCode);
    if (!current || candidate.confidence > current.confidence) best.set(candidate.workTypeCode, candidate);
  }
  return [...best.values()].sort(
    (a, b) => b.confidence - a.confidence || a.workTypeCode.localeCompare(b.workTypeCode),
  );
}


/**
 * レイヤの図形に含まれる文字注記を集める。
 * 例: 閉じた輪郭の中に「裏込石」と書かれていれば、そのレイヤの注記候補にする。
 */
function nearbyTexts(
  layerEntities: readonly DxfEntity[],
  allTexts: readonly DxfEntity[],
): string[] {
  const polygons = layerEntities.filter(
    (entity): entity is PolylineEntity => entity.type === 'polyline' && entity.closed,
  );
  if (polygons.length === 0) {
    const texts = layerEntities.filter((entity) => entity.type === 'text');
    return texts.map((entity) => entity.text);
  }
  const found: string[] = [];
  for (const text of allTexts) {
    if (text.type !== 'text') continue;
    if (polygons.some((polygon) => pointInPolygon(text.position.x, text.position.y, polygon.points))) {
      found.push(text.text);
    }
  }
  return found;
}

function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const current = points[i];
    const previous = points[j];
    if (!current || !previous) continue;
    const crosses = current.y > y !== previous.y > y;
    if (crosses && x < ((previous.x - current.x) * (y - current.y)) / (previous.y - current.y) + current.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function signedArea(points: readonly { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

/** 一括確定: 信頼度が閾値以上で未確定の行を確定する。 */
export function bulkConfirm(assignments: Assignment[], threshold: number): Assignment[] {
  return assignments.map((assignment) => {
    if (assignment.excluded || assignment.confirmed) return assignment;
    if (assignment.workTypeCode && assignment.confidence >= threshold) {
      return { ...assignment, confirmed: true, source: 'auto' };
    }
    return assignment;
  });
}

/**
 * 担当者の修正を辞書へ学習させる。
 * 同じレイヤ名の exact 辞書を置き換え、他の工種の同名 exact を除去する。
 */
export function learnLayerTerm(
  dictionary: readonly DictionaryTerm[],
  layerName: string,
  workTypeCode: string,
): DictionaryTerm[] {
  const normalized = normalizeForMatch(layerName);
  const others = dictionary.filter(
    (term) => !(term.matchType === 'exact' && normalizeForMatch(term.pattern) === normalized),
  );
  const learned: DictionaryTerm = {
    id: `learned-${workTypeCode}-${normalized.replace(/[^A-Z0-9\u4e00-\u9fff]/g, '_')}`,
    pattern: layerName,
    matchType: 'exact',
    workTypeCode,
    confidence: 1,
    priority: 200,
    source: 'learned',
  };
  return [learned, ...others];
}

export function confirmedWorkTypeCount(assignments: Assignment[]): number {
  const codes = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.confirmed && assignment.workTypeCode && !assignment.excluded) {
      codes.add(assignment.workTypeCode);
    }
  }
  return codes.size;
}

export function assignmentCoverage(assignments: Assignment[]): { confirmed: number; total: number } {
  const targets = assignments.filter((assignment) => !assignment.excluded);
  return {
    confirmed: targets.filter((assignment) => assignment.confirmed && assignment.workTypeCode).length,
    total: targets.length,
  };
}

export function workTypeName(code: string | null): string {
  if (!code) return '未割当';
  return WORK_TYPES.find((workType) => workType.code === code)?.name ?? code;
}
