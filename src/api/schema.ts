import { z } from 'zod';

const Vec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() });

const CountsSchema = z.object({
  line: z.number().int().nonnegative(),
  polyline: z.number().int().nonnegative(),
  circle: z.number().int().nonnegative(),
  arc: z.number().int().nonnegative(),
  text: z.number().int().nonnegative(),
  point: z.number().int().nonnegative(),
});

const LayerSchema = z.object({
  name: z.string().min(1).max(255),
  color: z.number().int(),
  linetype: z.string().max(64),
  visible: z.boolean(),
});

const EntitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('line'), layer: z.string().min(1).max(255), a: Vec2Schema, b: Vec2Schema }),
  z.object({
    type: z.literal('polyline'),
    layer: z.string().min(1).max(255),
    points: z.array(Vec2Schema).min(2).max(50_000),
    closed: z.boolean(),
    bulges: z.array(z.number().finite()).max(50_000),
  }),
  z.object({
    type: z.literal('circle'),
    layer: z.string().min(1).max(255),
    center: Vec2Schema,
    radius: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('arc'),
    layer: z.string().min(1).max(255),
    center: Vec2Schema,
    radius: z.number().nonnegative(),
    startAngle: z.number().finite(),
    endAngle: z.number().finite(),
  }),
  z.object({
    type: z.literal('text'),
    layer: z.string().min(1).max(255),
    position: Vec2Schema,
    height: z.number().nonnegative(),
    text: z.string().max(2000),
    rotation: z.number().finite(),
  }),
  z.object({ type: z.literal('point'), layer: z.string().min(1).max(255), position: Vec2Schema }),
]);

const BoundsSchema = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
});

const DrawingSchema = z.object({
  meta: z.object({
    filename: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    units: z.number().int(),
    unitName: z.string().max(32),
    layerCount: z.number().int().nonnegative(),
    entityCount: z.number().int().nonnegative(),
    bounds: BoundsSchema,
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
  layers: z.array(LayerSchema).max(500),
  entities: z.array(EntitySchema).max(200_000),
});

const ScheduleRowSchema = z.object({
  code: z.string().max(40),
  name: z.string().min(1).max(200),
  start: z.number().int(),
  end: z.number().int(),
});

const ScheduleSchema = z.object({
  sourceName: z.string().max(255),
  rows: z.array(ScheduleRowSchema).max(5000),
  badRows: z
    .array(z.object({ line: z.number().int(), reason: z.string().max(500), raw: z.string().max(2000) }))
    .max(1000)
    .default([]),
  columns: z.object({
    code: z.number().int(),
    name: z.number().int(),
    start: z.number().int(),
    end: z.number().int(),
  }),
});

const AssignmentSchema = z.object({
  layer: z.string().min(1).max(255),
  entityCounts: CountsSchema,
  candidates: z
    .array(
      z.object({
        workTypeCode: z.string().regex(/^\d{3}$/),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(300),
      }),
    )
    .max(10),
  workTypeCode: z
    .string()
    .regex(/^\d{3}$/)
    .nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['auto', 'manual', 'none']),
  confirmed: z.boolean(),
  excluded: z.boolean(),
  notes: z.array(z.string().max(300)).max(20),
});

const ElevationSchema = z
  .object({
    workTypeCode: z.string().regex(/^\d{3}$/),
    top: z.number().finite(),
    bottom: z.number().finite(),
    source: z.enum(['default', 'note', 'manual']),
    sequence: z.enum(['extend', 'each', 'stack', 'instant']),
    enabled: z.boolean(),
  })
  .refine((entry) => !entry.enabled || entry.top > entry.bottom, {
    message: '3D対象の工種は天端 > 底面である必要があります。',
  });

export const CasePayloadSchema = z.object({
  meta: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).default(''),
  }),
  drawing: DrawingSchema.nullable(),
  schedule: ScheduleSchema.nullable(),
  assignments: z.array(AssignmentSchema).max(500),
  elevations: z.array(ElevationSchema).max(50),
});

export type CasePayload = z.infer<typeof CasePayloadSchema>;

export const LearnTermSchema = z.object({
  pattern: z.string().min(1).max(200),
  matchType: z.enum(['exact', 'contains', 'regex', 'note']).default('exact'),
  workTypeCode: z.string().regex(/^\d{3}$/),
  confidence: z.number().min(0).max(1).default(1),
});

export type LearnTermInput = z.infer<typeof LearnTermSchema>;

export const CaseCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
