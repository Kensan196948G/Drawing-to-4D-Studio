import type pg from 'pg';
import type {
  Assignment,
  DictionaryTerm,
  DxfEntity,
  DxfLayer,
  ElevationEntry,
  EntityCounts,
  ParsedSchedule,
  WorkType,
} from '../core/types.js';
import { toIsoDate, toNumber } from './db.js';
import { ApiError } from './errors.js';
import type { CasePayload, LearnTermInput } from './schema.js';

export interface CaseSummary {
  code: string;
  name: string;
  description: string;
  revision: number;
  updatedAt: string;
  drawing: { filename: string; layerCount: number; entityCount: number } | null;
  confirmedLayers: number;
  enabledElevations: number;
}

export interface CaseRecord {
  meta: { code: string; name: string; description: string; revision: number; updatedAt: string };
  drawing: {
    meta: {
      filename: string;
      sizeBytes: number;
      units: number;
      unitName: string;
      layerCount: number;
      entityCount: number;
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      sha256?: string;
    };
    layers: DxfLayer[];
    entities: DxfEntity[];
  } | null;
  schedule: ParsedSchedule | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
}

const EMPTY_COUNTS: EntityCounts = { line: 0, polyline: 0, circle: 0, arc: 0, text: 0, point: 0 };

export class StudioRepository {
  constructor(private readonly pool: pg.Pool) {}

  async health(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async listWorkTypes(): Promise<WorkType[]> {
    const result = await this.pool.query(
      `SELECT code, name, color, sequence, sort_order, default_top, default_bottom
         FROM work_types ORDER BY sort_order`,
    );
    return result.rows.map((row) => ({
      code: row.code as string,
      name: row.name as string,
      color: row.color as string,
      sequence: row.sequence as WorkType['sequence'],
      order: Number(row.sort_order),
      defaultTop: row.default_top === null ? null : toNumber(row.default_top),
      defaultBottom: row.default_bottom === null ? null : toNumber(row.default_bottom),
    }));
  }

  async listDictionary(): Promise<DictionaryTerm[]> {
    const result = await this.pool.query(
      `SELECT id, pattern, match_type, work_type_code, confidence, priority, source
         FROM dictionary_terms
        ORDER BY priority DESC, length(pattern) DESC, pattern ASC`,
    );
    return result.rows.map(mapDictionaryRow);
  }

  async learnTerm(input: LearnTermInput): Promise<DictionaryTerm> {
    const workType = await this.pool.query('SELECT 1 FROM work_types WHERE code = $1', [input.workTypeCode]);
    if (workType.rowCount === 0) {
      throw new ApiError(400, 'ERR-422', `未知の工種コードです: ${input.workTypeCode}`);
    }
    const result = await this.pool.query(
      `INSERT INTO dictionary_terms (pattern, match_type, work_type_code, confidence, priority, source)
       VALUES ($1, $2, $3, $4, 200, 'learned')
       ON CONFLICT (pattern, match_type) DO UPDATE SET
         work_type_code = EXCLUDED.work_type_code,
         confidence = EXCLUDED.confidence,
         priority = GREATEST(dictionary_terms.priority, EXCLUDED.priority),
         source = 'learned',
         updated_at = now()
       RETURNING id, pattern, match_type, work_type_code, confidence, priority, source`,
      [input.pattern.trim(), input.matchType, input.workTypeCode, input.confidence],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(500, 'ERR-500', '辞書の保存に失敗しました。');
    return mapDictionaryRow(row);
  }

  async listCases(): Promise<CaseSummary[]> {
    const result = await this.pool.query(
      `SELECT c.code, c.name, c.description, c.revision, c.updated_at,
              d.filename, d.layer_count, d.entity_count,
              COALESCE(a.confirmed_layers, 0) AS confirmed_layers,
              COALESCE(e.enabled_elevations, 0) AS enabled_elevations
         FROM cases c
         LEFT JOIN case_drawings d ON d.case_id = c.id
         LEFT JOIN (
           SELECT case_id, count(*) FILTER (WHERE confirmed AND NOT excluded AND work_type_code IS NOT NULL) AS confirmed_layers
             FROM case_assignments GROUP BY case_id
         ) a ON a.case_id = c.id
         LEFT JOIN (
           SELECT case_id, count(*) FILTER (WHERE enabled) AS enabled_elevations
             FROM case_elevations GROUP BY case_id
         ) e ON e.case_id = c.id
        ORDER BY c.updated_at DESC, c.code`,
    );
    return result.rows.map((row) => ({
      code: row.code as string,
      name: row.name as string,
      description: row.description as string,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at as string).toISOString(),
      drawing:
        row.filename === null
          ? null
          : {
              filename: row.filename as string,
              layerCount: Number(row.layer_count),
              entityCount: Number(row.entity_count),
            },
      confirmedLayers: Number(row.confirmed_layers),
      enabledElevations: Number(row.enabled_elevations),
    }));
  }

  async getCase(code: string): Promise<CaseRecord | null> {
    const caseRow = await this.pool.query(
      `SELECT id, code, name, description, revision, updated_at FROM cases WHERE code = $1`,
      [code],
    );
    const found = caseRow.rows[0];
    if (!found) return null;
    const caseId = found.id as string;

    const drawingRow = await this.pool.query('SELECT * FROM case_drawings WHERE case_id = $1', [caseId]);
    const drawing = drawingRow.rows[0]
      ? {
          meta: {
            filename: drawingRow.rows[0].filename as string,
            sizeBytes: Number(drawingRow.rows[0].size_bytes),
            units: Number(drawingRow.rows[0].units),
            unitName: drawingRow.rows[0].unit_name as string,
            layerCount: Number(drawingRow.rows[0].layer_count),
            entityCount: Number(drawingRow.rows[0].entity_count),
            bounds: {
              minX: toNumber(drawingRow.rows[0].min_x),
              minY: toNumber(drawingRow.rows[0].min_y),
              maxX: toNumber(drawingRow.rows[0].max_x),
              maxY: toNumber(drawingRow.rows[0].max_y),
            },
            ...(drawingRow.rows[0].sha256 ? { sha256: drawingRow.rows[0].sha256 as string } : {}),
          },
          layers: drawingRow.rows[0].layers as DxfLayer[],
          entities: drawingRow.rows[0].entities as DxfEntity[],
        }
      : null;

    const scheduleRows = await this.pool.query(
      `SELECT code, name, start_date, end_date FROM case_schedule_rows
        WHERE case_id = $1 ORDER BY sort_order`,
      [caseId],
    );
    const schedule: ParsedSchedule | null =
      scheduleRows.rows.length > 0
        ? {
            sourceName: drawing?.meta.filename ? `${drawing.meta.filename} の工程表` : '保存された工程表',
            rows: scheduleRows.rows.map((row) => {
              const start = Date.parse(`${toIsoDate(row.start_date)}T00:00:00Z`);
              const endInclusive = Date.parse(`${toIsoDate(row.end_date)}T00:00:00Z`);
              return {
                code: row.code as string,
                name: row.name as string,
                start,
                end: endInclusive + 86_400_000,
              };
            }),
            badRows: [],
            columns: { code: 0, name: 1, start: 2, end: 3 },
          }
        : null;

    const assignmentRows = await this.pool.query(
      `SELECT layer, work_type_code, confidence, source, confirmed, excluded, notes, candidates, entity_counts
         FROM case_assignments WHERE case_id = $1 ORDER BY layer`,
      [caseId],
    );
    const assignments: Assignment[] = assignmentRows.rows.map((row) => ({
      layer: row.layer as string,
      entityCounts: (row.entity_counts as EntityCounts | null) ?? { ...EMPTY_COUNTS },
      candidates: (row.candidates as Assignment['candidates'] | null) ?? [],
      workTypeCode: (row.work_type_code as string | null) ?? null,
      confidence: toNumber(row.confidence),
      source: row.source as Assignment['source'],
      confirmed: Boolean(row.confirmed),
      excluded: Boolean(row.excluded),
      notes: (row.notes as string[] | null) ?? [],
    }));

    const elevationRows = await this.pool.query(
      `SELECT work_type_code, top_elev, bottom_elev, source, sequence, enabled
         FROM case_elevations WHERE case_id = $1 ORDER BY work_type_code`,
      [caseId],
    );
    const elevations: ElevationEntry[] = elevationRows.rows.map((row) => ({
      workTypeCode: row.work_type_code as string,
      top: toNumber(row.top_elev),
      bottom: toNumber(row.bottom_elev),
      source: row.source as ElevationEntry['source'],
      sequence: row.sequence as ElevationEntry['sequence'],
      enabled: Boolean(row.enabled),
    }));

    return {
      meta: {
        code: found.code as string,
        name: found.name as string,
        description: found.description as string,
        revision: Number(found.revision),
        updatedAt: new Date(found.updated_at as string).toISOString(),
      },
      drawing,
      schedule,
      assignments,
      elevations,
    };
  }

  async putCase(code: string, payload: CasePayload): Promise<{ code: string; revision: number }> {
    if (payload.drawing) {
      if (payload.drawing.meta.entityCount !== payload.drawing.entities.length) {
        throw new ApiError(400, 'ERR-422', '図面の entityCount と entities の件数が一致しません。');
      }
      if (payload.drawing.meta.layerCount !== payload.drawing.layers.length) {
        throw new ApiError(400, 'ERR-422', '図面の layerCount と layers の件数が一致しません。');
      }
    }
    if (payload.schedule) {
      for (const row of payload.schedule.rows) {
        if (row.end <= row.start) {
          throw new ApiError(400, 'ERR-422', `工程行「${row.name}」の終了日が開始日以前です。`);
        }
      }
    }

    const usedCodes = new Set<string>();
    for (const assignment of payload.assignments) {
      if (assignment.workTypeCode) usedCodes.add(assignment.workTypeCode);
    }
    for (const elevation of payload.elevations) usedCodes.add(elevation.workTypeCode);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (usedCodes.size > 0) {
        const known = await client.query<{ code: string }>('SELECT code FROM work_types WHERE code = ANY($1::text[])', [
          [...usedCodes],
        ]);
        const knownCodes = new Set(known.rows.map((row) => row.code));
        const missing = [...usedCodes].filter((item) => !knownCodes.has(item));
        if (missing.length > 0) {
          throw new ApiError(400, 'ERR-422', `未知の工種コードです: ${missing.join(', ')}`);
        }
      }

      const existing = await client.query<{ id: string; revision: number }>(
        'SELECT id, revision FROM cases WHERE code = $1 FOR UPDATE',
        [code],
      );
      let caseId: string;
      let revision: number;
      if (existing.rows[0]) {
        caseId = existing.rows[0].id;
        revision = Number(existing.rows[0].revision) + 1;
        await client.query(
          `UPDATE cases SET name = $2, description = $3, revision = $4, updated_at = now() WHERE id = $1`,
          [caseId, payload.meta.name, payload.meta.description, revision],
        );
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO cases (code, name, description, revision) VALUES ($1, $2, $3, 1) RETURNING id`,
          [code, payload.meta.name, payload.meta.description],
        );
        caseId = inserted.rows[0]?.id ?? '';
        revision = 1;
        if (!caseId) throw new ApiError(500, 'ERR-500', '案件の作成に失敗しました。');
      }

      await client.query('DELETE FROM case_schedule_rows WHERE case_id = $1', [caseId]);
      await client.query('DELETE FROM case_assignments WHERE case_id = $1', [caseId]);
      await client.query('DELETE FROM case_elevations WHERE case_id = $1', [caseId]);
      await client.query('DELETE FROM case_drawings WHERE case_id = $1', [caseId]);

      if (payload.drawing) {
        const { meta, layers, entities } = payload.drawing;
        await client.query(
          `INSERT INTO case_drawings
             (case_id, filename, size_bytes, units, unit_name, layer_count, entity_count,
              min_x, min_y, max_x, max_y, sha256, layers, entities)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
          [
            caseId,
            meta.filename,
            meta.sizeBytes,
            meta.units,
            meta.unitName,
            meta.layerCount,
            meta.entityCount,
            meta.bounds.minX,
            meta.bounds.minY,
            meta.bounds.maxX,
            meta.bounds.maxY,
            meta.sha256 ?? null,
            JSON.stringify(layers),
            JSON.stringify(entities),
          ],
        );
      }

      if (payload.schedule) {
        for (const [index, row] of payload.schedule.rows.entries()) {
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
      }

      for (const assignment of payload.assignments) {
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

      for (const elevation of payload.elevations) {
        await client.query(
          `INSERT INTO case_elevations
             (case_id, work_type_code, top_elev, bottom_elev, source, sequence, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            caseId,
            elevation.workTypeCode,
            elevation.top,
            elevation.bottom,
            elevation.source,
            elevation.sequence,
            elevation.enabled,
          ],
        );
      }

      await client.query('COMMIT');
      return { code, revision };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapDictionaryRow(row: Record<string, unknown>): DictionaryTerm {
  return {
    id: String(row.id),
    pattern: row.pattern as string,
    matchType: row.match_type as DictionaryTerm['matchType'],
    workTypeCode: row.work_type_code as string,
    confidence: toNumber(row.confidence),
    priority: Number(row.priority),
    source: row.source as DictionaryTerm['source'],
  };
}
