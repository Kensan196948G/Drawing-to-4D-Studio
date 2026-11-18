import type { ApiClient } from './api.js';
import type { AppState, Step } from './types.js';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  /** 破壊的操作のみ danger。通常の続行は primary。 */
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
}

export interface AppContext {
  state: AppState;
  api: ApiClient;
  refresh(): void;
  setStep(step: Step): void;
  toast(kind: 'ok' | 'warn' | 'err', message: string): void;
  confirm(options: ConfirmOptions): void;
  openSave(): void;
  openOpen(): void;
  ensureParts(): boolean;
  setCleanup(cleanup: (() => void) | null): void;
}
