import type { Part } from '../../core/types.js';
import { workTypeByCode } from '../../core/worktype/defaults.js';
import { totalArea } from '../../core/geometry/parts.js';
import type { AppContext } from '../context.js';
import { StudioScene, type ViewPreset } from '../scene.js';
import { escapeHtml, fmtArea, fmtElevation, icon } from '../ui.js';

const VIEW_LABELS: Record<ViewPreset, string> = {
  iso: '斜め',
  sea: '海側',
  top: '上空',
  section: '断面',
};

export function renderGenerate(ctx: AppContext): string {
  const { state } = ctx;
  if (!state.drawing) {
    return `<section class="view"><div class="empty"><b>図面がありません</b>先にSCR-01でDXFを読み込んでください。<div style="margin-top:10px"><button class="btn" type="button" data-action="back">SCR-01へ戻る</button></div></div></section>`;
  }
  const counts = countByWorkType(state.parts);
  const hasParts = state.parts.length > 0;

  return `
  <section class="view" data-testid="screen-generate">
    <div class="view-head">
      <span class="hi">${icon('cube')}</span>
      <div>
        <div class="eyebrow">STEP 04 / BUILD</div>
        <h1>4　3D生成</h1>
        <p>確定した工種と標高から、閉じた輪郭を押し出して3D部材を作ります。警告を確認してから4Dへ進んでください。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn p" type="button" data-action="next" data-testid="next" ${hasParts ? '' : 'disabled'}>4D表示へ ${icon('arrow')}</button>
    </div>

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('cube')}生成結果
            <span class="r">${hasParts ? `${state.parts.length} 部材` : '未生成'}</span>
          </div>
          <div class="card-body">
            ${
              hasParts
                ? `<div class="stats">
                     <div class="stat"><small>3D部材</small><b data-testid="part-count">${state.parts.length}</b></div>
                     <div class="stat"><small>工種</small><b>${counts.size}</b></div>
                     <div class="stat"><small>面積合計</small><b style="font-size:14px">${fmtArea(totalArea(state.parts))}</b></div>
                     <div class="stat"><small>工程対応</small><b>${state.buildUnmatched.length === 0 ? 'OK' : `${state.buildUnmatched.length} 未対応`}</b></div>
                   </div>
                   <div style="margin-top:10px"><button class="btn" type="button" data-action="generate">${icon('refresh')}再生成</button></div>`
                : `<div class="empty"><b>まだ3D部材がありません</b>工種と標高を確認してから生成してください。
                     <div style="margin-top:10px"><button class="btn p" type="button" data-action="generate" data-testid="generate">${icon('cube')}3Dを生成</button></div>
                   </div>`
            }
            ${
              state.buildWarnings.length > 0
                ? `<div class="warn-list" style="margin-top:12px" data-testid="warning-list">
                     ${state.buildWarnings
                       .map(
                         (warning) =>
                           `<div class="warn">${icon('alert')}<div><b>${escapeHtml(warning.layer)}</b>: ${escapeHtml(warning.reason)}${warning.detail ? `<div class="row-sub">${escapeHtml(warning.detail)}</div>` : ''}</div></div>`,
                       )
                       .join('')}
                   </div>`
                : hasParts
                  ? '<div class="pill ok" style="margin-top:12px">警告なし</div>'
                  : ''
            }
            ${
              state.buildUnmatched.length > 0
                ? `<div class="warn" style="margin-top:10px">${icon('alert')}<div>工程表と対応しない工種: ${state.buildUnmatched.map((code) => `${code} ${escapeHtml(workTypeByCode(code)?.name ?? '')}`).join('、')}</div></div>`
                : ''
            }
            ${state.schedule ? '' : '<div class="warn" style="margin-top:10px">' + icon('alert') + '<div>工程表が読み込まれていません。3Dは生成できますが、4D再生には工程表が必要です。</div></div>'}
          </div>
        </div>

        ${
          hasParts
            ? `<div class="card">
                 <div class="card-head">${icon('layers')}工種別</div>
                 <div class="card-body tight">
                   <div class="table-wrap">
                     <table class="data">
                       <thead><tr><th>工種</th><th class="num">部材</th><th class="num">面積</th><th class="num">天端</th><th class="num">底面</th></tr></thead>
                       <tbody>
                         ${[...counts.entries()]
                           .sort(([a], [b]) => a.localeCompare(b))
                           .map(([code, parts]) => {
                             const workType = workTypeByCode(code);
                             const sample = parts[0];
                             return `<tr><td><div class="row-title">${code}</div><div class="row-sub">${escapeHtml(workType?.name ?? '')}</div></td><td class="num">${parts.length}</td><td class="num">${fmtArea(parts.reduce((sum, part) => sum + part.area, 0))}</td><td class="num">${sample ? fmtElevation(sample.top) : '—'}</td><td class="num">${sample ? fmtElevation(sample.bottom) : '—'}</td></tr>`;
                           })
                           .join('')}
                       </tbody>
                     </table>
                   </div>
                 </div>
               </div>`
            : ''
        }
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('cube')}3Dプレビュー<span class="r">回転・ズーム</span></div>
          <div class="card-body tight">
            ${
              hasParts
                ? `<div class="stage stage-3d" data-stage>
                     <canvas data-canvas aria-label="3Dプレビュー"></canvas>
                     <div class="overlay">
                       ${(Object.keys(VIEW_LABELS) as ViewPreset[]).map((preset) => `<button class="btn s" type="button" data-view="${preset}">${VIEW_LABELS[preset]}</button>`).join('')}
                     </div>
                     <span class="hint">ドラッグで回転 / ホイールで拡大</span>
                   </div>`
                : '<div class="empty" style="padding:60px 20px"><b>3Dを生成するとここに表示します</b></div>'
            }
          </div>
        </div>
        <div class="card">
          <div class="card-head">${icon('alert')}生成の規則</div>
          <div class="card-body" style="font-size:11.5px;color:var(--sub)">
            <p>・閉じた平面の輪郭を、標高の範囲で押し出します（方式A）。</p>
            <p>・終点と始点が0.5mまたは周長1%以内で開いている輪郭は、自動で閉じて警告を残します。</p>
            <p>・円は円柱として生成します（係船柱など）。</p>
            <p>・工程表と工種コード/名称で対応しない部材は4Dで表示されません。</p>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function mountGenerate(ctx: AppContext, root: HTMLElement): void {
  const { state } = ctx;
  if (!state.drawing) {
    root.querySelector('[data-action="back"]')?.addEventListener('click', () => ctx.setStep(1));
    return;
  }

  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]');
  let scene: StudioScene | null = null;
  if (canvas && state.parts.length > 0) {
    try {
      scene = new StudioScene(canvas, state.workTypes, state.theme);
      scene.setParts(state.parts);
      scene.setView('iso');
    } catch (error) {
      const stage = root.querySelector('[data-stage]');
      if (stage) {
        stage.innerHTML = `<div class="webgl-error"><b>3D表示を初期化できませんでした</b><div>${escapeHtml(error instanceof Error ? error.message : 'WebGL2対応ブラウザで開いてください。')}</div></div>`;
      }
    }
  }
  if (scene) ctx.setCleanup(() => scene?.dispose());

  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => scene?.setView((button.dataset.view ?? 'iso') as ViewPreset));
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="generate"]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.ensureParts();
      ctx.refresh();
    });
  });

  root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    if (state.parts.length === 0) {
      ctx.toast('warn', '先に3Dを生成してください。');
      return;
    }
    if (!state.schedule) {
      ctx.toast('warn', '工程表がありません。4D再生には工程表CSVが必要です。');
      return;
    }
    ctx.setStep(5);
  });
}

function countByWorkType(parts: Part[]): Map<string, Part[]> {
  const map = new Map<string, Part[]>();
  for (const part of parts) {
    const list = map.get(part.workTypeCode);
    if (list) list.push(part);
    else map.set(part.workTypeCode, [part]);
  }
  return map;
}
