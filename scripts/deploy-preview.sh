#!/usr/bin/env bash
# Preview（d4d.mirai-dx-platform.com）を再ビルドして再起動し、health と到達性を確認する。
# 本番環境は対象外。ローカルAPI（127.0.0.1:8792）のみを操作する。
set -euo pipefail

ROOT="${D4D_ROOT:-/home/kensan/d4d-studio}"
cd "$ROOT"

echo "== build web =="
pnpm run build:web

echo "== restart preview API =="
systemctl --user restart drawing-to-4d-api.service

echo "== wait for health =="
for i in $(seq 1 20); do
  if curl -fsS -m 3 http://127.0.0.1:8792/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "== local health =="
curl -fsS http://127.0.0.1:8792/healthz
echo

echo "== preview checks =="
node scripts/verify-preview.mjs

echo "DEPLOY PREVIEW: OK"
