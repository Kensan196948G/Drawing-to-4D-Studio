import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server';
import { createPool, runMigrations, runSeed } from '../../scripts/db';
import type { FastifyInstance } from 'fastify';
import type { CaseRecord } from '../../src/api/repository';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql:///d4d_studio_test?host=/var/run/postgresql';

let app: FastifyInstance;
let admin: pg.Pool;

beforeAll(async () => {
  admin = createPool(TEST_URL);
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE');
  await admin.query('CREATE SCHEMA public');
  await runMigrations(admin);
  await runSeed(admin);
  app = await buildServer({ databaseUrl: TEST_URL, staticRoot: '/nonexistent-static-root' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('API integration', () => {
  it('healthz reports database connectivity', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; db: { ok: boolean } };
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
  });

  it('serves the seeded work types and dictionary', async () => {
    const workTypes = await app.inject({ method: 'GET', url: '/api/catalog/work-types' });
    expect(workTypes.statusCode).toBe(200);
    expect((workTypes.json() as { workTypes: unknown[] }).workTypes).toHaveLength(10);

    const dictionary = await app.inject({ method: 'GET', url: '/api/catalog/dictionary' });
    expect(dictionary.statusCode).toBe(200);
    expect((dictionary.json() as { terms: unknown[] }).terms.length).toBeGreaterThanOrEqual(40);
  });

  it('learns a dictionary term and updates it idempotently', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/dictionary/learn',
      payload: { pattern: 'INTEGRATION-LAYER', matchType: 'exact', workTypeCode: '040', confidence: 1 },
    });
    expect(first.statusCode).toBe(201);
    const firstTerm = (first.json() as { term: { source: string; workTypeCode: string } }).term;
    expect(firstTerm.source).toBe('learned');
    expect(firstTerm.workTypeCode).toBe('040');

    const second = await app.inject({
      method: 'POST',
      url: '/api/dictionary/learn',
      payload: { pattern: 'INTEGRATION-LAYER', matchType: 'exact', workTypeCode: '030', confidence: 0.9 },
    });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { term: { workTypeCode: string } }).term.workTypeCode).toBe('030');

    const list = await app.inject({ method: 'GET', url: '/api/catalog/dictionary' });
    const matches = (
      list.json() as { terms: { pattern: string; matchType: string }[] }
    ).terms.filter((term) => term.pattern === 'INTEGRATION-LAYER' && term.matchType === 'exact');
    expect(matches).toHaveLength(1);
  });

  it('rejects unknown work types', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dictionary/learn',
      payload: { pattern: 'X', matchType: 'exact', workTypeCode: '999' },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ERR-422');
  });

  it('lists and reads the sample case', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/cases' });
    expect(list.statusCode).toBe(200);
    const cases = (list.json() as { cases: { code: string; confirmedLayers: number }[] }).cases;
    const sample = cases.find((item) => item.code === 'SAMPLE-KANPEKI');
    expect(sample).toBeDefined();
    expect(sample?.confirmedLayers).toBeGreaterThan(5);

    const one = await app.inject({ method: 'GET', url: '/api/cases/SAMPLE-KANPEKI' });
    expect(one.statusCode).toBe(200);
    const record = (one.json() as { case: CaseRecord }).case;
    expect(record.drawing?.meta.entityCount).toBe(66);
    expect(record.drawing?.layers).toHaveLength(20);
    expect(record.schedule?.rows).toHaveLength(10);
    expect(record.assignments).toHaveLength(20);
    expect(record.elevations).toHaveLength(10);
    const caisson = record.assignments.find((assignment) => assignment.layer === 'CAISSON');
    expect(caisson?.workTypeCode).toBe('040');
    expect(caisson?.entityCounts.polyline).toBe(5);
    expect(record.elevations.find((entry) => entry.workTypeCode === '040')?.top).toBe(2);
  });

  it('round-trips a saved case with revision increments', async () => {
    const sample = await app.inject({ method: 'GET', url: '/api/cases/SAMPLE-KANPEKI' });
    const record = (sample.json() as { case: CaseRecord }).case;
    const payload = {
      meta: { name: '統合テスト案件', description: 'APIの往復確認' },
      drawing: record.drawing,
      schedule: record.schedule,
      assignments: record.assignments,
      elevations: record.elevations,
    };

    const created = await app.inject({ method: 'PUT', url: '/api/cases/IT-CASE-01', payload });
    expect(created.statusCode).toBe(200);
    expect((created.json() as { case: { revision: number } }).case.revision).toBe(1);

    const readBack = await app.inject({ method: 'GET', url: '/api/cases/IT-CASE-01' });
    expect(readBack.statusCode).toBe(200);
    const saved = (readBack.json() as { case: CaseRecord }).case;
    expect(saved.meta.name).toBe('統合テスト案件');
    expect(saved.drawing?.meta.entityCount).toBe(66);
    expect(saved.assignments).toHaveLength(20);

    const updated = await app.inject({ method: 'PUT', url: '/api/cases/IT-CASE-01', payload });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { case: { revision: number } }).case.revision).toBe(2);
  });

  it('rejects inconsistent drawing counts', async () => {
    const sample = await app.inject({ method: 'GET', url: '/api/cases/SAMPLE-KANPEKI' });
    const record = (sample.json() as { case: CaseRecord }).case;
    const payload = {
      meta: { name: '不正な案件', description: '' },
      drawing: record.drawing
        ? { ...record.drawing, meta: { ...record.drawing.meta, entityCount: 999 } }
        : null,
      schedule: record.schedule,
      assignments: record.assignments,
      elevations: record.elevations,
    };
    const response = await app.inject({ method: 'PUT', url: '/api/cases/IT-BAD-01', payload });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ERR-422');
  });

  it('validates the case code', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/bad%20code' });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an unknown case', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/NO-SUCH-CASE' });
    expect(response.statusCode).toBe(404);
  });

  it('protects writes with APP_TOKEN when configured', async () => {
    const tokenApp = await buildServer({
      databaseUrl: TEST_URL,
      appToken: 'test-token-not-a-real-secret',
      staticRoot: '/nonexistent-static-root',
    });
    await tokenApp.ready();
    try {
      const unauthorized = await tokenApp.inject({
        method: 'POST',
        url: '/api/dictionary/learn',
        payload: { pattern: 'TOKEN-LAYER', matchType: 'exact', workTypeCode: '040' },
      });
      expect(unauthorized.statusCode).toBe(401);

      const authorized = await tokenApp.inject({
        method: 'POST',
        url: '/api/dictionary/learn',
        headers: { 'x-app-token': 'test-token-not-a-real-secret' },
        payload: { pattern: 'TOKEN-LAYER', matchType: 'exact', workTypeCode: '040' },
      });
      expect(authorized.statusCode).toBe(201);

      const read = await tokenApp.inject({ method: 'GET', url: '/api/cases' });
      expect(read.statusCode).toBe(200);
    } finally {
      await tokenApp.close();
    }
  });
});
