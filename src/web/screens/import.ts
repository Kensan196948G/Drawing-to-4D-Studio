import sampleScheduleCsv from '../public/samples/schedule.csv?raw';
import sampleDxf from '../public/samples/seawall_plan.dxf?raw';
import { parseDxf, decodeDxfBuffer } from '../../core/dxf/parser.js';
import { parseScheduleCsv } from '../../core/schedule/csv.js';
import { estimateAssignments } from '../../core/worktype/estimate.js';
import { defaultElevations } from '../../core/worktype/elevation.js';
import type { AppContext } from '../context.js';
import { mountPlanPreview } from '../plan-preview.js';
import { downloadText, escapeHtml, fmtDate, icon } from '../ui.js';

export function renderImport(ctx: AppContext): string {
  const { state } = ctx;
  const drawing = state.drawing;
  const schedule = state.schedule;
  const warnings = [
    ...(state.importError ? [{ kind: 'error' as const, text: state.importError }] : []),
    ...(drawing?.warnings ?? []).map((text) => ({ kind: 'warn' as const, text })),
    ...(schedule?.badRows ?? []).map((row) => ({
      kind: 'warn' as const,
      text: `工程表 ${row.line} 行目: ${row.reason}`,
    })),
  ];

  return `
  <section class="view" data-testid="screen-import">
    ${state.sampleLoaded ? `<div class="banner" data-testid="sample-banner">${icon('alert')}サンプル図面（架空）を読み込んでいます。手元のDXFで試すには、下のドロップゾーンから取り込んでください。</div>` : ''}
    <div class="view-head">
      <span class="hi">${icon('upload')}</span>
      <div>
        <div class="eyebrow">STEP 01 / IMPORT</div>
        <h1>1　図面の取り込み</h1>
        <p>DXFの施工計画図（平面図・断面図）と工程表CSVを読み込みます。読み込みはこのパソコンの中だけで行います。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn p" type="button" data-action="next" data-testid="next" ${drawing ? '' : 'disabled'}>
        工種の割り当てへ ${icon('arrow')}
      </button>
    </div>

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('upload')}ファイルを置く</div>
          <div class="card-body">
            ${state.busy ? loadingBlock(state.busyMessage) : dropzoneBlock()}
            <div class="formats" aria-label="対応形式">
              ${format('DXF', '対応', 'green', '線・ポリライン・文字・レイヤ')}
              ${format('CSV', '対応', 'green', '工種コード・名称・開始・終了')}
              ${format('DWG', '変換', 'navy', 'DXFへ変換してから')}
              ${format('SXF', '第2段階', 'mute', '')}
              ${format('PDF', '第2段階', 'mute', '')}
              ${format('Excel', '第2段階', 'mute', '')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('file')}読み込んだ内容
            <span class="r">${drawing ? escapeHtml(state.drawingSource?.filename ?? '図面') : '未読込'}</span>
          </div>
          <div class="card-body">
            ${
              drawing
                ? `<div class="stats">
                    <div class="stat"><small>線・輪郭</small><b data-testid="stat-entities">${drawing.counts.polyline + drawing.counts.line}</b></div>
                    <div class="stat"><small>円</small><b>${drawing.counts.circle}</b></div>
                    <div class="stat"><small>文字</small><b>${drawing.counts.text}</b></div>
                    <div class="stat"><small>レイヤ</small><b data-testid="stat-layers">${drawing.layers.length}</b></div>
                  </div>
                  <dl class="kv">
                    <dt>単位</dt><dd>${escapeHtml(drawing.unitName)}（×${drawing.unitScale}）</dd>
                    <dt>範囲</dt><dd>${drawing.bounds.minX.toFixed(1)} … ${drawing.bounds.maxX.toFixed(1)} / ${drawing.bounds.minY.toFixed(1)} … ${drawing.bounds.maxY.toFixed(1)}</dd>
                    <dt>要素数</dt><dd>${drawing.entities.length.toLocaleString()}</dd>
                  </dl>`
                : '<div class="empty"><b>まだ図面がありません</b>DXFを置くか、サンプル図面で試してください。</div>'
            }
            <div style="height:12px"></div>
            <div class="card-head" style="border:0;padding:0 0 6px;background:transparent">${icon('file')}工程表</div>
            ${
              schedule
                ? `<dl class="kv" style="margin-top:0">
                    <dt>行数</dt><dd>${schedule.rows.length}</dd>
                    <dt>期間</dt><dd>${schedule.rows.length > 0 ? `${fmtDate(Math.min(...schedule.rows.map((row) => row.start)))} – ${fmtDate(Math.max(...schedule.rows.map((row) => row.end)) - 86_400_000)}` : '—'}</dd>
                    <dt>不良行</dt><dd>${schedule.badRows.length}</dd>
                  </dl>`
                : '<div class="muted" style="font-size:11.5px">工程表CSVはまだ読み込まれていません（4D表示に必要です）。</div>'
            }
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('layers')}図面プレビュー
            <span class="r">ドラッグで移動・ホイールで拡大</span>
          </div>
          <div class="card-body tight">
            ${
              drawing
                ? `<div class="preview" data-preview>
                     <div data-pv-svg></div>
                     <div class="pv-tools"><button class="btn s" type="button" data-pv-fit>フィット</button></div>
                   </div>`
                : `<div class="preview" style="display:grid;place-items:center;height:320px;color:var(--mute)">図面を読み込むとプレビューを表示します</div>`
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('alert')}警告・確認事項 <span class="r">${warnings.length} 件</span></div>
          <div class="card-body">
            ${
              warnings.length === 0
                ? '<div class="muted" style="font-size:11.5px">警告はありません。</div>'
                : `<div class="warn-list" data-testid="warning-list">${warnings
                    .map(
                      (warning) =>
                        `<div class="warn ${warning.kind === 'error' ? 'error' : ''}">${icon('alert')}<div>${escapeHtml(warning.text)}</div></div>`,
                    )
                    .join('')}</div>`
            }
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function loadingBlock(message: string): string {
  return `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(message || '読み込み中…')}</span></div>`;
}

function dropzoneBlock(): string {
  return `<div class="dropzone" data-dropzone data-testid="dropzone">
    <div><svg class="i big" aria-hidden="true"><use href="#i-upload"></use></svg>
      <b>DXFや工程表CSVを、ここにドラッグ＆ドロップ</b>
      <span class="sub">または下のボタンから選びます。読み込みはこのパソコンの中だけで行います。</span>
      <div class="row">
        <button class="btn" type="button" data-action="pick">${icon('file')}ファイルを選ぶ</button>
        <button class="btn acc" type="button" data-action="sample" data-testid="load-sample">${icon('wand')}サンプル図面で試す</button>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="btn s" type="button" data-action="dl-dxf">${icon('download')}サンプルDXF</button>
        <button class="btn s" type="button" data-action="dl-csv">${icon('download')}サンプル工程表CSV</button>
      </div>
    </div>
    <input id="file-input" data-testid="file-input" type="file" accept=".dxf,.csv,text/csv,application/dxf" multiple hidden>
  </div>`;
}

function format(name: string, status: string, tone: 'green' | 'navy' | 'mute', detail: string): string {
  return `<div class="format"><span class="tag ${tone}">${status}</span><b>${name}</b><span class="muted">${detail}</span></div>`;
}

export function mountImport(ctx: AppContext, root: HTMLElement): void {
  const { state } = ctx;
  const dropzone = root.querySelector<HTMLElement>('[data-dropzone]');
  const input = root.querySelector<HTMLInputElement>('#file-input');

  const pick = () => input?.click();
  root.querySelector('[data-action="pick"]')?.addEventListener('click', pick);
  root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    if (!state.drawing) {
      ctx.toast('warn', '先にDXFを読み込んでください。');
      return;
    }
    ctx.setStep(2);
  });
  root.querySelector('[data-action="dl-dxf"]')?.addEventListener('click', () =>
    downloadText('seawall_plan.dxf', sampleDxf, 'application/dxf'),
  );
  root.querySelector('[data-action="dl-csv"]')?.addEventListener('click', () =>
    downloadText('schedule.csv', sampleScheduleCsv, 'text/csv'),
  );
  root.querySelector('[data-action="sample"]')?.addEventListener('click', () => {
    void loadSample(ctx);
  });

  if (dropzone) {
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('over');
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void loadFiles(ctx, files);
    });
  }
  input?.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) void loadFiles(ctx, files);
  });

  const preview = root.querySelector<HTMLElement>('[data-preview]');
  if (preview && state.drawing) {
    mountPlanPreview(preview, state.drawing, state.highlightLayer);
  }
}

async function loadSample(ctx: AppContext): Promise<void> {
  ctx.state.busy = true;
  ctx.state.busyMessage = 'サンプル図面を解析しています…';
  ctx.state.importError = null;
  ctx.refresh();
  try {
    const drawing = parseDxf(sampleDxf, 'seawall_plan.dxf');
    const schedule = parseScheduleCsv(sampleScheduleCsv, 'schedule.csv');
    applyDrawing(ctx, drawing, {
      filename: 'seawall_plan.dxf',
      sizeBytes: new Blob([sampleDxf]).size,
    });
    applySchedule(ctx, schedule);
    ctx.state.sampleLoaded = true;
    ctx.toast('ok', 'サンプル図面（架空）を読み込みました。');
  } catch (error) {
    ctx.state.importError = `サンプルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
    ctx.toast('err', ctx.state.importError);
  } finally {
    ctx.state.busy = false;
    ctx.state.busyMessage = '';
    ctx.refresh();
  }
}

async function loadFiles(ctx: AppContext, files: File[]): Promise<void> {
  ctx.state.busy = true;
  ctx.state.busyMessage = 'ファイルを解析しています…';
  ctx.state.importError = null;
  ctx.refresh();
  let drawingLoaded = false;
  let scheduleLoaded = false;
  try {
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.dxf')) {
        const buffer = await file.arrayBuffer();
        const text = decodeDxfBuffer(buffer);
        const drawing = parseDxf(text, file.name);
        const sha256 = await digest(buffer);
        applyDrawing(ctx, drawing, { filename: file.name, sizeBytes: file.size, sha256 });
        drawingLoaded = true;
      } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const schedule = parseScheduleCsv(await file.text(), file.name);
        applySchedule(ctx, schedule);
        scheduleLoaded = true;
      } else {
        throw new Error(`未対応のファイル形式です: ${file.name}（DXFまたはCSVを選んでください）`);
      }
    }
    ctx.state.sampleLoaded = false;
    ctx.toast('ok', `読み込みました${drawingLoaded ? '（図面）' : ''}${scheduleLoaded ? '（工程表）' : ''}。`);
  } catch (error) {
    ctx.state.importError = `ERR-101/102: ${error instanceof Error ? error.message : String(error)}`;
    ctx.toast('err', ctx.state.importError);
  } finally {
    ctx.state.busy = false;
    ctx.state.busyMessage = '';
    ctx.refresh();
  }
}

function applyDrawing(
  ctx: AppContext,
  drawing: ReturnType<typeof parseDxf>,
  source: { filename: string; sizeBytes: number; sha256?: string },
): void {
  const { state } = ctx;
  state.drawing = drawing;
  state.drawingSource = source;
  state.assignments = estimateAssignments(drawing, state.dictionary);
  state.learnFlags = Object.fromEntries(state.assignments.map((assignment) => [assignment.layer, true]));
  state.elevations = defaultElevations();
  state.parts = [];
  state.buildWarnings = [];
  state.buildUnmatched = [];
  state.timeline = null;
  state.currentDate = 0;
  state.highlightLayer = null;
  state.selectedPartId = null;
  state.filterUnconfirmed = false;
  state.caseMeta = {
    ...state.caseMeta,
    name: source.filename.replace(/\.[^.]+$/, ''),
  };
}

function applySchedule(ctx: AppContext, schedule: ReturnType<typeof parseScheduleCsv>): void {
  ctx.state.schedule = schedule;
  ctx.state.scheduleSourceName = schedule.sourceName;
  ctx.state.timeline = null;
  ctx.state.currentDate = 0;
}

async function digest(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}
