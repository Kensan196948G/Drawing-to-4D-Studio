import type { Assignment } from '../../core/types.js';
import { workTypeByCode } from '../../core/worktype/defaults.js';
import { bulkConfirm, learnLayerTerm } from '../../core/worktype/estimate.js';
import type { AppContext } from '../context.js';
import { mountPlanPreview } from '../plan-preview.js';
import { pendingCount, saveDictionary } from '../state.js';
import { escapeHtml, fmtPct, icon } from '../ui.js';

export function renderAssign(ctx: AppContext): string {
  const { state } = ctx;
  if (!state.drawing) {
    return emptyScreen(ctx, '図面がありません', '先にSCR-01でDXFを読み込んでください。');
  }
  const pending = pendingCount(state);
  const visible = state.assignments.filter((assignment) =>
    state.filterUnconfirmed ? !assignment.excluded && !assignment.confirmed : true,
  );
  const confirmed = state.assignments.filter(
    (assignment) => assignment.confirmed && !assignment.excluded && assignment.workTypeCode,
  ).length;

  return `
  <section class="view" data-testid="screen-assign">
    <div class="view-head">
      <span class="hi">${icon('layers')}</span>
      <div>
        <div class="eyebrow">STEP 02 / ASSIGN</div>
        <h1>2　工種の割り当て</h1>
        <p>レイヤごとに工種を確定します。推定は下書きです。確からしさが低い行ほど、目で確かめてください。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn p" type="button" data-action="next" data-testid="next">
        高さの付与へ ${icon('arrow')}
      </button>
    </div>

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('layers')}レイヤと工種
            <span class="r">確定 ${confirmed} / 未確定 <b data-testid="pending-count" style="color:var(--amber)">${pending}</b></span>
          </div>
          <div class="card-body tight">
            <div class="tl-row" style="padding:8px 12px;border-bottom:1px solid var(--line)">
              <button class="btn s" type="button" data-action="bulk" data-testid="bulk-confirm">信頼度80%以上を一括確定</button>
              <label class="check"><input type="checkbox" data-action="filter" ${state.filterUnconfirmed ? 'checked' : ''}>未確定のみ表示</label>
              <span class="muted" style="font-size:10.5px;margin-left:auto">${state.assignments.length} レイヤ</span>
            </div>
            <div class="table-wrap" style="max-height:520px">
              <table class="data" data-testid="layer-table">
                <thead><tr><th>レイヤ</th><th class="num">要素</th><th>工種</th><th class="num">確からしさ</th><th>確認</th><th>辞書</th></tr></thead>
                <tbody>
                  ${visible.map((assignment) => rowHtml(ctx, assignment)).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('eye')}プレビュー
            <span class="r">${state.highlightLayer ? `強調: ${escapeHtml(state.highlightLayer)}` : '行を選ぶと強調'}</span>
          </div>
          <div class="card-body tight">
            <div class="preview" data-preview>
              <div data-pv-svg></div>
              <div class="pv-tools"><button class="btn s" type="button" data-pv-fit>フィット</button></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">${icon('info')}確認のヒント</div>
          <div class="card-body" style="font-size:11.5px;color:var(--sub)">
            <p>・工種コード入りのレイヤ名（例: <code>4D_050_上部工</code>）は確からしさが高くなります。</p>
            <p>・DIM・法線・断面・文字のレイヤは「対象外」として除外しています。</p>
            <p>・手で工種を変えると、そのレイヤ名を辞書に登録できます。次回から同じ書き方の図面で自動割当されます。</p>
            ${pending > 0 ? `<div class="warn" style="margin-top:8px">${icon('alert')}<div>未確定のレイヤが ${pending} 件あります。未確定のまま進むと3D化されません。</div></div>` : ''}
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function rowHtml(ctx: AppContext, assignment: Assignment): string {
  const { state } = ctx;
  const workType = assignment.workTypeCode ? workTypeByCode(assignment.workTypeCode) : undefined;
  const total = Object.values(assignment.entityCounts).reduce((sum, value) => sum + value, 0);
  const confidenceTone = assignment.confidence >= 0.8 ? 'ok' : assignment.confidence >= 0.5 ? 'warn' : 'err';
  const candidateCodes = new Set(assignment.candidates.map((candidate) => candidate.workTypeCode));
  const candidateOptions = assignment.candidates
    .map((candidate) => {
      const candidateType = workTypeByCode(candidate.workTypeCode);
      return `<option value="${candidate.workTypeCode}" ${assignment.workTypeCode === candidate.workTypeCode ? 'selected' : ''}>${candidate.workTypeCode} ${escapeHtml(candidateType?.name ?? '')}（${fmtPct(candidate.confidence)}）</option>`;
    })
    .join('');
  const allOptions = state.workTypes
    .filter((item) => !candidateCodes.has(item.code))
    .map(
      (item) =>
        `<option value="${item.code}" ${assignment.workTypeCode === item.code ? 'selected' : ''}>${item.code} ${escapeHtml(item.name)}</option>`,
    )
    .join('');
  const selectedUnknown =
    assignment.workTypeCode && !state.workTypes.some((item) => item.code === assignment.workTypeCode)
      ? `<option value="${assignment.workTypeCode}" selected>${assignment.workTypeCode} ${escapeHtml(workType?.name ?? '')}（手動）</option>`
      : '';
  const note = assignment.notes.length > 0 ? ` / 注記: ${assignment.notes.slice(0, 2).join('・')}` : '';

  return `<tr data-testid="row-${escapeHtml(assignment.layer)}" class="${assignment.excluded ? 'excluded' : ''} ${state.highlightLayer === assignment.layer ? 'highlight' : ''}" data-layer="${escapeHtml(assignment.layer)}">
    <td>
      <div class="row-title">${escapeHtml(assignment.layer)}</div>
      <div class="row-sub">${escapeHtml(note)}</div>
    </td>
    <td class="num">${total}</td>
    <td>
      ${
        assignment.excluded
          ? '<span class="pill mute">対象外</span>'
          : `<select data-select="${escapeHtml(assignment.layer)}" data-testid="select-${escapeHtml(assignment.layer)}" aria-label="${escapeHtml(assignment.layer)}の工種">
               <option value="" ${assignment.workTypeCode ? '' : 'selected'}>未割当</option>
               ${selectedUnknown}
               ${candidateOptions ? `<optgroup label="推定候補">${candidateOptions}</optgroup>` : ''}
               <optgroup label="すべての工種">${allOptions}</optgroup>
               <option value="__excluded__">対象外にする</option>
             </select>`
      }
    </td>
    <td class="num">${
      assignment.excluded
        ? '—'
        : `<span class="conf" title="推定の確からしさ ${fmtPct(assignment.confidence)}">
             <span class="conf-track" aria-hidden="true"><i class="conf-fill ${confidenceTone}" style="width:${Math.round(assignment.confidence * 100)}%"></i></span>
             <span class="pill ${confidenceTone}">${fmtPct(assignment.confidence)}</span>
           </span>`
    }</td>
    <td>${
      assignment.excluded
        ? '—'
        : `<label class="check"><input type="checkbox" data-confirm="${escapeHtml(assignment.layer)}" data-testid="confirm-${escapeHtml(assignment.layer)}" ${assignment.confirmed ? 'checked' : ''} aria-label="${escapeHtml(assignment.layer)}を確定">確定</label>`
    }</td>
    <td>${
      assignment.excluded
        ? '—'
        : `<label class="check"><input type="checkbox" data-learn="${escapeHtml(assignment.layer)}" ${state.learnFlags[assignment.layer] !== false ? 'checked' : ''} aria-label="${escapeHtml(assignment.layer)}を辞書に登録">登録</label>`
    }</td>
  </tr>`;
}

export function mountAssign(ctx: AppContext, root: HTMLElement): void {
  const { state } = ctx;
  root.querySelectorAll<HTMLInputElement>('[data-learn]').forEach((input) => {
    input.addEventListener('change', () => {
      const layer = input.dataset.learn;
      if (layer) state.learnFlags[layer] = input.checked;
    });
  });

  root.querySelectorAll<HTMLSelectElement>('[data-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const layer = select.dataset.select;
      if (!layer) return;
      const assignment = state.assignments.find((item) => item.layer === layer);
      if (!assignment) return;
      if (select.value === '__excluded__') {
        assignment.excluded = true;
        assignment.workTypeCode = null;
        assignment.confirmed = true;
        assignment.source = 'manual';
        assignment.confidence = 0;
        ctx.refresh();
        return;
      }
      if (select.value === '') {
        assignment.workTypeCode = null;
        assignment.confirmed = false;
        assignment.source = 'none';
        assignment.confidence = 0;
        ctx.refresh();
        return;
      }
      const workType = workTypeByCode(select.value);
      if (!workType) return;
      assignment.workTypeCode = workType.code;
      assignment.confidence = 1;
      assignment.source = 'manual';
      assignment.confirmed = true;
      if (state.learnFlags[layer] !== false) {
        state.dictionary = learnLayerTerm(state.dictionary, layer, workType.code);
        saveDictionary(state.dictionary);
        void ctx.api.learn(layer, workType.code).then((result) => {
          if (!result.ok)
            ctx.toast(
              'warn',
              `辞書のサーバ保存に失敗しました（ブラウザには保存済み）: ${result.error ?? ''}`,
            );
        });
      }
      ctx.refresh();
    });
  });

  root.querySelectorAll<HTMLInputElement>('[data-confirm]').forEach((input) => {
    input.addEventListener('change', () => {
      const layer = input.dataset.confirm;
      if (!layer) return;
      const assignment = state.assignments.find((item) => item.layer === layer);
      if (!assignment) return;
      if (input.checked && !assignment.workTypeCode) {
        input.checked = false;
        ctx.toast('warn', '工種を選んでから確定してください。');
        return;
      }
      assignment.confirmed = input.checked;
      if (assignment.confirmed && assignment.source === 'none') assignment.source = 'manual';
      ctx.refresh();
    });
  });

  root.querySelector<HTMLButtonElement>('[data-action="bulk"]')?.addEventListener('click', () => {
    const before = pendingCount(state);
    state.assignments = bulkConfirm(state.assignments, 0.8);
    const after = pendingCount(state);
    ctx.toast('ok', `${before - after} 件を確定しました（残り ${after} 件）。`);
    ctx.refresh();
  });

  root.querySelector<HTMLInputElement>('[data-action="filter"]')?.addEventListener('change', (event) => {
    state.filterUnconfirmed = (event.target as HTMLInputElement).checked;
    ctx.refresh();
  });

  root.querySelectorAll<HTMLTableRowElement>('tr[data-layer]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('select, input, button, label')) return;
      const layer = row.dataset.layer;
      if (!layer) return;
      state.highlightLayer = state.highlightLayer === layer ? null : layer;
      ctx.refresh();
    });
  });

  root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    const pending = pendingCount(state);
    if (pending > 0) {
      ctx.confirm({
        title: '未確定のレイヤがあります',
        body:
          pending === 1
            ? '1 件のレイヤが未確定です。このまま進むと3D化されません。続行しますか？'
            : `${pending} 件のレイヤが未確定です。このまま進むと、該当のレイヤは3D化されません。続行しますか？`,
        confirmLabel: '未確定のまま進む',
        tone: 'primary',
        onConfirm: () => ctx.setStep(3),
      });
      return;
    }
    ctx.setStep(3);
  });

  const preview = root.querySelector<HTMLElement>('[data-preview]');
  if (preview && state.drawing) mountPlanPreview(preview, state.drawing, state.highlightLayer);
}

function emptyScreen(_ctx: AppContext, title: string, body: string): string {
  return `<section class="view"><div class="empty"><span class="empty-ico">${icon('upload')}</span><b>${escapeHtml(title)}</b>${escapeHtml(body)}<div class="empty-actions"><button class="btn" type="button" data-action="back">${icon('arrow')}SCR-01へ戻る</button></div></div></section>`;
}
