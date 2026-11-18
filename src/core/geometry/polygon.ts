import type { PolylineEntity, Vec2 } from '../types.js';

const TWO_PI = Math.PI * 2;

/** bulge（tan(θ/4)）付きの線分を円弧として補間し、始点を除く点列を返す。 */
export function arcPoints(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9 || Math.abs(bulge) < 1e-9) return [{ ...b }];

  const theta = 4 * Math.atan(bulge);
  const absTheta = Math.abs(theta);
  if (absTheta < 1e-6) return [{ ...b }];
  if (absTheta > TWO_PI - 1e-6) return [{ ...b }];

  const radius = chord / (2 * Math.sin(absTheta / 2));
  const direction = Math.atan2(dy, dx);
  const centerAngle = direction + Math.sign(theta) * (Math.PI / 2 - absTheta / 2);
  const cx = a.x + radius * Math.cos(centerAngle);
  const cy = a.y + radius * Math.sin(centerAngle);
  const startAngle = Math.atan2(a.y - cy, a.x - cx);
  const steps = Math.max(2, Math.ceil(absTheta / ((10 * Math.PI) / 180)));
  const points: Vec2[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const angle = startAngle + (theta * i) / steps;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  // 数値誤差で終点がずれるため、最後は b に合わせる
  const last = points[points.length - 1];
  if (last) {
    last.x = b.x;
    last.y = b.y;
  }
  return points;
}

/** ポリラインを（閉路も含めて）テッセレーションする。閉路の重複終点は除去する。 */
export function tessellatePolyline(entity: PolylineEntity): Vec2[] {
  const points = entity.points;
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const out: Vec2[] = [];
  const segments = entity.closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    out.push({ x: a.x, y: a.y });
    const bulge = entity.bulges[i] ?? 0;
    if (Math.abs(bulge) > 1e-9) {
      out.push(...arcPoints(a, b, bulge));
      if (entity.closed && i === segments - 1) out.pop(); // 閉路の終点 = 始点
    } else if (!(entity.closed && i === segments - 1)) {
      out.push({ x: b.x, y: b.y });
    }
  }
  if (!entity.closed) {
    const last = points[points.length - 1];
    if (last) out.push({ x: last.x, y: last.y });
  }
  return dedupeConsecutive(out);
}

export function dedupeConsecutive(points: readonly Vec2[], epsilon = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(previous.x - point.x) < epsilon && Math.abs(previous.y - point.y) < epsilon) {
      continue;
    }
    out.push({ x: point.x, y: point.y });
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.abs(first.x - last.x) < epsilon && Math.abs(first.y - last.y) < epsilon) {
      out.pop();
    }
  }
  return out;
}

export function signedArea(points: readonly Vec2[]): number {
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

/** ExtrudeGeometry 用に反時計回りへ揃える。 */
export function ensureCounterClockwise(points: readonly Vec2[]): Vec2[] {
  const area = signedArea(points);
  return area < 0 ? [...points].reverse() : points.map((point) => ({ ...point }));
}

export function polygonArea(points: readonly Vec2[]): number {
  return Math.abs(signedArea(points));
}

export function polygonBounds(points: readonly Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}
