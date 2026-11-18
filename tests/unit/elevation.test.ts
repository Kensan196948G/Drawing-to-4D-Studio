import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDxfBuffer, parseDxf } from '../../src/core/dxf/parser';
import {
  applyElevationNotes,
  defaultElevations,
  extractElevationNotes,
  validateElevations,
} from '../../src/core/worktype/elevation';

const dxfPath = fileURLToPath(new URL('../../src/web/public/samples/seawall_plan.dxf', import.meta.url));

function loadDrawing() {
  const buffer = readFileSync(dxfPath);
  return parseDxf(
    decodeDxfBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer),
  );
}

describe('elevation notes', () => {
  const drawing = loadDrawing();
  const notes = extractElevationNotes(drawing);

  it('extracts the section annotations', () => {
    expect(notes.length).toBe(10);
    const texts = notes.map((note) => note.source);
    expect(texts).toContain('ケーソン 天端 +2.0');
    expect(texts).toContain('床掘底 -13.0');
    expect(texts).toContain('マウンド天端 -11.0');
    expect(texts).toContain('上部工 底面 +2.0');
  });

  it('maps labels to work types and top/bottom', () => {
    const find = (source: string) => notes.find((note) => note.source === source);
    expect(find('ケーソン 天端 +2.0')?.workTypeCode).toBe('040');
    expect(find('ケーソン 天端 +2.0')?.kind).toBe('top');
    expect(find('床掘底 -13.0')?.workTypeCode).toBe('020');
    expect(find('床掘底 -13.0')?.kind).toBe('bottom');
    expect(find('マウンド天端 -11.0')?.workTypeCode).toBe('030');
    expect(find('上部工 底面 +2.0')?.workTypeCode).toBe('050');
  });

  it('applies notes over defaults and keeps a valid top/bottom order', () => {
    const { elevations, applied } = applyElevationNotes(defaultElevations(), notes);
    expect(applied.length).toBe(10);
    const map = new Map(elevations.map((entry) => [entry.workTypeCode, entry]));
    expect(map.get('040')?.top).toBe(2.0);
    expect(map.get('040')?.bottom).toBe(-11.0);
    expect(map.get('050')?.top).toBe(3.5);
    expect(map.get('050')?.bottom).toBe(2.0);
    expect(map.get('080')?.top).toBe(3.5);
    expect(map.get('080')?.bottom).toBe(3.2);
    expect(map.get('070')?.top).toBe(4.4);
    expect(map.get('070')?.bottom).toBe(3.5);
    expect(map.get('020')?.bottom).toBe(-13.0);
    expect(map.get('030')?.top).toBe(-11.0);
    expect(validateElevations(elevations)).toEqual([]);
  });

  it('reports invalid elevations', () => {
    const elevations = defaultElevations();
    const target = elevations.find((entry) => entry.workTypeCode === '040');
    if (target) {
      target.top = -20;
      target.bottom = -10;
      target.enabled = true;
    }
    expect(validateElevations(elevations).length).toBeGreaterThan(0);
  });

  it('keeps non-solid work types disabled by default', () => {
    const elevations = defaultElevations();
    expect(elevations.find((entry) => entry.workTypeCode === '010')?.enabled).toBe(false);
    expect(elevations.find((entry) => entry.workTypeCode === '090')?.enabled).toBe(false);
    expect(elevations.find((entry) => entry.workTypeCode === '040')?.enabled).toBe(true);
  });
});
