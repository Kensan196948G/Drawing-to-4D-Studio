import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDxfBuffer, parseDxf } from '../../src/core/dxf/parser';
import { parseScheduleCsv } from '../../src/core/schedule/csv';
import { bulkConfirm, estimateAssignments } from '../../src/core/worktype/estimate';
import { SEED_DICTIONARY } from '../../src/core/worktype/defaults';
import { applyElevationNotes, defaultElevations, extractElevationNotes } from '../../src/core/worktype/elevation';
import { buildParts } from '../../src/core/geometry/parts';
import { tessellatePolyline } from '../../src/core/geometry/polygon';

const dxfPath = fileURLToPath(new URL('../../src/web/public/samples/seawall_plan.dxf', import.meta.url));
const csvPath = fileURLToPath(new URL('../../src/web/public/samples/schedule.csv', import.meta.url));

function loadDrawing() {
  const buffer = readFileSync(dxfPath);
  return parseDxf(
    decodeDxfBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer),
  );
}

describe('polygon geometry', () => {
  it('tessellates a rectangle without duplicates', () => {
    const points = tessellatePolyline({
      type: 'polyline',
      layer: 'L',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      bulges: [0, 0, 0, 0],
      closed: true,
    });
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
  });

  it('tessellates a semicircle bulge with the expected area', () => {
    const points = tessellatePolyline({
      type: 'polyline',
      layer: 'L',
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ].slice(0, 2),
      bulges: [1, 0],
      closed: true,
    });
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a || !b) continue;
      area += a.x * b.y - b.x * a.y;
    }
    expect(Math.abs(area / 2)).toBeCloseTo(Math.PI / 2, 1);
  });
});

describe('3D parts from the sample drawing', () => {
  const drawing = loadDrawing();
  const assignments = bulkConfirm(estimateAssignments(drawing, SEED_DICTIONARY), 0.5);
  const { elevations } = applyElevationNotes(defaultElevations(), extractElevationNotes(drawing));
  const schedule = parseScheduleCsv(readFileSync(csvPath, 'utf8'));
  const result = buildParts(drawing, assignments, elevations, schedule.rows);

  it('generates one part per closed contour and circle', () => {
    expect(result.parts).toHaveLength(29);
    const byCode = new Map<string, number>();
    for (const part of result.parts) byCode.set(part.workTypeCode, (byCode.get(part.workTypeCode) ?? 0) + 1);
    expect(byCode.get('040')).toBe(5);
    expect(byCode.get('050')).toBe(5);
    expect(byCode.get('070')).toBe(15); // FENDER 10 + 係船柱 5（円）
    expect(byCode.get('030')).toBe(1);
    expect(byCode.get('045')).toBe(1);
    expect(byCode.get('060')).toBe(1);
    expect(byCode.get('080')).toBe(1);
  });

  it('uses the section-derived elevations', () => {
    const caisson = result.parts.find((part) => part.workTypeCode === '040');
    expect(caisson?.top).toBe(2.0);
    expect(caisson?.bottom).toBe(-11.0);
    const upper = result.parts.find((part) => part.workTypeCode === '050');
    expect(upper?.top).toBe(3.5);
    expect(upper?.bottom).toBe(2.0);
  });

  it('links every part work type to the schedule', () => {
    expect(result.unmatchedWorkTypes).toEqual([]);
    expect(result.matchedWorkTypes.length).toBeGreaterThanOrEqual(7);
    // エプロン舗装は 0.5m 開いているため自動で閉じ、警告として残す（人の確認対象）
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.layer).toBe('エプロン舗装');
    expect(result.warnings[0]?.reason).toContain('自動で閉じました');
  });

  it('reports a warning for an assigned layer without closed contours', () => {
    const broken = assignments.map((assignment) =>
      assignment.layer === 'MOUND'
        ? { ...assignment, confirmed: true, workTypeCode: '040' }
        : assignment,
    );
    broken.push({
      layer: 'LINE-ONLY',
      entityCounts: { line: 1, polyline: 0, circle: 0, arc: 0, text: 0, point: 0 },
      candidates: [],
      workTypeCode: '040',
      confidence: 1,
      source: 'manual',
      confirmed: true,
      excluded: false,
      notes: [],
    });
    const local = buildParts(drawing, broken, elevations, schedule.rows);
    expect(local.warnings.some((warning) => warning.layer === 'LINE-ONLY')).toBe(true);
  });
});
