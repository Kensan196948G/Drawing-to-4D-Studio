import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDxfBuffer, parseDxf } from '../../src/core/dxf/parser';

const samplePath = fileURLToPath(new URL('../../src/web/public/samples/seawall_plan.dxf', import.meta.url));

function loadSample() {
  const buffer = readFileSync(samplePath);
  const text = decodeDxfBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  return parseDxf(text, 'seawall_plan.dxf');
}

describe('DXF parser', () => {
  it('sample drawing: units, bounds, counts', () => {
    const drawing = loadSample();
    expect(drawing.units).toBe(6);
    expect(drawing.unitName).toBe('m');
    expect(drawing.unitScale).toBe(1);
    expect(drawing.bounds.minX).toBeCloseTo(-2, 6);
    expect(drawing.bounds.minY).toBeCloseTo(-30, 6);
    expect(drawing.bounds.maxX).toBeCloseTo(256, 6);
    expect(drawing.bounds.maxY).toBeCloseTo(56, 6);
    expect(drawing.counts.polyline).toBeGreaterThanOrEqual(30);
    expect(drawing.counts.text).toBeGreaterThanOrEqual(20);
    expect(drawing.warnings).toEqual([]);
  });

  it('sample drawing: layers and closed polygons', () => {
    const drawing = loadSample();
    const layerNames = drawing.layers.map((layer) => layer.name);
    for (const name of ['MOUND', 'CAISSON', '4D_050_上部工', 'Layer3', '裏埋', 'エプロン舗装', 'DIM', 'SEC-CAISSON']) {
      expect(layerNames).toContain(name);
    }
    const closed = drawing.entities.filter(
      (entity) => entity.type === 'polyline' && entity.closed,
    );
    const caisson = closed.filter((entity) => entity.layer === 'CAISSON');
    expect(caisson).toHaveLength(5);
    const upper = closed.filter((entity) => entity.layer === '4D_050_上部工');
    expect(upper).toHaveLength(5);
    const circles = drawing.entities.filter((entity) => entity.type === 'circle');
    expect(circles).toHaveLength(5);
  });

  it('sample drawing: section elevation annotations are decoded', () => {
    const drawing = loadSample();
    const texts = drawing.entities
      .filter((entity) => entity.type === 'text')
      .map((entity) => (entity.type === 'text' ? entity.text : ''));
    expect(texts).toContain('ケーソン 天端 +2.0');
    expect(texts).toContain('床掘底 -13.0');
    expect(texts).toContain('マウンド天端 -11.0');
    expect(texts.some((text) => text.includes('標準断面図'))).toBe(true);
  });

  it('decodes DXF escapes and control codes', async () => {
    const { decodeDxfText } = await import('../../src/core/dxf/parser');
    expect(decodeDxfText('外径%%c1000')).toBe('外径Ø1000');
    expect(decodeDxfText('\\U+5929\\U+7AEF +3.5')).toBe('天端 +3.5');
    expect(decodeDxfText('\\P1行目\\P2行目')).toBe('1行目 2行目');
  });

  it('parses a minimal hand-written DXF with LWPOLYLINE and TEXT', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1',
      '0', 'LAYER', '2', 'EX-床掘', '70', '0', '62', '1', '6', 'CONTINUOUS',
      '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'EX-床掘', '90', '4', '70', '1',
      '10', '0', '20', '0', '10', '1000', '20', '0', '10', '1000', '20', '1000', '10', '0', '20', '1000',
      '0', 'TEXT', '8', 'EX-床掘', '10', '10', '20', '10', '40', '2.5', '1', '床掘範囲',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const drawing = parseDxf(dxf, 'minimal.dxf');
    expect(drawing.units).toBe(4);
    expect(drawing.unitScale).toBe(0.001);
    expect(drawing.bounds.maxX).toBeCloseTo(1, 6);
    expect(drawing.bounds.maxY).toBeCloseTo(1, 6);
    expect(drawing.entities[0]?.type).toBe('polyline');
    expect(drawing.entities[1]?.type).toBe('text');
  });
});
