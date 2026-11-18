import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeDxfBuffer, parseDxf } from '../../src/core/dxf/parser';
import { SEED_DICTIONARY } from '../../src/core/worktype/defaults';
import {
  bulkConfirm,
  estimateAssignments,
  learnLayerTerm,
  signedArea,
} from '../../src/core/worktype/estimate';

const dxfPath = fileURLToPath(new URL('../../src/web/public/samples/seawall_plan.dxf', import.meta.url));

function loadDrawing() {
  const buffer = readFileSync(dxfPath);
  return parseDxf(
    decodeDxfBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer),
  );
}

describe('work type estimation', () => {
  const drawing = loadDrawing();
  const assignments = estimateAssignments(drawing, SEED_DICTIONARY);
  const byLayer = new Map(assignments.map((assignment) => [assignment.layer, assignment]));

  it('assigns layers by name and embedded code', () => {
    expect(byLayer.get('CAISSON')?.workTypeCode).toBe('040');
    expect(byLayer.get('MOUND')?.workTypeCode).toBe('030');
    expect(byLayer.get('4D_050_上部工')?.workTypeCode).toBe('050');
    expect(byLayer.get('4D_050_上部工')?.confidence).toBeGreaterThan(0.95);
    expect(byLayer.get('裏埋')?.workTypeCode).toBe('060');
    expect(byLayer.get('エプロン舗装')?.workTypeCode).toBe('080');
    expect(byLayer.get('FENDER')?.workTypeCode).toBe('070');
    expect(byLayer.get('係船柱')?.workTypeCode).toBe('070');
  });

  it('uses text notes inside the layer outline (Layer3 → 裏込工)', () => {
    const layer3 = byLayer.get('Layer3');
    expect(layer3?.workTypeCode).toBe('045');
    expect(layer3?.candidates[0]?.reason).toContain('文字注記');
  });

  it('excludes dimension, normal line, section and annotation layers', () => {
    for (const name of ['DIM', '4D_法線', 'TEXT', 'SEC-CAISSON', 'SEC-床掘', 'SEC-地盤']) {
      expect(byLayer.get(name)?.excluded, name).toBe(true);
    }
    expect(byLayer.get('SEC-CAISSON')?.workTypeCode).toBeNull();
  });

  it('keeps unknown layers unassigned instead of guessing', () => {
    const zero = byLayer.get('0');
    expect(zero?.workTypeCode).toBeNull();
    expect(zero?.source).toBe('none');
  });

  it('bulk confirm only applies confidence above the threshold', () => {
    const confirmed = bulkConfirm(assignments, 0.9);
    expect(confirmed.find((assignment) => assignment.layer === 'CAISSON')?.confirmed).toBe(true);
    expect(confirmed.find((assignment) => assignment.layer === 'Layer3')?.confirmed).toBe(false);
    expect(confirmed.find((assignment) => assignment.layer === '0')?.confirmed).toBe(false);
  });

  it('learns a manual correction into the dictionary', () => {
    const learned = learnLayerTerm(SEED_DICTIONARY, 'Layer3', '045');
    const exact = learned.find(
      (term) => term.matchType === 'exact' && term.pattern === 'Layer3' && term.source === 'learned',
    );
    expect(exact?.workTypeCode).toBe('045');
    const reEstimated = estimateAssignments(drawing, learned);
    const layer3 = reEstimated.find((assignment) => assignment.layer === 'Layer3');
    expect(layer3?.workTypeCode).toBe('045');
    expect(layer3?.confidence).toBe(1);
  });

  it('computes signed area consistently', () => {
    expect(signedArea([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(1);
    expect(signedArea([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }])).toBe(-1);
  });
});
