import './styles/app.css';
import type { DictionaryTerm, DxfDrawing, StudioDocument } from '../core/types.js';
import { computeBounds, countEntities } from '../core/dxf/parser.js';
import { buildParts } from '../core/geometry/parts.js';
import { makeTimeline } from '../core/timeline/model.js';
import { validateElevations } from '../core/worktype/elevation.js';
import { ApiClient } from './api.js';
import type { AppContext, ConfirmOptions } from './context.js';
import { mountAssign, renderAssign } from './screens/assign.js';
import { mountElevation, renderElevation } from './screens/elevation.js';
import { mountGenerate, renderGenerate } from './screens/generate.js';
import { mountImport, renderImport } from './screens/import.js';
import { mountView4d, renderView4d } from './screens/view-4d.js';
import {
  buildDocument,
  deleteLocalCase,
  listLocalCases,
  loadLocalCase,
  saveLocalCase,
  updateLocalCaseParts,
} from './storage.js';
import { confirmedWorkTypeCount, createState, pendingCount, saveDictionary, saveTheme } from './state.js';
import type { AppState, Step } from './types.js';
import { escapeHtml, fmtDateTime } from './ui.js';

const STEP_LABELS: Record<Step, string> = {
  1: '取り込み',
  2: '工種の割り当て',
  3: '高さの付与',
  4: '3D生成',
  5: '4D表示',
};

class App {
  readonly state: AppState;
  readonly api: ApiClient;
  private readonly main: HTMLElement;
  private readonly nav: HTMLElement;
  private cleanup: (() => void) | null = null;
  private toastTimer: number | undefined;
  private confirmAction: (() => void) | null = null;
  private readonly ctx: AppContext;

  constructor() {
    this.state = createState();
    this.api = new ApiClient();
    const main = document.querySelector<HTMLElement>('#main');
    const nav = document.querySelector<HTMLElement>('#step-nav');
    if (!main || !nav) throw new Error('app shell missing');
    this.main = main;
    this.nav = nav;
    this.ctx = {
      state: this.state,
      api: this.api,
      refresh: () => this.render(),
      setStep: (step) => this.setStep(step),
      toast: (kind, message) => this.toast(kind, message),
      confirm: (options) => this.openConfirm(options),
      openSave: () => this.openSave(),
      openOpen: () => this.openOpen(),
      ensureParts: () => this.ensureParts(),
      setCleanup: (cleanup) => {
        this.cleanup = cleanup;
      },
    };
  }

  init(): void {
    this.applyTheme();
    this.bindShell();
    const initial = parseHashStep();
    if (initial && this.canGo(initial)) this.state.step = initial;
    this.render();
    void this.boot();
  }

  private async boot(): Promise<void> {
    const online = await this.api.probe();
    if (online) {
      const catalog = await this.api.fetchCatalog();
      if (catalog) {
        this.state.workTypes = catalog.workTypes.length > 0 ? catalog.workTypes : this.state.workTypes;
        this.state.dictionary = mergeDictionaries(this.state.dictionary, catalog.dictionary);
        saveDictionary(this.state.dictionary);
      }
    }
    this.state.api = this.api.state;
    this.render();
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.state.theme;
    saveTheme(this.state.theme);
  }

  private bindShell(): void {
    document.querySelector('#btn-theme')?.addEventListener('click', () => {
      this.state.theme = this.state.theme === 'light' ? 'dark' : 'light';
      this.applyTheme();
      this.render();
    });
    document.querySelector('#btn-save')?.addEventListener('click', () => this.openSave());
    document.querySelector('#btn-open')?.addEventListener('click', () => this.openOpen());
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = document.getElementById(button.dataset.close ?? '');
        if (dialog instanceof HTMLDialogElement) dialog.close();
      });
    });
    document.querySelector('#save-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleSave();
    });
    document.querySelector('#confirm-ok')?.addEventListener('click', () => {
      const action = this.confirmAction;
      this.confirmAction = null;
      document.querySelector<HTMLDialogElement>('#confirm-dialog')?.close();
      action?.();
    });
    window.addEventListener('popstate', () => {
      const step = parseHashStep();
      if (step && step !== this.state.step && this.canGo(step)) {
        this.state.step = step;
        this.render();
      }
    });
  }

  private render(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
    this.renderHeader();
    this.renderNav();
    const screen = screenFor(this.state.step);
    this.main.innerHTML = screen.render(this.ctx);
    screen.mount(this.ctx, this.main);
    this.main.focus({ preventScroll: true });
  }

  private renderHeader(): void {
    const { state } = this;
    setText('#kpi-entities', String(state.drawing?.entities.length ?? 0));
    setText('#kpi-worktypes', String(confirmedWorkTypeCount(state)));
    setText('#kpi-parts', String(state.parts.length));
    setText('#kpi-rows', String(state.schedule?.rows.length ?? 0));
    setText('#kpi-pending', String(pendingCount(state)));
    const api = document.querySelector<HTMLElement>('#api-status');
    if (api) {
      api.dataset.state = state.api;
      api.textContent =
        state.api === 'online' ? 'API 接続' : state.api === 'offline' ? 'オフライン' : 'API 確認中';
      api.title =
        state.api === 'online'
          ? 'サーバに接続しています。保存時にサーバへも保存できます。'
          : state.api === 'offline'
            ? 'サーバに接続していません。ブラウザ内だけで動作します。'
            : 'サーバ接続を確認しています。';
    }
    window.__d4d = {
      ready: true,
      api: state.api,
      pending: pendingCount(state),
      confirmed: confirmedWorkTypeCount(state),
      assignments: state.assignments.length,
      parts: state.parts.length,
    };
  }

  private renderNav(): void {
    const { state } = this;
    const pending = pendingCount(state);
    const elevationErrors = validateElevations(state.elevations).length;
    const steps = ([1, 2, 3, 4, 5] as Step[]).map((step) => {
      const active = state.step === step;
      const locked = !this.canGo(step);
      const done = state.step > step && this.canGo(step);
      const dot =
        step === 2 && pending > 0
          ? '<span class="state-dot" title="未確定あり"></span>'
          : step === 3 && elevationErrors > 0
            ? '<span class="state-dot" title="標高の不整合"></span>'
            : step === 4 && state.buildWarnings.length > 0
              ? '<span class="state-dot" title="生成警告あり"></span>'
              : done
                ? '<span class="state-dot ok"></span>'
                : '';
      return `<button class="step ${active ? 'active' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}" type="button" data-step="${step}" data-testid="step-${step}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="num">${done ? '✓' : step}</span><span>${step} ${STEP_LABELS[step]}</span>${dot}
      </button>`;
    });
    this.nav.innerHTML = `<h2>作業のステップ</h2>${steps.join('')}<div class="foot"><b>第1段階（Phase 1）</b><br>DXFと工程表CSVを読み込み、工種と高さを確認して4D表示まで。工種の推定はキーワード辞書で行います。</div>`;
    this.nav.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        const step = Number.parseInt(button.dataset.step ?? '', 10) as Step;
        if (!this.canGo(step)) {
          this.toast('warn', '先に前のステップを完了してください。');
          return;
        }
        this.setStep(step);
      });
    });
  }

  private canGo(step: Step): boolean {
    const { state } = this;
    if (step === 1) return true;
    if (!state.drawing) return false;
    if (step === 5) return state.parts.length > 0 && state.schedule !== null;
    return true;
  }

  private setStep(step: Step): void {
    if (!this.canGo(step)) {
      this.toast('warn', 'このステップにはまだ進めません。');
      return;
    }
    this.state.step = step;
    history.pushState(null, '', `#step-${step}`);
    this.render();
  }

  private ensureParts(): boolean {
    const { state } = this;
    if (!state.drawing) return false;
    const rows = state.schedule?.rows ?? [];
    const result = buildParts(state.drawing, state.assignments, state.elevations, rows);
    state.parts = result.parts;
    state.buildWarnings = result.warnings;
    state.buildUnmatched = result.unmatchedWorkTypes;
    if (rows.length > 0) {
      state.timeline = makeTimeline(rows, state.currentDate || undefined);
      state.currentDate = state.timeline.start;
    } else {
      state.timeline = null;
      state.currentDate = 0;
    }
    state.selectedPartId = null;
    state.highlightCode = null;
    return state.parts.length > 0;
  }

  private toast(kind: 'ok' | 'warn' | 'err', message: string): void {
    const element = document.querySelector<HTMLElement>('#toast');
    if (!element) return;
    window.clearTimeout(this.toastTimer);
    element.className = `toast ${kind}`;
    element.textContent = message;
    element.hidden = false;
    this.toastTimer = window.setTimeout(() => {
      element.hidden = true;
    }, 4500);
  }

  private openConfirm(options: ConfirmOptions): void {
    const dialog = document.querySelector<HTMLDialogElement>('#confirm-dialog');
    if (!dialog) return;
    setText('#confirm-title', options.title);
    setText('#confirm-body', options.body);
    const ok = document.querySelector<HTMLButtonElement>('#confirm-ok');
    if (ok) {
      ok.textContent = options.confirmLabel ?? '続行する';
      const primary = options.tone === 'primary';
      ok.classList.toggle('danger', !primary);
      ok.classList.toggle('p', primary);
    }
    this.confirmAction = options.onConfirm;
    if (!dialog.open) dialog.showModal();
  }

  private openSave(): void {
    const { state } = this;
    if (!state.drawing) {
      this.toast('warn', '先に図面を読み込んでください。');
      return;
    }
    const code = document.querySelector<HTMLInputElement>('#case-code');
    const name = document.querySelector<HTMLInputElement>('#case-name');
    const desc = document.querySelector<HTMLTextAreaElement>('#case-desc');
    const error = document.querySelector<HTMLElement>('#save-error');
    if (code) code.value = state.caseMeta.code;
    if (name) name.value = state.caseMeta.name;
    if (desc) desc.value = state.caseMeta.description;
    if (error) error.hidden = true;
    const dialog = document.querySelector<HTMLDialogElement>('#save-dialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  private async handleSave(): Promise<void> {
    const { state } = this;
    const code = document.querySelector<HTMLInputElement>('#case-code')?.value.trim() ?? '';
    const name = document.querySelector<HTMLInputElement>('#case-name')?.value.trim() ?? '';
    const description = document.querySelector<HTMLTextAreaElement>('#case-desc')?.value.trim() ?? '';
    const showError = (message: string) => {
      const error = document.querySelector<HTMLElement>('#save-error');
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    };
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) {
      showError('案件コードは英数字・ハイフン・アンダースコア（40文字以内）で入力してください。');
      return;
    }
    if (!name) {
      showError('案件名を入力してください。');
      return;
    }
    state.caseMeta = { code, name, description, updatedAt: new Date().toISOString() };
    const doc = buildDocument(state);
    const local = saveLocalCase(doc);
    if (!local.ok) {
      showError(local.error);
      return;
    }
    updateLocalCaseParts(code, state.parts.length);
    let serverNote = '';
    if (state.api === 'online') {
      const result = await this.api.putCase(code, {
        meta: { name, description },
        drawing: doc.drawing,
        schedule: doc.schedule,
        assignments: doc.assignments,
        elevations: doc.elevations,
      });
      serverNote = result.ok
        ? `（サーバ revision ${result.revision}）`
        : '（サーバ保存は失敗。ブラウザには保存済み）';
    }
    document.querySelector<HTMLDialogElement>('#save-dialog')?.close();
    this.toast('ok', `「${name}」を保存しました${serverNote}`);
  }

  private openOpen(): void {
    const dialog = document.querySelector<HTMLDialogElement>('#open-dialog');
    if (!dialog) return;
    void this.renderOpenList();
    if (!dialog.open) dialog.showModal();
  }

  private async renderOpenList(): Promise<void> {
    const list = document.querySelector<HTMLElement>('#open-list');
    if (!list) return;
    list.innerHTML = '<div class="loading"><span class="spinner"></span>案件を読み込んでいます…</div>';
    const local = listLocalCases();
    const remote = this.state.api === 'online' ? await this.api.listCases() : [];
    const codes = [...new Set([...local.map((item) => item.code), ...remote.map((item) => item.code)])];
    if (codes.length === 0) {
      list.innerHTML =
        '<div class="empty"><b>保存された案件はありません</b>SCR-05の「保存」から案件を保存できます。</div>';
      return;
    }
    list.innerHTML = codes
      .map((code) => {
        const localCase = local.find((item) => item.code === code);
        const remoteCase = remote.find((item) => item.code === code);
        const name = localCase?.name ?? remoteCase?.name ?? code;
        const updated = localCase?.updatedAt ?? remoteCase?.updatedAt ?? '';
        const parts = localCase?.parts ? `${localCase.parts} 部材` : '';
        const badge = remoteCase ? '<span class="pill info">サーバ</span>' : '<span class="pill mute">ブラウザ</span>';
        return `<div class="case-item">
          <div class="ci-main">
            <b>${escapeHtml(name)}</b>
            <small>${escapeHtml(code)} ・ ${fmtDateTime(updated)} ${parts ? `・ ${parts}` : ''} ${remoteCase ? `・ revision ${remoteCase.revision}` : ''}</small>
          </div>
          ${badge}
          <div class="ci-actions">
            <button class="btn s" type="button" data-open-case="${escapeHtml(code)}" data-testid="open-case-${escapeHtml(code)}">開く</button>
            ${localCase ? `<button class="btn s danger" type="button" data-delete-case="${escapeHtml(code)}">削除</button>` : ''}
          </div>
        </div>`;
      })
      .join('');

    list.querySelectorAll<HTMLButtonElement>('[data-open-case]').forEach((button) => {
      button.addEventListener('click', () => {
        const code = button.dataset.openCase;
        if (code) void this.openCase(code);
      });
    });
    list.querySelectorAll<HTMLButtonElement>('[data-delete-case]').forEach((button) => {
      button.addEventListener('click', () => {
        const code = button.dataset.deleteCase;
        if (!code) return;
        this.openConfirm({
          title: '案件を削除',
          body: `ブラウザに保存した案件「${code}」を削除します。この操作は取り消せません。`,
          confirmLabel: '削除する',
          onConfirm: () => {
            deleteLocalCase(code);
            this.toast('ok', '案件を削除しました。');
            void this.renderOpenList();
          },
        });
      });
    });
  }

  private async openCase(code: string): Promise<void> {
    let doc: StudioDocument | null = loadLocalCase(code);
    if (!doc && this.state.api === 'online') {
      const remote = await this.api.getCase(code);
      if (remote) {
        doc = {
          version: 1,
          meta: {
            code: remote.meta.code,
            name: remote.meta.name,
            description: remote.meta.description,
            updatedAt: remote.meta.updatedAt,
          },
          drawing: remote.drawing
            ? { meta: remote.drawing.meta, layers: remote.drawing.layers, entities: remote.drawing.entities }
            : null,
          schedule: remote.schedule,
          assignments: remote.assignments,
          elevations: remote.elevations,
          dictionary: this.state.dictionary,
        };
      }
    }
    if (!doc) {
      this.toast('err', '案件を読み込めませんでした。');
      return;
    }
    this.applyDocument(doc);
    document.querySelector<HTMLDialogElement>('#open-dialog')?.close();
    const hasParts = this.ensureParts();
    this.state.step = hasParts && this.state.schedule ? 5 : 2;
    history.replaceState(null, '', `#step-${this.state.step}`);
    this.toast('ok', `「${doc.meta.name}」を開きました。`);
    this.render();
  }

  private applyDocument(doc: StudioDocument): void {
    const state = this.state;
    const drawing = doc.drawing;
    if (drawing) {
      const entities = drawing.entities;
      const reconstructed: DxfDrawing = {
        layers: drawing.layers,
        entities,
        units: drawing.meta.units,
        unitName: drawing.meta.unitName,
        unitScale: 1,
        bounds: computeBounds(entities),
        counts: countEntities(entities),
        warnings: [],
      };
      state.drawing = reconstructed;
      state.drawingSource = {
        filename: drawing.meta.filename,
        sizeBytes: drawing.meta.sizeBytes,
        ...(drawing.meta.sha256 ? { sha256: drawing.meta.sha256 } : {}),
      };
    } else {
      state.drawing = null;
      state.drawingSource = null;
    }
    state.schedule = doc.schedule;
    state.scheduleSourceName = doc.schedule?.sourceName ?? null;
    state.assignments = doc.assignments;
    state.elevations = doc.elevations;
    state.dictionary = mergeDictionaries(doc.dictionary ?? state.dictionary, state.dictionary);
    saveDictionary(state.dictionary);
    state.caseMeta = doc.meta;
    state.parts = [];
    state.buildWarnings = [];
    state.buildUnmatched = [];
    state.timeline = null;
    state.currentDate = 0;
    state.playing = false;
    state.selectedPartId = null;
    state.highlightCode = null;
    state.highlightLayer = null;
    state.filterUnconfirmed = false;
    state.learnFlags = Object.fromEntries(state.assignments.map((assignment) => [assignment.layer, true]));
    state.sampleLoaded = false;
  }
}

function screenFor(step: Step): {
  render: (ctx: AppContext) => string;
  mount: (ctx: AppContext, root: HTMLElement) => void;
} {
  switch (step) {
    case 1:
      return { render: renderImport, mount: mountImport };
    case 2:
      return { render: renderAssign, mount: mountAssign };
    case 3:
      return { render: renderElevation, mount: mountElevation };
    case 4:
      return { render: renderGenerate, mount: mountGenerate };
    case 5:
      return { render: renderView4d, mount: mountView4d };
    default:
      return { render: renderImport, mount: mountImport };
  }
}

function parseHashStep(): Step | null {
  const match = /#step-([1-5])/.exec(location.hash);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '', 10) as Step;
}

function setText(selector: string, text: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}

function mergeDictionaries(
  local: readonly DictionaryTerm[],
  remote: readonly DictionaryTerm[],
): DictionaryTerm[] {
  const map = new Map<string, DictionaryTerm>();
  for (const term of remote) map.set(`${term.pattern}|${term.matchType}`, term);
  for (const term of local) {
    if (term.source === 'learned') map.set(`${term.pattern}|${term.matchType}`, term);
  }
  return [...map.values()];
}

declare global {
  interface Window {
    __d4d?: {
      ready: true;
      api: string;
      pending: number;
      confirmed: number;
      assignments: number;
      parts: number;
    };
  }
}

const app = new App();
app.init();
export {};
