import type { ArcEntity, DxfDrawing, Vec2 } from '../core/types.js';
import { tessellatePolyline } from '../core/geometry/polygon.js';
import { escapeHtml } from './ui.js';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_ENTITIES = 12_000;

export function planPreviewSvg(drawing: DxfDrawing, highlightLayer: string | null): string {
  const bounds = drawing.bounds;
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const pad = Math.max(width, height) * 0.04 + 0.5;
  const view: ViewBox = {
    x: bounds.minX - pad,
    y: -bounds.maxY - pad,
    w: width + pad * 2,
    h: height + pad * 2,
  };
  const stroke = Math.max(width, height) / 900;
  const entities = drawing.entities.slice(0, MAX_ENTITIES);
  const body: string[] = [];

  for (const entity of entities) {
    const isHighlight = highlightLayer !== null && entity.layer === highlightLayer;
    const dim = highlightLayer !== null && !isHighlight;
    const color = isHighlight ? 'var(--acc)' : 'var(--navy)';
    const opacity = dim ? 0.18 : isHighlight ? 1 : 0.62;
    const sw = isHighlight ? stroke * 2.4 : stroke;
    const attrs = `fill="none" stroke="${color}" stroke-width="${sw}" opacity="${opacity}"`;
    const fillAttrs = `fill="${color}" fill-opacity="${dim ? 0.08 : isHighlight ? 0.2 : 0.08}" stroke="${color}" stroke-width="${sw}" opacity="${opacity}"`;

    switch (entity.type) {
      case 'line':
        body.push(
          `<line x1="${n(entity.a.x)}" y1="${n(-entity.a.y)}" x2="${n(entity.b.x)}" y2="${n(-entity.b.y)}" ${attrs}/>`,
        );
        break;
      case 'polyline': {
        const points = tessellatePolyline(entity);
        if (points.length < 2) break;
        const d = points.map((point) => `${n(point.x)},${n(-point.y)}`).join(' ');
        body.push(
          entity.closed
            ? `<polygon points="${d}" ${fillAttrs}/>`
            : `<polyline points="${d}" ${attrs}/>`,
        );
        break;
      }
      case 'circle':
        body.push(
          `<circle cx="${n(entity.center.x)}" cy="${n(-entity.center.y)}" r="${n(entity.radius)}" ${fillAttrs}/>`,
        );
        break;
      case 'arc':
        body.push(arcPath(entity));
        break;
      case 'point':
        body.push(
          `<circle cx="${n(entity.position.x)}" cy="${n(-entity.position.y)}" r="${n(stroke * 2)}" fill="${color}" opacity="${opacity}"/>`,
        );
        break;
      case 'text':
        if (entity.text.length > 0 && entity.text.length < 60) {
          body.push(
            `<text x="${n(entity.position.x)}" y="${n(-entity.position.y)}" font-size="${n(Math.max(entity.height, height / 90))}" fill="var(--mute)" opacity="${dim ? 0.12 : 0.8}" transform="rotate(${n(-entity.rotation)} ${n(entity.position.x)} ${n(-entity.position.y)})">${escapeHtml(entity.text)}</text>`,
          );
        }
        break;
      default:
        break;
    }
  }

  const more = drawing.entities.length > MAX_ENTITIES
    ? `<text x="${n(view.x + view.w * 0.5)}" y="${n(view.y + view.h * 0.04)}" text-anchor="middle" font-size="${n(height / 40)}" fill="var(--amber)">表示要素を ${MAX_ENTITIES.toLocaleString()} 件に制限しています</text>`
    : '';

  return `<svg viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}" role="img" aria-label="図面プレビュー（${drawing.layers.length}レイヤ、${drawing.entities.length}要素）">
    <rect x="${n(view.x)}" y="${n(view.y)}" width="${n(view.w)}" height="${n(view.h)}" fill="transparent"/>
    ${body.join('')}
    ${more}
  </svg>`;
}

function arcPath(entity: ArcEntity): string {
  const start = (entity.startAngle * Math.PI) / 180;
  const end = (entity.endAngle * Math.PI) / 180;
  const sweep = end < start ? end + Math.PI * 2 : end;
  const segments = Math.max(6, Math.ceil(((sweep - start) / (Math.PI * 2)) * 48));
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + ((sweep - start) * i) / segments;
    points.push({
      x: entity.center.x + entity.radius * Math.cos(angle),
      y: entity.center.y + entity.radius * Math.sin(angle),
    });
  }
  const d = points.map((point) => `${n(point.x)},${n(-point.y)}`).join(' ');
  return `<polyline points="${d}" fill="none" stroke="var(--navy)" stroke-width="0.2" opacity="0.62"/>`;
}

function n(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '0';
}

export interface PreviewController {
  fit: () => void;
}

/** プレビューを描画し、ドラッグ移動・ホイール拡大を有効にする。 */
export function mountPlanPreview(
  container: HTMLElement,
  drawing: DxfDrawing,
  highlightLayer: string | null,
): PreviewController {
  const host = container.querySelector<HTMLElement>('[data-pv-svg]') ?? container;
  host.innerHTML = planPreviewSvg(drawing, highlightLayer);
  const svg = host.querySelector('svg');
  if (!svg) return { fit: () => undefined };

  const bounds = drawing.bounds;
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const pad = Math.max(width, height) * 0.04 + 0.5;
  const home: ViewBox = { x: bounds.minX - pad, y: -bounds.maxY - pad, w: width + pad * 2, h: height + pad * 2 };
  let view: ViewBox = { ...home };

  const apply = () => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  };
  apply();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const svgPoint = (clientX: number, clientY: number): Vec2 => {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 0.86 : 1.16;
    const rect = svg.getBoundingClientRect();
    const px = view.x + ((event.clientX - rect.left) / rect.width) * view.w;
    const py = view.y + ((event.clientY - rect.top) / rect.height) * view.h;
    view = {
      x: px - (px - view.x) * factor,
      y: py - (py - view.y) * factor,
      w: view.w * factor,
      h: view.h * factor,
    };
    apply();
  };

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    svg.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((event.clientX - lastX) / rect.width) * view.w;
    const dy = ((event.clientY - lastY) / rect.height) * view.h;
    lastX = event.clientX;
    lastY = event.clientY;
    view = { ...view, x: view.x - dx, y: view.y - dy };
    apply();
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  const fitButton = container.querySelector<HTMLButtonElement>('[data-pv-fit]');
  const fit = () => {
    view = { ...home };
    apply();
  };
  fitButton?.addEventListener('click', fit);

  void svgPoint;
  return { fit };
}
