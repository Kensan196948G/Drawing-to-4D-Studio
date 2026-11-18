import type {
  ArcEntity,
  Bounds,
  CircleEntity,
  DxfDrawing,
  DxfEntity,
  DxfLayer,
  EntityCounts,
  LineEntity,
  PointEntity,
  PolylineEntity,
  TextEntity,
  Vec2,
} from '../types.js';

interface Pair {
  code: number;
  value: string;
}

interface RawEntity {
  type: string;
  fields: Pair[];
}

interface BlockDefinition {
  name: string;
  base: Vec2;
  raw: RawEntity[];
}

const UNIT_SCALE: Record<number, { scale: number; name: string }> = {
  1: { scale: 0.0254, name: 'inch' },
  2: { scale: 0.3048, name: 'feet' },
  3: { scale: 1609.344, name: 'mile' },
  4: { scale: 0.001, name: 'mm' },
  5: { scale: 0.01, name: 'cm' },
  6: { scale: 1, name: 'm' },
  7: { scale: 1000, name: 'km' },
  9: { scale: 0.0000254, name: 'mil' },
  10: { scale: 0.9144, name: 'yard' },
};

const MAX_BLOCK_DEPTH = 4;
const MAX_ENTITIES = 200_000;

/**
 * DXF のバイト列を文字列へデコードする。
 * $DWGCODEPAGE（ANSI_932 等）を読み、日本語図面の Shift_JIS も扱う。
 */
export function decodeDxfBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 16_384)));
  const declared =
    /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/i.exec(head)?.[1]?.trim().toUpperCase() ?? '';
  let encoding = 'utf-8';
  if (declared.includes('932') || declared.includes('SJIS') || declared.includes('SHIFT')) encoding = 'shift_jis';
  else if (declared.includes('936') || declared.includes('GBK')) encoding = 'gbk';
  else if (declared.includes('949') || declared.includes('KSC')) encoding = 'euc-kr';
  else if (declared.includes('950') || declared.includes('BIG5')) encoding = 'big5';

  let text: string;
  try {
    text = new TextDecoder(encoding).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  if (encoding === 'utf-8' && text.includes('\uFFFD')) {
    try {
      const alt = new TextDecoder('shift_jis').decode(bytes);
      if (countReplacement(alt) < countReplacement(text)) text = alt;
    } catch {
      /* 代替デコード不可なら元のまま */
    }
  }
  return stripBom(text);
}

function countReplacement(value: string): number {
  let count = 0;
  for (const char of value) if (char === '\uFFFD') count += 1;
  return count;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/** ASCII DXF を解析して、m 単位の図面モデルを返す。 */
export function parseDxf(text: string, sourceName = 'drawing.dxf'): DxfDrawing {
  const pairs = tokenize(stripBom(text));
  const warnings: string[] = [];
  const header = parseHeader(pairs);
  const layers = parseLayerTable(pairs, warnings);
  const blocks = parseBlocks(pairs);
  const rawEntities = parseEntitySection(pairs);

  const layerNames = new Set(layers.map((layer) => layer.name));
  const entities = materializeAll(rawEntities, blocks, layerNames, warnings);

  if (entities.length > MAX_ENTITIES) {
    throw new Error(
      `図面の要素が多すぎます（${entities.length.toLocaleString()} 件）。必要な範囲に分割して取り込んでください。`,
    );
  }

  const unit = UNIT_SCALE[header.insunits];
  const unitScale = unit?.scale ?? 1;
  const unitName = unit?.name ?? 'unitless';
  if (!unit) warnings.push(`$INSUNITS=${header.insunits} を解釈できないため、図面単位を m とみなします。`);
  else if (unitScale !== 1) warnings.push(`図面単位は ${unit.name} です。m に換算して表示します。`);

  const scaled = entities.map((entity) => scaleEntity(entity, unitScale));
  const scaledLayers = layers.length
    ? layers.concat(
        [...layerNames]
          .filter((name) => !layers.some((layer) => layer.name === name))
          .map((name) => ({ name, color: 7, linetype: 'CONTINUOUS', visible: true })),
      )
    : [{ name: '0', color: 7, linetype: 'CONTINUOUS', visible: true }];

  const counts = countEntities(scaled);
  if (counts.polyline === 0 && counts.line === 0) {
    warnings.push('線・ポリラインがありません。DXFの ENTITIES セクションを確認してください。');
  }
  void sourceName;

  return {
    layers: scaledLayers,
    entities: scaled,
    units: header.insunits,
    unitName,
    unitScale,
    bounds: computeBounds(scaled),
    counts,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

export function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\n|\r/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const rawCode = lines[i] ?? '';
    if (rawCode.trim() === '') continue;
    const code = Number.parseInt(rawCode.trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1] ?? '' });
  }
  return pairs;
}

function pairValue(fields: Pair[], code: number, fallback = ''): string {
  for (const field of fields) if (field.code === code) return field.value;
  return fallback;
}

function pairNumber(fields: Pair[], code: number, fallback = 0): number {
  const value = pairValue(fields, code, '');
  if (value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// HEADER / TABLES / BLOCKS / ENTITIES
// ---------------------------------------------------------------------------

function parseHeader(pairs: Pair[]): { insunits: number; codepage: string } {
  let inHeader = false;
  let insunits = 0;
  let codepage = '';
  let pendingVar = '';
  for (const pair of pairs) {
    if (pair.code === 0) {
      if (pair.value === 'SECTION' || pair.value === 'ENDSEC') {
        inHeader = false;
        continue;
      }
    }
    if (pair.code === 2 && pair.value === 'HEADER') {
      inHeader = true;
      continue;
    }
    if (!inHeader) continue;
    if (pair.code === 9) {
      pendingVar = pair.value.toUpperCase();
    } else if (pendingVar === '$INSUNITS' && pair.code === 70) {
      insunits = Number.parseInt(pair.value, 10) || 0;
      pendingVar = '';
    } else if (pendingVar === '$DWGCODEPAGE' && pair.code === 3) {
      codepage = pair.value;
      pendingVar = '';
    }
  }
  return { insunits, codepage };
}

function parseLayerTable(pairs: Pair[], warnings: string[]): DxfLayer[] {
  const layers: DxfLayer[] = [];
  let inTables = false;
  let currentTable = '';
  let record: Pair[] | null = null;

  const flush = () => {
    if (!record) return;
    if (currentTable === 'LAYER') {
      const name = pairValue(record, 2).trim();
      if (name) {
        const color = Math.trunc(pairNumber(record, 62, 7));
        const flags = Math.trunc(pairNumber(record, 70, 0));
        layers.push({
          name,
          color,
          linetype: pairValue(record, 6, 'CONTINUOUS').trim(),
          visible: color >= 0 && (flags & 1) === 0,
        });
      }
    }
    record = null;
  };

  for (const pair of pairs) {
    if (pair.code === 0) {
      if (pair.value === 'SECTION' || pair.value === 'ENDSEC') {
        flush();
        if (pair.value === 'ENDSEC') inTables = false;
        continue;
      }
      if (pair.value === 'TABLE') {
        record = null;
        currentTable = '';
        continue;
      }
      if (pair.value === 'LAYER') {
        if (!inTables) continue;
        flush();
        record = [];
        continue;
      }
      if (pair.value === 'ENDTAB') {
        flush();
        continue;
      }
      record = null;
      continue;
    }
    if (pair.code === 2 && pair.value === 'TABLES') {
      inTables = true;
      continue;
    }
    if (inTables && pair.code === 2 && !record) {
      currentTable = pair.value.toUpperCase();
      continue;
    }
    if (inTables && record) record.push(pair);
  }
  flush();

  if (layers.length === 0) warnings.push('LAYER テーブルがありません。要素のレイヤ名から補完します。');
  return layers;
}

function parseBlocks(pairs: Pair[]): Map<string, BlockDefinition> {
  const blocks = new Map<string, BlockDefinition>();
  let inBlocks = false;
  let current: BlockDefinition | null = null;
  let headerFields: Pair[] = [];
  let entityStart = false;

  const flush = () => {
    if (!current) return;
    blocks.set(current.name, current);
    current = null;
    headerFields = [];
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (!pair) continue;
    if (pair.code === 0 && pair.value === 'SECTION') {
      const next = pairs[i + 1];
      inBlocks = next?.code === 2 && next.value === 'BLOCKS';
      continue;
    }
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      flush();
      inBlocks = false;
      continue;
    }
    if (!inBlocks) continue;

    if (pair.code === 0 && pair.value === 'BLOCK') {
      flush();
      current = { name: '', base: { x: 0, y: 0 }, raw: [] };
      headerFields = [];
      entityStart = false;
      continue;
    }
    if (pair.code === 0 && pair.value === 'ENDBLK') {
      flush();
      entityStart = false;
      continue;
    }
    if (!current) continue;
    if (!entityStart) {
      if (pair.code === 0) {
        entityStart = true;
        current.raw.push({ type: pair.value, fields: [] });
      } else {
        headerFields.push(pair);
        if (pair.code === 2) current.name = pair.value.trim();
        if (pair.code === 10) current.base.x = pairNumber(headerFields, 10);
        if (pair.code === 20) current.base.y = pairNumber(headerFields, 20);
      }
      continue;
    }
    if (pair.code === 0) current.raw.push({ type: pair.value, fields: [] });
    else current.raw[current.raw.length - 1]?.fields.push(pair);
  }
  flush();
  return blocks;
}

function parseEntitySection(pairs: Pair[]): RawEntity[] {
  const entities: RawEntity[] = [];
  let inEntities = false;
  let current: RawEntity | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (!pair) continue;
    if (pair.code === 0 && pair.value === 'SECTION') {
      const next = pairs[i + 1];
      inEntities = next?.code === 2 && next.value === 'ENTITIES';
      current = null;
      continue;
    }
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      if (current) entities.push(current);
      current = null;
      inEntities = false;
      continue;
    }
    if (!inEntities) continue;
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = { type: pair.value, fields: [] };
    } else if (current) {
      current.fields.push(pair);
    }
  }
  if (current) entities.push(current);
  return entities;
}

// ---------------------------------------------------------------------------
// entity materialization
// ---------------------------------------------------------------------------

function materializeAll(
  raw: RawEntity[],
  blocks: Map<string, BlockDefinition>,
  layerNames: Set<string>,
  warnings: string[],
): DxfEntity[] {
  const out: DxfEntity[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const record = raw[i];
    if (!record) continue;
    if (record.type.toUpperCase() === 'POLYLINE') {
      // 旧式 POLYLINE は直後の VERTEX 群と SEQEND を 1 本のポリラインとして扱う。
      const layer = pairValue(record.fields, 8, '0').trim() || '0';
      layerNames.add(layer);
      const points: Vec2[] = [];
      const bulges: number[] = [];
      let j = i + 1;
      for (; j < raw.length; j += 1) {
        const nested = raw[j];
        if (!nested) break;
        const nestedType = nested.type.toUpperCase();
        if (nestedType === 'VERTEX') {
          points.push(pointFrom(nested.fields, 10, 20));
          bulges.push(pairNumber(nested.fields, 42, 0));
        } else if (nestedType === 'SEQEND') {
          break;
        } else {
          break;
        }
      }
      if (points.length >= 2) {
        out.push({
          type: 'polyline',
          layer,
          points,
          closed: (Math.trunc(pairNumber(record.fields, 70, 0)) & 1) !== 0,
          bulges: bulges.slice(0, points.length),
        });
      }
      i = j;
      continue;
    }
    out.push(...materializeRecord(record, blocks, layerNames, warnings, 0, new Set()));
  }
  return out;
}

function materializeRecord(
  record: RawEntity,
  blocks: Map<string, BlockDefinition>,
  layerNames: Set<string>,
  warnings: string[],
  depth: number,
  stack: Set<string>,
): DxfEntity[] {
  const type = record.type.toUpperCase();
  const layer = pairValue(record.fields, 8, '0').trim() || '0';
  layerNames.add(layer);

  switch (type) {
    case 'LINE':
      return [
        {
          type: 'line',
          layer,
          a: pointFrom(record.fields, 10, 20),
          b: pointFrom(record.fields, 11, 21),
        } satisfies LineEntity,
      ];
    case 'LWPOLYLINE': {
      const entity = parseLwPolyline(record.fields, layer);
      return entity.points.length >= 2 ? [entity] : [];
    }
    case 'POLYLINE': {
      const entity = parsePolylineFromRecord(record, layer);
      return entity ? [entity] : [];
    }
    case 'CIRCLE': {
      const radius = pairNumber(record.fields, 40, 0);
      if (radius <= 0) return [];
      return [
        {
          type: 'circle',
          layer,
          center: pointFrom(record.fields, 10, 20),
          radius,
        } satisfies CircleEntity,
      ];
    }
    case 'ARC':
      return [
        {
          type: 'arc',
          layer,
          center: pointFrom(record.fields, 10, 20),
          radius: pairNumber(record.fields, 40, 0),
          startAngle: pairNumber(record.fields, 50, 0),
          endAngle: pairNumber(record.fields, 51, 360),
        } satisfies ArcEntity,
      ];
    case 'TEXT': {
      const text = decodeDxfText(pairValue(record.fields, 1));
      return text
        ? [
            {
              type: 'text',
              layer,
              position: pointFrom(record.fields, 10, 20),
              height: pairNumber(record.fields, 40, 2.5),
              text,
              rotation: pairNumber(record.fields, 50, 0),
            } satisfies TextEntity,
          ]
        : [];
    }
    case 'MTEXT': {
      const text = decodeDxfText(joinMText(record.fields));
      return text
        ? [
            {
              type: 'text',
              layer,
              position: pointFrom(record.fields, 10, 20),
              height: pairNumber(record.fields, 40, 2.5),
              text,
              rotation: pairNumber(record.fields, 50, 0),
            } satisfies TextEntity,
          ]
        : [];
    }
    case 'POINT':
      return [{ type: 'point', layer, position: pointFrom(record.fields, 10, 20) } satisfies PointEntity];
    case 'INSERT': {
      if (depth >= MAX_BLOCK_DEPTH) {
        warnings.push(`ブロックの入れ子が深すぎます（${stack.size} 段）。展開を打ち切りました。`);
        return [];
      }
      const name = pairValue(record.fields, 2, '').trim();
      const block = blocks.get(name);
      if (!block) {
        warnings.push(`INSERT: ブロック「${name}」が見つかりません。`);
        return [];
      }
      if (stack.has(name)) {
        warnings.push(`INSERT: ブロック「${name}」の再帰参照を検出したため展開を打ち切りました。`);
        return [];
      }
      const nextStack = new Set(stack);
      nextStack.add(name);
      const blockEntities: DxfEntity[] = [];
      for (const nested of block.raw) {
        blockEntities.push(...materializeRecord(nested, blocks, layerNames, warnings, depth + 1, nextStack));
      }
      const transform: Transform = {
        ox: pairNumber(record.fields, 10, 0),
        oy: pairNumber(record.fields, 20, 0),
        sx: pairNumber(record.fields, 41, 1),
        sy: pairNumber(record.fields, 42, 1),
        rotation: pairNumber(record.fields, 50, 0),
      };
      const mapped: DxfEntity[] = [];
      for (const entity of blockEntities) {
        const moved = applyTransform(entity, block.base, transform, layer);
        if (moved) mapped.push(moved);
      }
      return mapped;
    }
    case 'VERTEX':
    case 'SEQEND':
    case 'BLOCK':
    case 'ENDBLK':
    case 'ENDSEC':
    case 'SECTION':
      return [];
    default:
      warnings.push(`未対応の要素 ${type}: 表示・3D化の対象外です。`);
      return [];
  }
}

function parseLwPolyline(fields: Pair[], layer: string): PolylineEntity {
  const points: Vec2[] = [];
  const bulges: number[] = [];
  const flags = Math.trunc(pairNumber(fields, 70, 0));
  let current: Vec2 | null = null;
  for (const field of fields) {
    if (field.code === 10) {
      if (current) {
        points.push(current);
        bulges.push(0);
      }
      const x = Number.parseFloat(field.value);
      current = { x: Number.isFinite(x) ? x : 0, y: 0 };
    } else if (field.code === 20 && current) {
      const y = Number.parseFloat(field.value);
      current.y = Number.isFinite(y) ? y : 0;
    } else if (field.code === 42 && points.length >= 1) {
      const bulge = Number.parseFloat(field.value);
      bulges[bulges.length - 1] = Number.isFinite(bulge) ? bulge : 0;
    }
  }
  if (current) {
    points.push(current);
    bulges.push(0);
  }
  return {
    type: 'polyline',
    layer,
    points,
    closed: (flags & 1) !== 0,
    bulges: bulges.slice(0, points.length),
  };
}

function parsePolylineFromRecord(record: RawEntity, layer: string): PolylineEntity | null {
  // 本パーサは POLYLINE 直下の VERTEX を別レコードとして受け取らないため、
  // まず POLYLINE フィールド内の 10/20 を読み、無ければ空として扱う。
  const points: Vec2[] = [];
  const bulges: number[] = [];
  let current: Vec2 | null = null;
  for (const field of record.fields) {
    if (field.code === 10) {
      if (current) {
        points.push(current);
        bulges.push(0);
      }
      current = { x: pairNumber(record.fields, 10, 0), y: 0 };
    } else if (field.code === 20 && current) {
      current.y = Number.parseFloat(field.value) || 0;
    } else if (field.code === 42) {
      bulges[bulges.length - 1] = Number.parseFloat(field.value) || 0;
    }
  }
  if (current) {
    points.push(current);
    bulges.push(0);
  }
  if (points.length < 2) return null;
  return {
    type: 'polyline',
    layer,
    points,
    closed: (Math.trunc(pairNumber(record.fields, 70, 0)) & 1) !== 0,
    bulges: bulges.slice(0, points.length),
  };
}

interface Transform {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  rotation: number;
}

function applyTransform(entity: DxfEntity, base: Vec2, transform: Transform, layerOverride: string): DxfEntity {
  const mapPoint = (point: Vec2): Vec2 => {
    const x = (point.x - base.x) * transform.sx;
    const y = (point.y - base.y) * transform.sy;
    const rad = (transform.rotation * Math.PI) / 180;
    return {
      x: x * Math.cos(rad) - y * Math.sin(rad) + transform.ox,
      y: x * Math.sin(rad) + y * Math.cos(rad) + transform.oy,
    };
  };
  const layer = entity.layer && entity.layer !== '0' ? entity.layer : layerOverride;

  switch (entity.type) {
    case 'line':
      return { ...entity, layer, a: mapPoint(entity.a), b: mapPoint(entity.b) };
    case 'polyline':
      return { ...entity, layer, points: entity.points.map(mapPoint) };
    case 'circle':
      return {
        ...entity,
        layer,
        center: mapPoint(entity.center),
        radius: entity.radius * Math.abs(transform.sx),
      };
    case 'arc':
      return {
        ...entity,
        layer,
        center: mapPoint(entity.center),
        radius: entity.radius * Math.abs(transform.sx),
        startAngle: entity.startAngle + transform.rotation,
        endAngle: entity.endAngle + transform.rotation,
      };
    case 'text':
      return {
        ...entity,
        layer,
        position: mapPoint(entity.position),
        height: entity.height * Math.abs(transform.sy || 1),
        rotation: entity.rotation + transform.rotation,
      };
    case 'point':
      return { ...entity, layer, position: mapPoint(entity.position) };
    default:
      return entity;
  }
}

// ---------------------------------------------------------------------------
// text decoding
// ---------------------------------------------------------------------------

const CONTROL_CHARS: Record<string, string> = {
  d: '°',
  c: 'Ø',
  p: '±',
  u: '',
  o: '',
};

export function decodeDxfText(input: string): string {
  if (!input) return '';
  let text = input;
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_match, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );
  text = text.replace(/%%([dcpuo])/gi, (match, code: string) => CONTROL_CHARS[code.toLowerCase()] ?? match);
  text = text.replace(/\\P/gi, ' ');
  text = text.replace(/\\~/g, ' ');
  text = text.replace(/\\S([^;]*);/g, (_match, inner: string) => inner.replace(/\^/g, '/'));
  text = text.replace(/\\[A-Za-z][^;\\]*;/g, '');
  text = text.replace(/[{}]/g, '');
  return text.replace(/[\r\n]+/g, ' ').trim();
}

function joinMText(fields: Pair[]): string {
  const parts: string[] = [];
  for (const field of fields) if (field.code === 3) parts.push(field.value);
  const main = pairValue(fields, 1, '');
  if (main) parts.push(main);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

function pointFrom(fields: Pair[], xCode: number, yCode: number): Vec2 {
  return { x: pairNumber(fields, xCode, 0), y: pairNumber(fields, yCode, 0) };
}

function scaleEntity(entity: DxfEntity, scale: number): DxfEntity {
  if (scale === 1) return entity;
  switch (entity.type) {
    case 'line':
      return { ...entity, a: scalePoint(entity.a, scale), b: scalePoint(entity.b, scale) };
    case 'polyline':
      return { ...entity, points: entity.points.map((point) => scalePoint(point, scale)) };
    case 'circle':
      return { ...entity, center: scalePoint(entity.center, scale), radius: entity.radius * scale };
    case 'arc':
      return { ...entity, center: scalePoint(entity.center, scale), radius: entity.radius * scale };
    case 'text':
      return { ...entity, position: scalePoint(entity.position, scale), height: entity.height * scale };
    case 'point':
      return { ...entity, position: scalePoint(entity.position, scale) };
    default:
      return entity;
  }
}

function scalePoint(point: Vec2, scale: number): Vec2 {
  return { x: point.x * scale, y: point.y * scale };
}

export function countEntities(entities: DxfEntity[]): EntityCounts {
  const counts: EntityCounts = { line: 0, polyline: 0, circle: 0, arc: 0, text: 0, point: 0 };
  for (const entity of entities) counts[entity.type] += 1;
  return counts;
}

export function computeBounds(entities: DxfEntity[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const entity of entities) {
    switch (entity.type) {
      case 'line':
        include(entity.a.x, entity.a.y);
        include(entity.b.x, entity.b.y);
        break;
      case 'polyline':
        for (const point of entity.points) include(point.x, point.y);
        break;
      case 'circle':
      case 'arc':
        include(entity.center.x - entity.radius, entity.center.y - entity.radius);
        include(entity.center.x + entity.radius, entity.center.y + entity.radius);
        break;
      case 'text':
      case 'point':
        include(entity.position.x, entity.position.y);
        break;
      default:
        break;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return { minX, minY, maxX, maxY };
}

export function groupEntitiesByLayer(entities: DxfEntity[]): Map<string, DxfEntity[]> {
  const map = new Map<string, DxfEntity[]>();
  for (const entity of entities) {
    const list = map.get(entity.layer);
    if (list) list.push(entity);
    else map.set(entity.layer, [entity]);
  }
  return map;
}

export function collectLayerNames(entities: DxfEntity[]): string[] {
  const names = new Set<string>();
  for (const entity of entities) names.add(entity.layer);
  return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}
