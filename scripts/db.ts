import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL, pathToFileURL } from 'node:url';
import pg from 'pg';
import { seedDictionary, seedSampleCase, seedWorkTypes } from './seed.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const DEFAULT_URL = 'postgresql:///d4d_studio?host=/var/run/postgresql';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_URL;
}

export function createPool(connectionString = databaseUrl()): pg.Pool {
  return new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 });
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(pool: pg.Pool): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const existing = await pool.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations');
  const appliedMap = new Map(existing.rows.map((row) => [row.id, row.checksum]));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = appliedMap.get(file);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(`migration ${file} は適用済みですが内容が変わっています（checksum 不一致）。新しい migration を追加してください。`);
      }
      skipped.push(file);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

export interface SeedResult {
  workTypes: number;
  dictionary: number;
  sample: Awaited<ReturnType<typeof seedSampleCase>>;
}

export async function runSeed(pool: pg.Pool): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const workTypes = await seedWorkTypes(client);
    const dictionary = await seedDictionary(client);
    const sample = await seedSampleCase(client);
    await client.query('COMMIT');
    return { workTypes, dictionary, sample };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface VerifyResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export async function verifyDatabase(pool: pg.Pool): Promise<VerifyResult> {
  const checks: VerifyResult['checks'] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const workTypes = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM work_types');
  add('work_types = 10', workTypes.rows[0]?.count === '10', workTypes.rows[0]?.count ?? '0');

  const dictionary = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM dictionary_terms');
  add('dictionary_terms >= 40', Number(dictionary.rows[0]?.count ?? 0) >= 40, dictionary.rows[0]?.count ?? '0');

  const sample = await pool.query<{ id: string }>("SELECT id FROM cases WHERE code = 'SAMPLE-KANPEKI'");
  add('sample case exists', sample.rows.length === 1, sample.rows[0]?.id ?? 'missing');

  const drawings = await pool.query<{ count: string; entity_count: number }>(
    `SELECT count(*)::text AS count, coalesce(max(entity_count), 0) AS entity_count
       FROM case_drawings d JOIN cases c ON c.id = d.case_id WHERE c.code = 'SAMPLE-KANPEKI'`,
  );
  add(
    'sample drawing rows',
    drawings.rows[0]?.count === '1' && Number(drawings.rows[0]?.entity_count ?? 0) > 0,
    `drawings=${drawings.rows[0]?.count ?? '0'} entities=${drawings.rows[0]?.entity_count ?? 0}`,
  );

  const rows = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM case_schedule_rows r
       JOIN cases c ON c.id = r.case_id WHERE c.code = 'SAMPLE-KANPEKI'`,
  );
  add('sample schedule rows = 10', rows.rows[0]?.count === '10', rows.rows[0]?.count ?? '0');

  const assignments = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM case_assignments a
       JOIN cases c ON c.id = a.case_id WHERE c.code = 'SAMPLE-KANPEKI'`,
  );
  add(
    'sample assignments >= 15',
    Number(assignments.rows[0]?.count ?? 0) >= 15,
    assignments.rows[0]?.count ?? '0',
  );

  const elevations = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM case_elevations e
       JOIN cases c ON c.id = e.case_id WHERE c.code = 'SAMPLE-KANPEKI'`,
  );
  add('sample elevations = 10', elevations.rows[0]?.count === '10', elevations.rows[0]?.count ?? '0');

  const orphanAssignments = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM case_assignments a
      LEFT JOIN cases c ON c.id = a.case_id WHERE c.id IS NULL`,
  );
  add('assignments have parent case', orphanAssignments.rows[0]?.count === '0', orphanAssignments.rows[0]?.count ?? '0');

  const invalidElevations = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM case_elevations WHERE enabled AND top_elev <= bottom_elev',
  );
  add(
    'enabled elevations top > bottom',
    invalidElevations.rows[0]?.count === '0',
    invalidElevations.rows[0]?.count ?? '0',
  );

  const unconfirmed = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM case_assignments a
       JOIN cases c ON c.id = a.case_id
      WHERE c.code = 'SAMPLE-KANPEKI' AND a.work_type_code IS NOT NULL AND NOT a.excluded AND NOT a.confirmed`,
  );
  add(
    'sample has no confirmed=off with work type',
    unconfirmed.rows[0]?.count === '0',
    unconfirmed.rows[0]?.count ?? '0',
  );

  return { ok: checks.every((check) => check.ok), checks };
}

async function reset(pool: pg.Pool, url: string): Promise<void> {
  const name = databaseName(url);
  if (!/^(d4d_studio|d4d_studio_test|d4d_studio_dev)$/.test(name) && process.env.ALLOW_RESET !== '1') {
    throw new Error(`reset は d4d_studio / d4d_studio_test / d4d_studio_dev のみ許可します（対象: ${name}）。`);
  }
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

function databaseName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '') || 'd4d_studio';
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  const url = databaseUrl();
  const pool = createPool(url);
  try {
    switch (command) {
      case 'migrate': {
        const result = await runMigrations(pool);
        console.info(`migrate: applied=${result.applied.length} skipped=${result.skipped.length}`);
        break;
      }
      case 'seed': {
        const result = await runSeed(pool);
        console.info(
          `seed: workTypes=${result.workTypes} dictionary=${result.dictionary} sample=${result.sample.code} layers=${result.sample.layerCount} entities=${result.sample.entityCount} rows=${result.sample.scheduleRows} assignments=${result.sample.assignments} elevations=${result.sample.elevations}`,
        );
        break;
      }
      case 'verify': {
        const result = await verifyDatabase(pool);
        for (const check of result.checks) console.info(`${check.ok ? 'PASS' : 'FAIL'} ${check.name} (${check.detail})`);
        console.info(result.ok ? 'VERIFY: PASS' : 'VERIFY: FAIL');
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case 'reset': {
        if (!process.argv.includes('--yes')) throw new Error('reset には --yes が必要です。');
        await reset(pool, url);
        const result = await runMigrations(pool);
        console.info(`reset: applied=${result.applied.length}`);
        break;
      }
      default:
        throw new Error(`unknown command: ${command} (migrate | seed | verify | reset --yes)`);
    }
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`db: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
