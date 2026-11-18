import pg from 'pg';

export function createDatabasePool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 });
}

export async function assertDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '1970-01-01';
}
