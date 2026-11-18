import type {
  Assignment,
  BuildResult,
  CircleEntity,
  DxfDrawing,
  ElevationEntry,
  Part,
  PartWarning,
  PolylineEntity,
  ScheduleRow,
  Vec2,
} from '../types.js';
import { groupEntitiesByLayer } from '../dxf/parser.js';
import { matchScheduleRow } from '../schedule/match.js';
import { workTypeByCode } from '../worktype/defaults.js';
import { tessellatePolyline } from './polygon.js';

const MIN_AREA = 0.01; // m²
const MAX_PARTS = 5000;

/**
 * 確定済みの工種割当と標高から3D部材を生成する。
 * 第1段階は「閉じた平面輪郭を標高範囲で押し出す」方式（方式A）のみ。
 */
export function buildParts(
  drawing: DxfDrawing,
  assignments: readonly Assignment[],
  elevations: readonly ElevationEntry[],
  scheduleRows: readonly ScheduleRow[],
): BuildResult {
  const parts: Part[] = [];
  const warnings: PartWarning[] = [];
  const layerEntities = groupEntitiesByLayer(drawing.entities);
  const elevationMap = new Map(elevations.map((entry) => [entry.workTypeCode, entry]));
  const matched = new Set<string>();
  const unmatched = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.excluded || !assignment.confirmed || !assignment.workTypeCode) continue;
    const workType = workTypeByCode(assignment.workTypeCode);
    if (!workType) continue;
    const elevation = elevationMap.get(assignment.workTypeCode);
    if (!elevation || !elevation.enabled) {
      warnings.push({
        layer: assignment.layer,
        reason: '3D対象外の工種のため生成しません',
        detail: workType.name,
      });
      continue;
    }
    if (!(elevation.top > elevation.bottom)) {
      warnings.push({
        layer: assignment.layer,
        reason: '天端と底面の標高が逆、または同じです',
        detail: `${workType.name}: 天端 ${elevation.top} / 底面 ${elevation.bottom}`,
      });
      continue;
    }

    const entities = layerEntities.get(assignment.layer) ?? [];
    const polylines = entities.filter((entity): entity is PolylineEntity => entity.type === 'polyline');
    const circles = entities.filter((entity): entity is CircleEntity => entity.type === 'circle');
    const contours: { points: Vec2[]; origin: 'closed' | 'auto-closed' }[] = [];

    for (const polyline of polylines) {
      if (polyline.closed) {
        contours.push({ points: tessellatePolyline(polyline), origin: 'closed' });
        continue;
      }
      // 終点と始点がわずかに離れているだけなら自動で閉じ、警告として残す（人の確認対象）。
      const gap = contourGap(polyline.points);
      if (polyline.points.length >= 3 && gap !== null && gap <= Math.max(0.5, contourPerimeter(polyline.points) * 0.01)) {
        contours.push({ points: tessellatePolyline(polyline), origin: 'auto-closed' });
        warnings.push({
          layer: assignment.layer,
          reason: '閉じていない輪郭を自動で閉じました',
          detail: `終点と始点の差 ${gap.toFixed(2)} m。確認してください。`,
        });
      }
    }

    if (contours.length === 0 && circles.length === 0) {
      warnings.push({
        layer: assignment.layer,
        reason: '閉じた輪郭がありません（3D化できません）',
        detail: 'ポリラインを閉じるか、3D化対象から外してください。',
      });
      continue;
    }

    let ordinal = 0;
    for (const contour of contours) {
      if (parts.length >= MAX_PARTS) {
        warnings.push({
          layer: assignment.layer,
          reason: `部材数が上限（${MAX_PARTS}）に達したため打ち切りました`,
        });
        break;
      }
      const points = contour.points;
      if (points.length < 3) continue;
      const area = Math.abs(signedPolygonArea(points));
      if (area < MIN_AREA) {
        warnings.push({
          layer: assignment.layer,
          reason: '面積が小さすぎる輪郭を除外しました',
          detail: `${area.toFixed(4)} m²`,
        });
        continue;
      }
      parts.push({
        id: `${assignment.workTypeCode}:${assignment.layer}:${ordinal}`,
        layer: assignment.layer,
        workTypeCode: assignment.workTypeCode,
        points,
        area,
        closed: true,
        top: elevation.top,
        bottom: elevation.bottom,
        sequence: elevation.sequence,
        ordinal,
      });
      ordinal += 1;
    }
    for (const circle of circles) {
      if (parts.length >= MAX_PARTS) break;
      const points = circleToPolygon(circle.center, circle.radius);
      const area = Math.PI * circle.radius * circle.radius;
      if (area < MIN_AREA) continue;
      parts.push({
        id: `${assignment.workTypeCode}:${assignment.layer}:${ordinal}`,
        layer: assignment.layer,
        workTypeCode: assignment.workTypeCode,
        points,
        area,
        closed: true,
        top: elevation.top,
        bottom: elevation.bottom,
        sequence: elevation.sequence,
        ordinal,
      });
      ordinal += 1;
    }
  }

  for (const assignment of assignments) {
    if (assignment.excluded || !assignment.workTypeCode) continue;
    const workType = workTypeByCode(assignment.workTypeCode);
    if (!workType) continue;
    if (matchScheduleRow(workType.code, workType.name, scheduleRows)) matched.add(workType.code);
    else unmatched.add(workType.code);
  }

  return {
    parts,
    warnings,
    matchedWorkTypes: [...matched].sort(),
    unmatchedWorkTypes: [...unmatched].sort(),
  };
}

function contourGap(points: readonly Vec2[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  return Math.hypot(last.x - first.x, last.y - first.y);
}

function contourPerimeter(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

function circleToPolygon(center: Vec2, radius: number, segments = 32): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

function signedPolygonArea(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

export function totalArea(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + part.area, 0);
}
