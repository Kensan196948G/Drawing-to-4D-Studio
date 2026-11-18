import { formatDateJst } from '../core/schedule/csv.js';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function icon(name: string, className = 'i'): string {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function fmtDate(epochMs: number): string {
  return formatDateJst(epochMs);
}

export function fmtDateInput(epochMs: number): string {
  return fmtDate(epochMs).replaceAll('/', '-');
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const jst = new Date(date.getTime() + 9 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${jst.getUTCFullYear()}/${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

export function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function fmtNumber(value: number, digits = 0): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtArea(value: number): string {
  return `${value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} m²`;
}

export function fmtElevation(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function downloadText(filename: string, content: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: number | undefined;
  return ((...args: never[]) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  }) as T;
}
