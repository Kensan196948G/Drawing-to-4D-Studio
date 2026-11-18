#!/usr/bin/env node
/**
 * リポジトリ内の秘密情報らしき文字列を検査する。
 * - 検出値は出力しない（キー名と位置のみ）。
 * - 明示的にテスト用と分かる値は許可する。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const ALLOWED_SNIPPETS = [
  'not-a-real-secret',
  // CI のローカル PostgreSQL サービス（127.0.0.1 / localhost のみ）の既定資格情報
  'postgres:postgres@127.0.0.1',
  'postgres:postgres@localhost',
  'ci-password-for-tests',
  'ci-session-secret',
  'test-token',
  'dummy',
  'example',
  'placeholder',
  '<set>',
  '********',
];

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.dxf',
]);

const PATTERNS = [
  { name: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'github-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: 'slack-token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'stripe-key', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'credential-in-url', regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:]+:[^@\s]+@/ },
  {
    name: 'secret-assignment',
    regex: /(?:api[_-]?key|secret|token|password|passwd|credential)\s*[:=]\s*['"`]([^'"`\s]{12,})['"`]/i,
  },
  {
    name: 'bearer-token',
    regex: /Authorization\s*[:=]\s*['"`]?Bearer\s+([A-Za-z0-9._-]{20,})/i,
  },
];

const files = listFiles();
const findings = [];

for (const file of files) {
  if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) continue;
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 1_500_000) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(line);
      if (!match) continue;
      const matched = match[1] ?? match[0];
      const lowered = `${matched} ${line}`.toLowerCase();
      if (ALLOWED_SNIPPETS.some((snippet) => lowered.includes(snippet.toLowerCase()))) continue;
      if (file.startsWith('reference/')) continue;
      findings.push({ file, line: index + 1, kind: pattern.name });
    }
  });
}

if (findings.length > 0) {
  console.error(`secret-scan: ${findings.length} 件の疑い`);
  for (const finding of findings.slice(0, 50)) {
    console.error(`  ${finding.file}:${finding.line} (${finding.kind})`);
  }
  process.exit(1);
}
console.info(`secret-scan: OK (${files.length} files)`);

function listFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
      encoding: 'utf8',
    });
    return [...new Set(`${tracked}\u0000${untracked}`.split('\u0000').filter(Boolean))];
  } catch {
    return walk('.');
  }
}

function walk(dir) {
  const { readdirSync } = awaitImportFs();
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function awaitImportFs() {
  return { readdirSync: (path, options) => readdirSyncImpl(path, options) };
}

import { readdirSync as readdirSyncImpl } from 'node:fs';
