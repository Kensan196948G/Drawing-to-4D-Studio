/**
 * 動きの共通部品。
 *
 * 画面の説明力を上げるための最小限のアニメーションだけを置く。
 * - 数値は「変化したこと」が伝わるように数え上げる
 * - 押した手応えは ripple で返す
 * - 動きを減らす設定（prefers-reduced-motion）では即座に確定させる
 * どれも「状態を偽らない」: 実測値の表示を遅らせるだけで、値を捏造しない。
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** 現在の表示値から目標値へ数え上げる。dataset.value を正本として扱う。 */
export function animateNumber(element: HTMLElement, to: number, duration = 520): void {
  const current = Number.parseFloat(element.dataset.value ?? element.textContent ?? '0');
  const from = Number.isFinite(current) ? current : 0;
  element.dataset.value = String(to);
  if (from === to) return;
  if (prefersReducedMotion()) {
    element.textContent = String(to);
    return;
  }
  const started = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(step);
    else element.textContent = String(to);
  };
  requestAnimationFrame(step);
  bump(element);
}

/** 値が変わったことを一瞬だけ強調する。 */
export function bump(element: HTMLElement, className = 'bump'): void {
  if (prefersReducedMotion()) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), 720);
}

/** 押した位置から波紋を広げる。見た目だけの飾りなので、失敗しても無視する。 */
export function installRipple(): void {
  document.addEventListener('click', (event) => {
    if (prefersReducedMotion()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('.btn, .step, .legend-item, .part-item');
    if (!button || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;
    const rect = button.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const size = Math.max(rect.width, rect.height) * 1.6;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 620);
  });
}

/** 画面に入ったことを伝える。step が変わったときだけ使う（再描画のたびに動かさない）。 */
export function enterView(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.removeAttribute('data-enter');
  void element.offsetWidth;
  element.setAttribute('data-enter', '');
  window.setTimeout(() => element.removeAttribute('data-enter'), 900);
}
