#!/usr/bin/env node
/**
 * Preview の到達性・Access保護・API/DB 接続を確認し、証拠を残す。
 * 使い方: node scripts/verify-preview.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_BASE = process.env.PREVIEW_BASE ?? 'https://d4d.mirai-dx-platform.com';
const LOCAL_BASE = process.env.PREVIEW_LOCAL ?? 'http://127.0.0.1:8792';
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.info(`${ok ? 'PASS' : 'FAIL'} ${name} (${detail})`);
}

async function get(url, init = {}) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
  const text = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), text };
}

try {
  const localHealth = await get(`${LOCAL_BASE}/healthz`);
  let localBody = {};
  try {
    localBody = JSON.parse(localHealth.text);
  } catch {
    localBody = {};
  }
  record(
    'local /healthz 200 + db.ok',
    localHealth.status === 200 && localBody.db?.ok === true,
    `status=${localHealth.status} db.ok=${localBody.db?.ok}`,
  );

  const publicHealth = await get(`${PUBLIC_BASE}/healthz`);
  let publicBody = {};
  try {
    publicBody = JSON.parse(publicHealth.text);
  } catch {
    publicBody = {};
  }
  record(
    'public /healthz 200 + db.ok',
    publicHealth.status === 200 && publicBody.db?.ok === true,
    `status=${publicHealth.status} db.ok=${publicBody.db?.ok}`,
  );

  const publicRoot = await get(`${PUBLIC_BASE}/`);
  const location = publicRoot.headers.location ?? '';
  record(
    'public / redirects to Cloudflare Access',
    publicRoot.status === 302 && location.includes('cloudflareaccess.com'),
    `status=${publicRoot.status} location=${location.slice(0, 60)}…`,
  );

  const workTypes = await get(`${LOCAL_BASE}/api/catalog/work-types`);
  const workTypeBody = JSON.parse(workTypes.text);
  record('catalog work-types = 10', workTypeBody.workTypes?.length === 10, `${workTypeBody.workTypes?.length}`);

  const dictionary = await get(`${LOCAL_BASE}/api/catalog/dictionary`);
  const dictionaryBody = JSON.parse(dictionary.text);
  record('catalog dictionary >= 40', dictionaryBody.terms?.length >= 40, `${dictionaryBody.terms?.length}`);

  const cases = await get(`${LOCAL_BASE}/api/cases`);
  const caseBody = JSON.parse(cases.text);
  const hasSample = caseBody.cases?.some((item) => item.code === 'SAMPLE-KANPEKI');
  record('cases include SAMPLE-KANPEKI', Boolean(hasSample), caseBody.cases?.map((item) => item.code).join(',') ?? '');

  const root = await get(`${LOCAL_BASE}/`);
  const csp = root.headers['content-security-policy'] ?? '';
  record(
    'origin security headers',
    root.status === 200 && csp.includes("default-src 'self'") && root.headers['x-frame-options'] === 'DENY',
    `status=${root.status} csp=${csp ? 'yes' : 'no'}`,
  );
} catch (error) {
  record('preview checks', false, error instanceof Error ? error.message : String(error));
}

const ok = checks.every((check) => check.ok);
const evidence = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/verify-preview.mjs',
  publicBase: PUBLIC_BASE,
  localBase: LOCAL_BASE,
  summary: { checks: checks.length, passed: checks.filter((check) => check.ok).length, ok },
  checks,
};
mkdirSync(`${ROOT}docs/evidence`, { recursive: true });
writeFileSync(`${ROOT}docs/evidence/preview-verification.json`, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.info(`\nEVIDENCE: docs/evidence/preview-verification.json`);
console.info(`RESULT: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((check) => check.ok).length}/${checks.length})`);
if (!ok) process.exitCode = 1;
