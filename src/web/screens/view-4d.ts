import { addDays, dateFromInput, diffDays } from '../../core/schedule/csv.js';
import { computePartProgress, makeTimeline, unmatchedSummary } from '../../core/timeline/model.js';
import { workTypeByCode } from '../../core/worktype/defaults.js';
import type { PartProgress } from '../../core/types.js';
import type { AppContext } from '../context.js';
import { StudioScene, type ViewPreset } from '../scene.js';
import { clamp, escapeHtml, fmtDate, fmtDateInput, fmtElevation, icon } from '../ui.js';

const VIEW_LABELS: Record<ViewPreset, string> = {
  iso: '斜め',
  sea: '海側',
  top: '上空',
  section: '断面',
};

export function renderView4d(ctx: AppContext): string {
  const { state } = ctx;
  if (!state.drawing || state.parts.length === 0) {
    return `<section class="view"><div class="empty"><span class="empty-ico">${icon('cube')}</span><b>3D部材がありません</b>SCR-04で3Dを生成してください。<div class="empty-actions"><button class="btn" type="button" data-action="back">${icon('arrow')}3D生成へ戻る</button></div></div></section>`;
  }
  if (!state.schedule) {
    return `<section class="view"><div class="empty"><span class="empty-ico">${icon('calendar')}</span><b>工程表がありません</b>4D再生には工程表CSVが必要です。SCR-01で読み込んでください。<div class="empty-actions"><button class="btn" type="button" data-action="back">${icon('arrow')}SCR-01へ戻る</button></div></div></section>`;
  }
  const timeline = state.timeline ?? makeTimeline(state.schedule.rows);
  const totalDays = Math.max(1, diffDays(timeline.start, timeline.end));
  const day = clamp(diffDays(timeline.start, state.currentDate || timeline.start), 0, totalDays);
  const codes = [...new Set(state.parts.map((part) => part.workTypeCode))].sort();
  const unmatched = unmatchedSummary(state.parts, state.schedule.rows);
  const sortedRows = [...state.schedule.rows].sort((a, b) => a.start - b.start);
  const partRows = [...state.parts]
    .sort((a, b) => a.workTypeCode.localeCompare(b.workTypeCode) || a.ordinal - b.ordinal)
    .slice(0, 200);

  return `
  <section class="view" data-testid="screen-4d">
    <div class="view-head">
      <span class="hi">${icon('cube')}</span>
      <div>
        <div class="eyebrow">STEP 05 / 4D</div>
        <h1>5　4D表示</h1>
        <p>工程表の日付に合わせて施工の順に部材を表示します。再生・日付移動・視点変更ができます。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn" type="button" data-action="save" data-testid="save">${icon('save')}保存</button>
    </div>

    <div class="view-4d">
      <div class="stack">
        <div class="stage stage-4d" data-stage>
          <canvas data-canvas data-testid="canvas-3d" aria-label="4D表示（3Dビュー）"></canvas>
          <div class="overlay">
            ${(Object.keys(VIEW_LABELS) as ViewPreset[]).map((preset) => `<button class="btn s" type="button" data-view="${preset}" data-testid="view-${preset}">${VIEW_LABELS[preset]}</button>`).join('')}
            <button class="btn s" type="button" data-action="fit">フィット</button>
          </div>
          <span class="hint">ドラッグで回転 / ホイールで拡大</span>
        </div>

        <div class="timeline" data-timeline>
          <div class="tl-row">
            <button class="btn p" type="button" data-action="play" data-testid="play" data-playing="false" aria-label="再生">
              <svg class="i" aria-hidden="true"><use href="#i-play"></use></svg><span data-play-label>再生</span>
            </button>
            <div>
              <div class="tl-date" data-date>${fmtDate(state.currentDate || timeline.start)}</div>
              <div class="tl-meta">${fmtDate(timeline.start)} – ${fmtDate(timeline.end - 86_400_000)}</div>
            </div>
            <input class="tl-range" type="range" min="0" max="${totalDays}" step="1" value="${day}" data-testid="date-slider" aria-label="日付スライダー">
            <input type="date" value="${fmtDateInput(state.currentDate || timeline.start)}" data-testid="date-input" aria-label="日付">
            <select data-testid="speed" aria-label="再生速度">
              ${[1, 2, 7, 30].map((speed) => `<option value="${speed}" ${state.speed === speed ? 'selected' : ''}>${speed}日/秒</option>`).join('')}
            </select>
          </div>
          <div class="gantt" data-gantt data-testid="gantt">
            ${sortedRows
              .map((row) => {
                const left = clamp(
                  ((row.start - timeline.start) / (timeline.end - timeline.start)) * 100,
                  0,
                  100,
                );
                const width = clamp(
                  ((row.end - row.start) / (timeline.end - timeline.start)) * 100,
                  0.4,
                  100 - left,
                );
                const workType = row.code ? workTypeByCode(row.code) : undefined;
                const color = workType?.color ?? '#6b7f8f';
                return `<div class="gantt-row" data-gantt-start="${row.start}">
                  <span class="gantt-label" title="${escapeHtml(row.name)}">${row.code ? `<b class="mono">${escapeHtml(row.code)}</b> ` : ''}${escapeHtml(row.name)}</span>
                  <span class="gantt-track"><span class="gantt-bar" style="left:${left}%;width:${width}%;background:${color}"></span></span>
                </div>`;
              })
              .join('')}
            <span class="gantt-now" data-now style="left:${(day / totalDays) * 100}%"></span>
          </div>
        </div>
      </div>

      <div class="side">
        <div class="card">
          <div class="card-head">${icon('layers')}凡例</div>
          <div class="card-body">
            <div class="legend" data-legend>
              ${codes
                .map((code) => {
                  const workType = workTypeByCode(code);
                  return `<button class="legend-item ${state.highlightCode === code ? 'on' : ''}" type="button" data-legend-code="${code}"><i style="background:${workType?.color ?? '#6b7f8f'}"></i>${code} ${escapeHtml(workType?.name ?? '')}</button>`;
                })
                .join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('layers')}部材
            <span class="r">${state.parts.length} 件</span>
          </div>
          <div class="card-body tight">
            <div class="part-list" data-part-list>
              ${partRows
                .map((part) => {
                  const workType = workTypeByCode(part.workTypeCode);
                  return `<button class="part-item ${state.selectedPartId === part.id ? 'on' : ''}" type="button" data-part-id="${escapeHtml(part.id)}">
                    <i style="background:${workType?.color ?? '#6b7f8f'}"></i>
                    <span class="pname">${escapeHtml(part.layer)} / ${escapeHtml(workType?.name ?? part.workTypeCode)}</span>
                    <span class="pval">${fmtElevation(part.top)}</span>
                  </button>`;
                })
                .join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('info')}操作のヒント</div>
          <div class="card-body" style="font-size:11.5px;color:var(--sub)">
            ${state.buildWarnings.length > 0 ? `<div class="warn" style="margin-bottom:8px">${icon('alert')}<div>${state.buildWarnings.length} 件の生成警告があります（SCR-04で確認）。</div></div>` : ''}
            ${unmatched.unmatchedCodes.length > 0 ? `<div class="warn" style="margin-bottom:8px">${icon('alert')}<div>工程表と対応しない工種: ${unmatched.unmatchedCodes.join('、')}</div></div>` : ''}
            <p>・スペースで再生/停止、←→で1日移動できます。</p>
            <p>・初期表示は工程表の開始日です。</p>
            <p>・図面・工程・確定内容は「保存」でブラウザに保存できます。</p>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function mountView4d(ctx: AppContext, root: HTMLElement): void {
  const { state } = ctx;
  if (!state.drawing || state.parts.length === 0 || !state.schedule) {
    root.querySelector('[data-action="back"]')?.addEventListener('click', () => ctx.setStep(4));
    return;
  }
  const timeline = state.timeline ?? makeTimeline(state.schedule.rows);
  state.timeline = timeline;
  if (!state.currentDate || state.currentDate < timeline.start || state.currentDate > timeline.end) {
    state.currentDate = timeline.start;
  }

  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]');
  let scene: StudioScene | null = null;
  if (canvas) {
    try {
      scene = new StudioScene(canvas, state.workTypes, state.theme);
      scene.setParts(state.parts);
      scene.setView('iso');
    } catch (error) {
      const stage = root.querySelector('[data-stage]');
      if (stage) {
        stage.innerHTML = `<div class="webgl-error"><b>4D表示を初期化できませんでした</b><div>${escapeHtml(error instanceof Error ? error.message : 'WebGL2対応ブラウザで開いてください。')}</div></div>`;
      }
    }
  }

  const dateEl = root.querySelector<HTMLElement>('[data-date]');
  const slider = root.querySelector<HTMLInputElement>('[data-testid="date-slider"]');
  const dateInput = root.querySelector<HTMLInputElement>('[data-testid="date-input"]');
  const nowLine = root.querySelector<HTMLElement>('[data-now]');
  const playButton = root.querySelector<HTMLButtonElement>('[data-action="play"]');
  const playLabel = root.querySelector<HTMLElement>('[data-play-label]');
  const totalDays = Math.max(1, diffDays(timeline.start, timeline.end));

  const update = () => {
    const day = clamp(diffDays(timeline.start, state.currentDate), 0, totalDays);
    if (dateEl) {
      dateEl.textContent = fmtDate(state.currentDate);
      dateEl.classList.remove('bump');
      void dateEl.offsetWidth;
      dateEl.classList.add('bump');
    }
    if (slider) slider.value = String(day);
    if (dateInput) dateInput.value = fmtDateInput(state.currentDate);
    if (nowLine) nowLine.style.left = `${(day / totalDays) * 100}%`;
    const progress: PartProgress[] = computePartProgress(
      state.parts,
      state.schedule?.rows ?? [],
      state.currentDate,
    );
    scene?.update(progress);
  };

  const setPlaying = (playing: boolean) => {
    state.playing = playing;
    if (playButton) {
      playButton.setAttribute('aria-label', playing ? '停止' : '再生');
      playButton.setAttribute('data-playing', playing ? 'true' : 'false');
    }
    if (playLabel) playLabel.textContent = playing ? '停止' : '再生';
    const use = playButton?.querySelector('use');
    use?.setAttribute('href', playing ? '#i-pause' : '#i-play');
  };

  let raf = 0;
  let last = 0;
  const tick = (timestamp: number) => {
    raf = requestAnimationFrame(tick);
    if (!state.playing) {
      last = 0;
      return;
    }
    if (!last) last = timestamp;
    const delta = Math.min(0.1, (timestamp - last) / 1000);
    last = timestamp;
    state.currentDate += delta * state.speed * 86_400_000;
    if (state.currentDate >= timeline.end) state.currentDate = timeline.start;
    update();
  };
  raf = requestAnimationFrame(tick);

  const togglePlay = () => {
    setPlaying(!state.playing);
    update();
  };
  playButton?.addEventListener('click', togglePlay);
  slider?.addEventListener('input', () => {
    state.currentDate = addDays(timeline.start, Number.parseInt(slider.value, 10) || 0);
    update();
  });
  dateInput?.addEventListener('change', () => {
    const parsed = dateFromInput(dateInput.value);
    if (parsed !== null) {
      state.currentDate = clamp(parsed, timeline.start, timeline.end);
      update();
    }
  });
  root.querySelector<HTMLSelectElement>('[data-testid="speed"]')?.addEventListener('change', (event) => {
    const value = Number.parseInt((event.target as HTMLSelectElement).value, 10);
    state.speed = (
      value === 1 || value === 2 || value === 7 || value === 30 ? value : 7
    ) as typeof state.speed;
  });

  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => scene?.setView((button.dataset.view ?? 'iso') as ViewPreset));
  });
  root.querySelector('[data-action="fit"]')?.addEventListener('click', () => scene?.fit());
  root.querySelector('[data-action="save"]')?.addEventListener('click', () => ctx.openSave());

  root.querySelectorAll<HTMLButtonElement>('[data-legend-code]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = button.dataset.legendCode ?? null;
      state.highlightCode = state.highlightCode === code ? null : code;
      scene?.highlightWorkType(state.highlightCode);
      root.querySelectorAll('[data-legend-code]').forEach((element) => {
        element.classList.toggle('on', element.getAttribute('data-legend-code') === state.highlightCode);
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-part-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.partId ?? null;
      state.selectedPartId = state.selectedPartId === id ? null : id;
      scene?.highlight(state.selectedPartId);
      root.querySelectorAll('[data-part-id]').forEach((element) => {
        element.classList.toggle('on', element.getAttribute('data-part-id') === state.selectedPartId);
      });
    });
  });

  root.querySelectorAll<HTMLElement>('[data-gantt-start]').forEach((row) => {
    row.addEventListener('click', () => {
      const start = Number.parseInt(row.dataset.ganttStart ?? '', 10);
      if (Number.isFinite(start)) {
        state.currentDate = clamp(start, timeline.start, timeline.end);
        update();
      }
    });
  });

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      state.currentDate = clamp(addDays(state.currentDate, -1), timeline.start, timeline.end);
      update();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      state.currentDate = clamp(addDays(state.currentDate, 1), timeline.start, timeline.end);
      update();
    }
  };
  document.addEventListener('keydown', onKey);

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduceMotion && !state.playing) setPlaying(false);
  update();

  ctx.setCleanup(() => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    state.playing = false;
    scene?.dispose();
  });
}
