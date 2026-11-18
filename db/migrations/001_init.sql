-- Drawing-to-4D Studio — Phase 1 schema
-- additive only. 変更は新しい migration を追加する。

BEGIN;

CREATE TABLE IF NOT EXISTS work_types (
  code text PRIMARY KEY CHECK (code ~ '^[0-9]{3}$'),
  name text NOT NULL,
  color text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  sequence text NOT NULL CHECK (sequence IN ('extend', 'each', 'stack', 'instant')),
  sort_order integer NOT NULL,
  default_top numeric(8, 3),
  default_bottom numeric(8, 3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dictionary_terms (
  id bigserial PRIMARY KEY,
  pattern text NOT NULL CHECK (length(pattern) BETWEEN 1 AND 200),
  match_type text NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex', 'note')),
  work_type_code text NOT NULL REFERENCES work_types (code) ON UPDATE CASCADE,
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  priority integer NOT NULL DEFAULT 0,
  source text NOT NULL CHECK (source IN ('seed', 'learned', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pattern, match_type)
);

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_drawings (
  case_id uuid PRIMARY KEY REFERENCES cases (id) ON DELETE CASCADE,
  filename text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  units integer NOT NULL,
  unit_name text NOT NULL,
  layer_count integer NOT NULL CHECK (layer_count >= 0),
  entity_count integer NOT NULL CHECK (entity_count >= 0),
  min_x numeric(12, 3),
  min_y numeric(12, 3),
  max_x numeric(12, 3),
  max_y numeric(12, 3),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  layers jsonb NOT NULL DEFAULT '[]'::jsonb,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_schedule_rows (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  sort_order integer NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS case_schedule_rows_case_idx ON case_schedule_rows (case_id, sort_order);

CREATE TABLE IF NOT EXISTS case_assignments (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  layer text NOT NULL,
  work_type_code text REFERENCES work_types (code) ON UPDATE CASCADE,
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL CHECK (source IN ('auto', 'manual', 'none')),
  confirmed boolean NOT NULL DEFAULT false,
  excluded boolean NOT NULL DEFAULT false,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (case_id, layer)
);

CREATE TABLE IF NOT EXISTS case_elevations (
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  work_type_code text NOT NULL REFERENCES work_types (code) ON UPDATE CASCADE,
  top_elev numeric(8, 3) NOT NULL,
  bottom_elev numeric(8, 3) NOT NULL,
  source text NOT NULL CHECK (source IN ('default', 'note', 'manual')),
  sequence text NOT NULL CHECK (sequence IN ('extend', 'each', 'stack', 'instant')),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (case_id, work_type_code),
  -- 3D対象外（enabled=false）の工種は 0/0 を許容する
  CHECK (NOT enabled OR top_elev > bottom_elev)
);

COMMIT;
