/**
 * Playwright 用の検証サーバ。
 * - テストDB（d4d_studio_test）を作り直して migration + seed
 * - dist/web を配信する API を 127.0.0.1:8791 で起動
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { buildServer } from '../src/api/server.js';
import { createPool, runMigrations, runSeed } from './db.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql:///d4d_studio_test?host=/var/run/postgresql';
const PORT = Number(process.env.E2E_PORT ?? 8791);
const STATIC_ROOT = fileURLToPath(new URL('../dist/web', import.meta.url));

if (!TEST_URL.includes('_test')) {
  throw new Error('e2e-server は *_test データベースのみを対象にします。');
}
if (!existsSync(`${STATIC_ROOT}/index.html`)) {
  throw new Error('dist/web/index.html がありません。先に pnpm run build:web を実行してください。');
}

const pool = createPool(TEST_URL);
await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
await pool.query('CREATE SCHEMA public');
await runMigrations(pool);
const seeded = await runSeed(pool);
await pool.end();
console.info(`e2e: seeded ${seeded.sample.code} (${seeded.sample.entityCount} entities)`);

const app = await buildServer({
  databaseUrl: TEST_URL,
  staticRoot: STATIC_ROOT,
  logger: false,
});
await app.listen({ host: '127.0.0.1', port: PORT });
console.info(`e2e: listening on http://127.0.0.1:${PORT}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
