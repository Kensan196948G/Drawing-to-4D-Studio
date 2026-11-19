import type { ElevationNote } from '../../core/worktype/elevation.js';
import {
  applyElevationNotes,
  extractElevationNotes,
  validateElevations,
} from '../../core/worktype/elevation.js';
import { workTypeByCode } from '../../core/worktype/defaults.js';
import type { AppContext } from '../context.js';
import { escapeHtml, fmtElevation, icon } from '../ui.js';

const SEQUENCE_LABELS: Record<string, string> = {
  extend: '延長方向に伸ばす',
  each: '1つずつ据える',
  stack: '下から積み上げる',
  instant: '開始日に表示',
};

const SOURCE_LABELS: Record<string, string> = {
  default: '初期値',
  note: '注記',
  manual: '手動',
};

export function renderElevation(ctx: AppContext): string {
  const { state } = ctx;
  if (!state.drawing) {
    return `<section class="view"><div class="empty"><span class="empty-ico">${icon('upload')}</span><b>図面がありません</b>先にSCR-01でDXFを読み込んでください。<div class="empty-actions"><button class="btn" type="button" data-action="back">${icon('arrow')}SCR-01へ戻る</button></div></div></section>`;
  }
  const notes = extractElevationNotes(state.drawing);
  const errors = validateElevations(state.elevations);
  const enabledCount = state.elevations.filter((entry) => entry.enabled).length;

  return `
  <section class="view" data-testid="screen-elevation">
    <div class="view-head">
      <span class="hi">${icon('arrow')}</span>
      <div>
        <div class="eyebrow">STEP 03 / ELEVATION</div>
        <h1>3　高さの付与</h1>
        <p>平面図には高さがありません。断面図の標高注記を候補として示します。工種ごとに天端・底面を確定してください。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn p" type="button" data-action="next" data-testid="next">3D生成へ ${icon('arrow')}</button>
    </div>

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('layers')}標高表
            <span class="r">3D対象 ${enabledCount} 工種</span>
          </div>
          <div class="card-body tight">
            <div class="table-wrap">
              <table class="data" data-testid="elevation-table">
                <thead><tr><th>対象</th><th>工種</th><th class="num">天端 (m)</th><th class="num">底面 (m)</th><th>進行方向</th><th>根拠</th></tr></thead>
                <tbody>
                  ${state.elevations
                    .map((entry) => {
                      const workType = workTypeByCode(entry.workTypeCode);
                      const entryErrors = errors.filter((error) =>
                        error.startsWith(workType?.name ?? entry.workTypeCode),
                      );
                      return `<tr data-elev-row="${entry.workTypeCode}" class="${entryErrors.length > 0 ? 'excluded' : ''}">
                        <td><label class="check"><input type="checkbox" data-elev-enabled="${entry.workTypeCode}" data-testid="enabled-${entry.workTypeCode}" ${entry.enabled ? 'checked' : ''} aria-label="${escapeHtml(workType?.name ?? '')}を3D化する">3D</label></td>
                        <td><div class="row-title">${entry.workTypeCode}</div><div class="row-sub">${escapeHtml(workType?.name ?? '')}</div></td>
                        <td class="num"><input type="number" step="0.01" inputmode="decimal" value="${entry.top.toFixed(2)}" data-elev-top="${entry.workTypeCode}" data-testid="top-${entry.workTypeCode}" aria-label="${escapeHtml(workType?.name ?? '')}の天端" ${entry.enabled ? '' : 'disabled'}></td>
                        <td class="num"><input type="number" step="0.01" inputmode="decimal" value="${entry.bottom.toFixed(2)}" data-elev-bottom="${entry.workTypeCode}" data-testid="bottom-${entry.workTypeCode}" aria-label="${escapeHtml(workType?.name ?? '')}の底面" ${entry.enabled ? '' : 'disabled'}></td>
                        <td>
                          <select data-elev-seq="${entry.workTypeCode}" data-testid="sequence-${entry.workTypeCode}" aria-label="${escapeHtml(workType?.name ?? '')}の進行方向" ${entry.enabled ? '' : 'disabled'}>
                            ${Object.entries(SEQUENCE_LABELS)
                              .map(
                                ([value, label]) =>
                                  `<option value="${value}" ${entry.sequence === value ? 'selected' : ''}>${label}</option>`,
                              )
                              .join('')}
                          </select>
                        </td>
                        <td><span class="pill ${entry.source === 'note' ? 'info' : entry.source === 'manual' ? 'human' : 'mute'}">${SOURCE_LABELS[entry.source] ?? entry.source}</span></td>
                      </tr>
                      ${entryErrors.map((error) => `<tr><td colspan="6" style="color:var(--red);font-size:11px;padding-left:16px">${escapeHtml(error)}</td></tr>`).join('')}`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('file')}断面の標高注記
            <span class="r">${notes.length} 件</span>
          </div>
          <div class="card-body">
            ${
              notes.length === 0
                ? `<div class="empty" style="padding:18px"><span class="empty-ico" style="width:42px;height:42px">${icon('ruler')}</span><b>標高注記が見つかりません</b>断面図の文字、または左の表へ直接入力してください。</div>`
                : `<div class="note-list" data-testid="note-list">
                     ${notes
                       .map(
                         (note) => `<div class="note">
                           <svg class="i" aria-hidden="true" style="color:var(--navy)"><use href="#i-ruler"></use></svg>
                           <span class="txt" title="${escapeHtml(note.source)}">${escapeHtml(note.source)}</span>
                           <span class="val">${fmtElevation(note.value)}</span>
                           ${note.workTypeCode ? `<button class="btn s" type="button" data-apply-note="${note.id}" aria-label="${escapeHtml(note.source)}を反映">反映</button>` : '<span class="pill mute">未対応</span>'}
                         </div>`,
                       )
                       .join('')}
                   </div>
                   <div style="margin-top:8px"><button class="btn" type="button" data-action="apply-all" data-testid="apply-all-notes">すべて反映</button></div>`
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head">${icon('alert')}確認</div>
          <div class="card-body" style="font-size:11.5px;color:var(--sub)">
            <p>・天端は底面より高い必要があります。高低差100m超は入力ミスとして扱います。</p>
            <p>・準備工・片付けは立体を持たないため、初期状態では3D対象外です。</p>
            <p>・進行方向は「延長方向に伸ばす」「1つずつ据える」「下から積み上げる」「開始日に表示」から選べます。</p>
            ${errors.length > 0 ? `<div class="warn error" style="margin-top:8px">${icon('alert')}<div>${errors.length} 件の入力を修正してください。</div></div>` : ''}
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function mountElevation(ctx: AppContext, root: HTMLElement): void {
  const { state } = ctx;
  if (!state.drawing) {
    root.querySelector('[data-action="back"]')?.addEventListener('click', () => ctx.setStep(1));
    return;
  }
  const notes = extractElevationNotes(state.drawing);

  root.querySelectorAll<HTMLInputElement>('[data-elev-enabled]').forEach((input) => {
    input.addEventListener('change', () => {
      const code = input.dataset.elevEnabled;
      const entry = state.elevations.find((item) => item.workTypeCode === code);
      if (!entry) return;
      entry.enabled = input.checked;
      if (input.checked && entry.source === 'default') entry.source = 'manual';
      ctx.refresh();
    });
  });

  root.querySelectorAll<HTMLInputElement>('[data-elev-top], [data-elev-bottom]').forEach((input) => {
    input.addEventListener('change', () => {
      const code = input.dataset.elevTop ?? input.dataset.elevBottom;
      if (!code) return;
      const entry = state.elevations.find((item) => item.workTypeCode === code);
      if (!entry) return;
      const value = Number.parseFloat(input.value);
      if (!Number.isFinite(value)) {
        ctx.toast('warn', '数値を入力してください。');
        ctx.refresh();
        return;
      }
      if (input.dataset.elevTop) entry.top = value;
      else entry.bottom = value;
      entry.source = 'manual';
      if (entry.enabled && entry.top < entry.bottom) {
        [entry.top, entry.bottom] = [entry.bottom, entry.top];
        ctx.toast('warn', '天端と底面を入れ替えました。');
      }
      ctx.refresh();
    });
  });

  root.querySelectorAll<HTMLSelectElement>('[data-elev-seq]').forEach((select) => {
    select.addEventListener('change', () => {
      const code = select.dataset.elevSeq;
      const entry = state.elevations.find((item) => item.workTypeCode === code);
      if (!entry) return;
      entry.sequence = select.value as typeof entry.sequence;
      ctx.refresh();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-apply-note]').forEach((button) => {
    button.addEventListener('click', () => {
      const noteId = button.dataset.applyNote;
      const note = notes.find((item) => item.id === noteId);
      if (!note) return;
      applyNotes(ctx, [note]);
    });
  });
  root.querySelector('[data-action="apply-all"]')?.addEventListener('click', () => applyNotes(ctx, notes));

  root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    const errors = validateElevations(state.elevations);
    if (errors.length > 0) {
      ctx.toast('err', errors[0] ?? '標高を確認してください。');
      return;
    }
    if (!state.elevations.some((entry) => entry.enabled)) {
      ctx.toast('warn', '3D化する工種を1つ以上選んでください。');
      return;
    }
    ctx.setStep(4);
  });
}

function applyNotes(ctx: AppContext, notes: ElevationNote[]): void {
  const { state } = ctx;
  const { elevations, applied } = applyElevationNotes(state.elevations, notes);
  state.elevations = elevations;
  if (applied.length === 0) {
    ctx.toast('warn', '反映できる注記がありません（対応工種が未確定です）。');
  } else {
    ctx.toast('ok', `${applied.length} 件の注記を反映しました。`);
  }
  ctx.refresh();
}
