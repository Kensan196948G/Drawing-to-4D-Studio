import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type pg from 'pg';
import { decodeDxfBuffer, parseDxf } from '../src/core/dxf/parser.js';
import { parseScheduleCsv } from '../src/core/schedule/csv.js';
import { bulkConfirm, estimateAssignments } from '../src/core/worktype/estimate.js';
import { SEED_DICTIONARY, WORK_TYPES } from '../src/core/worktype/defaults.js';
import { applyElevationNotes, defaultElevations, extractElevationNotes } from '../src/core/worktype/elevation.js';

const SAMPLE_DXF = fileURLToPath(new URL('../src/web/public/samples/seawall_plan.dxf', import.meta.url));
const SAMPLE_CSV = fileURLToPath(new URL('../src/web/public/samples/schedule.csv', import.meta.url));

export async function seedWorkTypes(client: pg.PoolClient): Promise<number> {
  for (const workType of WORK_TYPES) {
    await client.query(
      `INSERT INTO work_types (code, name, color, sequence, sort_order, default_top, default_bottom)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color,
         sequence = EXCLUDED.sequence,
         sort_order = EXCLUDED.sort_order,
         default_top = EXCLUDED.default_top,
         default_bottom = EXCLUDED.default_bottom`,
      [
        workType.code,
        workType.name,
        workType.color,
        workType.sequence,
        workType.order,
        workType.defaultTop,
        workType.defaultBottom,
      ],
    );
  }
  return WORK_TYPES.length;
}

export async function seedDictionary(client: pg.PoolClient): Promise<number> {
  for (const term of SEED_DICTIONARY) {
    await client.query(
      `INSERT INTO dictionary_terms (pattern, match_type, work_type_code, confidence, priority, source)
       VALUES ($1, $2, $3, $4, $5, 'seed')
       ON CONFLICT (pattern, match_type) DO UPDATE SET
         work_type_code = EXCLUDED.work_type_code,
         confidence = EXCLUDED.confidence,
         priority = EXCLUDED.priority,
         source = CASE WHEN dictionary_terms.source = 'learned' THEN 'learned' ELSE 'seed' END,
         updated_at = now()`,
      [term.pattern, term.matchType, term.workTypeCode, term.confidence, term.priority],
    );
  }
  return SEED_DICTIONARY.length;
}

export interface SampleSeedResult {
  code: string;
  layerCount: number;
  entityCount: number;
  scheduleRows: number;
  assignments: number;
  elevations: number;
}

/**
 * 架空サンプル図面からサンプル案件を投入する。
 * 既存のサンプル案件のみ削除して作り直す（他案件には触れない）。
 */
export async function seedSampleCase(client: pg.PoolClient): Promise<SampleSeedResult> {
  const dxfBytes = readFileSync(SAMPLE_DXF);
  const text = decodeDxfBuffer(
    dxfBytes.buffer.slice(dxfBytes.byteOffset, dxfBytes.byteOffset + dxfBytes.byteLength) as ArrayBuffer,
  );
  const drawing = parseDxf(text, 'seawall_plan.dxf');
  const schedule = parseScheduleCsv(readFileSync(SAMPLE_CSV, 'utf8'), 'schedule.csv');
  const assignments = bulkConfirm(estimateAssignments(drawing, SEED_DICTIONARY), 0.5);
  const { elevations } = applyElevationNotes(defaultElevations(), extractElevationNotes(drawing));
  const sha256 = createHash('sha256').update(dxfBytes).digest('hex');
  const code = 'SAMPLE-KANPEKI';

  await client.query('DELETE FROM cases WHERE code = $1', [code]);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO cases (code, name, description, revision)
     VALUES ($1, $2, $3, 1) RETURNING id`,
    [
      code,
      '岸壁築造工事（架空サンプル）',
      'Drawing-to-4D Studio の動作確認用。平面図・標準断面図・工程表はすべて架空。',
    ],
  );
  const caseId = inserted.rows[0]?.id;
  if (!caseId) throw new Error('sample case insert failed');

  await client.query(
    `INSERT INTO case_drawings
       (case_id, filename, size_bytes, units, unit_name, layer_count, entity_count,
        min_x, min_y, max_x, max_y, sha256, layers, entities)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
    [
      caseId,
      'seawall_plan.dxf',
      dxfBytes.byteLength,
      drawing.units,
      drawing.unitName,
      drawing.layers.length,
      drawing.entities.length,
      drawing.bounds.minX,
      drawing.bounds.minY,
      drawing.bounds.maxX,
      drawing.bounds.maxY,
      sha256,
      JSON.stringify(drawing.layers),
      JSON.stringify(drawing.entities),
    ],
  );

  for (const [index, row] of schedule.rows.entries()) {
    await client.query(
      `INSERT INTO case_schedule_rows (case_id, code, name, start_date, end_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        caseId,
        row.code,
        row.name,
        new Date(row.start).toISOString().slice(0, 10),
        new Date(row.end - 86_400_000).toISOString().slice(0, 10),
        index,
      ],
    );
  }

  for (const assignment of assignments) {
    await client.query(
      `INSERT INTO case_assignments
         (case_id, layer, work_type_code, confidence, source, confirmed, excluded, notes, candidates, entity_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
      [
        caseId,
        assignment.layer,
        assignment.workTypeCode,
        assignment.confidence,
        assignment.source,
        assignment.confirmed,
        assignment.excluded,
        JSON.stringify(assignment.notes),
        JSON.stringify(assignment.candidates),
        JSON.stringify(assignment.entityCounts),
      ],
    );
  }

  for (const entry of elevations) {
    await client.query(
      `INSERT INTO case_elevations
         (case_id, work_type_code, top_elev, bottom_elev, source, sequence, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (case_id, work_type_code) DO UPDATE SET
         top_elev = EXCLUDED.top_elev,
         bottom_elev = EXCLUDED.bottom_elev,
         source = EXCLUDED.source,
         sequence = EXCLUDED.sequence,
         enabled = EXCLUDED.enabled`,
      [
        caseId,
        entry.workTypeCode,
        entry.top,
        entry.bottom,
        entry.source,
        entry.sequence,
        entry.enabled,
      ],
    );
  }

  return {
    code,
    layerCount: drawing.layers.length,
    entityCount: drawing.entities.length,
    scheduleRows: schedule.rows.length,
    assignments: assignments.length,
    elevations: elevations.length,
  };
}
