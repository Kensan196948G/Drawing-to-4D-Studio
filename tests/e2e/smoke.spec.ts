import { expect, test } from '@playwright/test';

/**
 * E2E ハーネスのスモーク。UI実装後も healthz / API / 配信の前提を確認する。
 */
test.describe('E2E harness', () => {
  test('healthz reports database connectivity', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; db: { ok: boolean } };
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
  });

  test('API serves the sample case', async ({ request }) => {
    const response = await request.get('/api/cases');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { cases: { code: string }[] };
    expect(body.cases.some((item) => item.code === 'SAMPLE-KANPEKI')).toBe(true);
  });

  test('app shell is served with security headers', async ({ page, request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");

    await page.goto('/');
    await expect(page.locator('#main')).toContainText('図面の取り込み');
    await expect(page.locator('#step-nav')).toContainText('5 4D表示');
    await expect(page.locator('#offline-badge')).toContainText('完全オフライン');
  });
});
