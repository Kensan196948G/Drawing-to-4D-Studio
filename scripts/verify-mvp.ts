/**
 * Phase 1 MVP の中核パイプラインを実データ（架空サンプル）で検証する。
 *
 * 1. DXF + 工程表CSV の解析
 * 2. 工種推定と確定
 * 3. 断面注記からの標高反映
 * 4. 3D部材の生成
 * 5. 工程連動4Dの状態計算
 * 6. API（localhost）への保存 → 再取得（F2）
 *
 * 結果は docs/evidence/core-verification.json に残す。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { decodeDxfBuffer, parseDxf } from '../src/core/dxf/parser.js';
import { formatDateJst, parseScheduleCsv } from '../src/core/schedule/csv.js';
import { matchScheduleRow } from '../src/core/schedule/match.js';
import { buildParts } from '../src/core/geometry/parts.js';
import { computePartProgress, makeTimeline } from '../src/core/timeline/model.js';
import { bulkConfirm, estimateAssignments } from '../src/core/worktype/estimate.js';
import { SEED_DICTIONARY, WORK_TYPES } from '../src/core/worktype/defaults.js';
import {
  applyElevationNotes,
  defaultElevations,
  extractElevationNotes,
  validateElevations,
} from '../src/core/worktype/elevation.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DXF_PATH = `${ROOT}src/web/public/samples/seawall_plan.dxf`;
const CSV_PATH = `${ROOT}src/web/public/samples/schedule.csv`;
const EVIDENCE_DIR = `${ROOT}docs/evidence`;
const API_BASE = process.env.VERIFY_API_BASE ?? 'http://127.0.0.1:8792';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.info(`${ok ? 'PASS' : 'FAIL'} ${name} (${detail})`);
}

const dxfBytes = readFileSync(DXF_PATH);
const drawing = parseDxf(
  decodeDxfBuffer(dxfBytes.buffer.slice(dxfBytes.byteOffset, dxfBytes.byteOffset + dxfBytes.byteLength) as ArrayBuffer),
  'seawall_plan.dxf',
);
const schedule = parseScheduleCsv(readFileSync(CSV_PATH, 'utf8'), 'schedule.csv');

check('DXF: units=m', drawing.units === 6 && drawing.unitName === 'm', `units=${drawing.units}`);
check('DXF: 20 layers / 66 entities', drawing.layers.length === 20 && drawing.entities.length === 66, `${drawing.layers.length}/${drawing.entities.length}`);
check('CSV: 10 rows / 0 bad', schedule.rows.length === 10 && schedule.badRows.length === 0, `${schedule.rows.length}/${schedule.badRows.length}`);

const assignments = bulkConfirm(estimateAssignments(drawing, SEED_DICTIONARY), 0.5);
const byLayer = new Map(assignments.map((assignment) => [assignment.layer, assignment]));
const expected: [string, string][] = [
  ['CAISSON', '040'],
  ['MOUND', '030'],
  ['4D_050_上部工', '050'],
  ['Layer3', '045'],
  ['裏埋', '060'],
  ['エプロン舗装', '080'],
  ['FENDER', '070'],
  ['係船柱', '070'],
];
for (const [layer, code] of expected) {
  check(`estimate: ${layer} → ${code}`, byLayer.get(layer)?.workTypeCode === code, `${byLayer.get(layer)?.workTypeCode ?? 'null'} / ${byLayer.get(layer)?.confidence ?? 0}`);
}
const excluded = ['DIM', '4D_法線', 'TEXT', 'SEC-CAISSON', 'SEC-床掘'];
check(
  'exclude: dimension/normal/section/annotation',
  excluded.every((layer) => byLayer.get(layer)?.excluded === true),
  excluded.map((layer) => `${layer}=${byLayer.get(layer)?.excluded ?? false}`).join(', '),
);
const confirmed = assignments.filter((assignment) => assignment.confirmed && assignment.workTypeCode && !assignment.excluded);
check('confirm: >= 7 work types', new Set(confirmed.map((assignment) => assignment.workTypeCode)).size >= 7, `${confirmed.length} layers`);

const notes = extractElevationNotes(drawing);
check('elevation: 10 notes', notes.length === 10, `${notes.length}`);
const { elevations, applied } = applyElevationNotes(defaultElevations(), notes);
const elevByCode = new Map(elevations.map((entry) => [entry.workTypeCode, entry]));
check('elevation: applied 10', applied.length === 10, `${applied.length}`);
check(
  'elevation: caisson top/bottom = 2.0/-11.0',
  elevByCode.get('040')?.top === 2 && elevByCode.get('040')?.bottom === -11,
  `${elevByCode.get('040')?.top}/${elevByCode.get('040')?.bottom}`,
);
check(
  'elevation: upper top/bottom = 3.5/2.0',
  elevByCode.get('050')?.top === 3.5 && elevByCode.get('050')?.bottom === 2,
  `${elevByCode.get('050')?.top}/${elevByCode.get('050')?.bottom}`,
);
const elevationErrors = validateElevations(elevations);
check('elevation: valid', elevationErrors.length === 0, elevationErrors.join(' / ') || 'no errors');

const built = buildParts(drawing, assignments, elevations, schedule.rows);
const countByCode = new Map<string, number>();
for (const part of built.parts) countByCode.set(part.workTypeCode, (countByCode.get(part.workTypeCode) ?? 0) + 1);
check('parts: 29 total', built.parts.length === 29, `${built.parts.length}`);
check(
  'parts: 040=5 / 050=5 / 070=15',
  countByCode.get('040') === 5 && countByCode.get('050') === 5 && countByCode.get('070') === 15,
  `040=${countByCode.get('040') ?? 0}, 050=${countByCode.get('050') ?? 0}, 070=${countByCode.get('070') ?? 0}`,
);
check(
  'parts: auto-closed contour warning present',
  built.warnings.some((warning) => warning.reason.includes('自動で閉じました')),
  built.warnings.map((warning) => `${warning.layer}:${warning.reason}`).join(' | '),
);
check('parts: all work types matched to schedule', built.unmatchedWorkTypes.length === 0, built.unmatchedWorkTypes.join(', ') || 'none');

const caissonRow = matchScheduleRow('040', WORK_TYPES.find((workType) => workType.code === '040')?.name ?? '', schedule.rows);
const caissonMid = caissonRow ? caissonRow.start + (caissonRow.end - caissonRow.start) / 2 : 0;
const timeline = makeTimeline(schedule.rows);
check('timeline: 2027/04/01–2028/03/24', formatDateJst(timeline.start) === '2027/04/01' && formatDateJst(timeline.end - 86_400_000) === '2028/03/24', `${formatDateJst(timeline.start)}–${formatDateJst(timeline.end - 86_400_000)}`);

const atStart = computePartProgress(built.parts, schedule.rows, timeline.start);
check('4D: all hidden at start', atStart.every((state) => !state.visible), `${atStart.filter((state) => state.visible).length} visible`);

const atEnd = computePartProgress(built.parts, schedule.rows, timeline.end);
check('4D: all visible at end', atEnd.every((state) => state.visible), `${atEnd.filter((state) => state.visible).length}/${atEnd.length} visible`);

const caissonStates = computePartProgress(
  built.parts.filter((part) => part.workTypeCode === '040'),
  schedule.rows,
  caissonMid,
);
check(
  '4D: caisson each-mode reveals 3/5 at midpoint',
  caissonStates.filter((state) => state.visible).length === 3,
  `${caissonStates.filter((state) => state.visible).length}/5 visible`,
);

const moundRow = matchScheduleRow('030', WORK_TYPES.find((workType) => workType.code === '030')?.name ?? '', schedule.rows);
const moundMid = moundRow ? moundRow.start + (moundRow.end - moundRow.start) / 2 : 0;
const extendState = computePartProgress(
  built.parts.filter((part) => part.workTypeCode === '030'),
  schedule.rows,
  moundMid,
)[0];
check(
  '4D: mound extend-mode clip moves',
  extendState?.visible === true && typeof extendState.clipX === 'number' && extendState.clipX > 0 && extendState.clipX < 100,
  `clipX=${extendState?.clipX ?? 'n/a'}`,
);

const stackState = computePartProgress(
  built.parts.filter((part) => part.workTypeCode === '050'),
  schedule.rows,
  matchScheduleRow('050', WORK_TYPES.find((workType) => workType.code === '050')?.name ?? '', schedule.rows)?.start ?? 0,
)[0];
check('4D: upper stack starts at bottom', stackState !== undefined && (stackState.scaleY ?? 1) <= 0.01, `scaleY=${stackState?.scaleY ?? 'n/a'}`);

// --- F2: API への保存 → 再取得 ---
interface ApiResult {
  status: 'ok' | 'skipped' | 'failed';
  detail: string;
}
let apiResult: ApiResult = { status: 'skipped', detail: 'not attempted' };
try {
  const health = await fetch(`${API_BASE}/healthz`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`healthz ${health.status}`);
  const payload = {
    meta: { name: '中核検証用案件（架空）', description: 'scripts/verify-mvp.ts が生成。実データは含まない。' },
    drawing: {
      meta: {
        filename: 'seawall_plan.dxf',
        sizeBytes: dxfBytes.byteLength,
        units: drawing.units,
        unitName: drawing.unitName,
        layerCount: drawing.layers.length,
        entityCount: drawing.entities.length,
        bounds: drawing.bounds,
        sha256: createHash('sha256').update(dxfBytes).digest('hex'),
      },
      layers: drawing.layers,
      entities: drawing.entities,
    },
    schedule,
    assignments,
    elevations,
  };
  const put = await fetch(`${API_BASE}/api/cases/VERIFY-CORE-01`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!put.ok) throw new Error(`PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
  const saved = (await put.json()) as { case: { revision: number } };
  const get = await fetch(`${API_BASE}/api/cases/VERIFY-CORE-01`, { signal: AbortSignal.timeout(10_000) });
  if (!get.ok) throw new Error(`GET ${get.status}`);
  const loaded = (await get.json()) as {
    case: {
      drawing: { meta: { entityCount: number } } | null;
      schedule: { rows: unknown[] } | null;
      assignments: unknown[];
      elevations: unknown[];
    };
  };
  const ok =
    loaded.case.drawing?.meta.entityCount === 66 &&
    loaded.case.schedule?.rows.length === 10 &&
    loaded.case.assignments.length === 20 &&
    loaded.case.elevations.length === 10;
  apiResult = {
    status: ok ? 'ok' : 'failed',
    detail: `PUT revision=${saved.case.revision}; GET entities=${loaded.case.drawing?.meta.entityCount}, rows=${loaded.case.schedule?.rows.length}, assignments=${loaded.case.assignments.length}, elevations=${loaded.case.elevations.length}`,
  };
  check('F2: API save → reload matches', ok, apiResult.detail);
} catch (error) {
  apiResult = { status: 'failed', detail: error instanceof Error ? error.message : String(error) };
  check('F2: API save → reload matches', false, apiResult.detail);
}

const coreOk = checks
  .filter((entry) => !entry.name.startsWith('F2:'))
  .every((entry) => entry.ok);
const allOk = coreOk && apiResult.status === 'ok';
const evidence = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/verify-mvp.ts',
  environment: { node: process.version, apiBase: API_BASE },
  summary: { checks: checks.length, passed: checks.filter((entry) => entry.ok).length, allOk },
  sample: {
    drawing: { layers: drawing.layers.length, entities: drawing.entities.length, units: drawing.unitName },
    schedule: { rows: schedule.rows.length },
    parts: { total: built.parts.length, byWorkType: Object.fromEntries(countByCode) },
    timeline: { start: formatDateJst(timeline.start), end: formatDateJst(timeline.end - 86_400_000) },
  },
  api: apiResult,
  checks,
};

mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(`${EVIDENCE_DIR}/core-verification.json`, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.info(`\nEVIDENCE: docs/evidence/core-verification.json`);
console.info(`RESULT: ${allOk ? 'PASS' : 'FAIL'} (${checks.filter((entry) => entry.ok).length}/${checks.length})`);
if (!allOk) process.exitCode = 1;
