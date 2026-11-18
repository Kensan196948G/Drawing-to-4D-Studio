#!/usr/bin/env bash
# Preview DB のバックアップ→別DBへ復元→検証→後片付け を行う。
# 破壊的操作は「restore_test を含む専用DB」だけに限定する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DB="${1:-d4d_studio_preview}"
TARGET_DB="${2:-d4d_studio_restore_test}"
DUMP="/tmp/${SOURCE_DB}_$(date +%Y%m%d%H%M%S).dump"

# このホストは pg_dump(17)/pg_restore(16)/server(18) が混在している。
# custom format の互換性を確保するため、サーバーと同じ PostgreSQL 16 のクライアントを使う。
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_DUMP="$PG_BIN/pg_dump"
PG_RESTORE="$PG_BIN/pg_restore"
if [[ ! -x "$PG_DUMP" ]]; then PG_DUMP="$(command -v pg_dump)"; fi
if [[ ! -x "$PG_RESTORE" ]]; then PG_RESTORE="$(command -v pg_restore)"; fi

if [[ "$SOURCE_DB" == "$TARGET_DB" ]]; then
  echo "source と target が同じです" >&2
  exit 2
fi
if [[ "$TARGET_DB" != *restore_test* ]]; then
  echo "target は restore_test を含む専用DBに限ります: $TARGET_DB" >&2
  exit 2
fi

cleanup() {
  if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'" | grep -q 1; then
    dropdb "$TARGET_DB"
  fi
  rm -f "$DUMP"
}
trap cleanup EXIT

echo "== dump ${SOURCE_DB} =="
"$PG_DUMP" -Fc "$SOURCE_DB" > "$DUMP"
DUMP_BYTES=$(wc -c < "$DUMP")

echo "== restore to ${TARGET_DB} =="
createdb "$TARGET_DB"
"$PG_RESTORE" -d "$TARGET_DB" --no-owner --no-privileges "$DUMP"

echo "== verify restored DB =="
VERIFY_OUTPUT=$(DATABASE_URL="postgresql:///${TARGET_DB}?host=/var/run/postgresql" pnpm exec tsx "$ROOT/scripts/db.ts" verify 2>&1)
echo "$VERIFY_OUTPUT" | tail -12

CASES=$(psql -d "$TARGET_DB" -tAc "SELECT count(*) FROM cases")
WORK_TYPES=$(psql -d "$TARGET_DB" -tAc "SELECT count(*) FROM work_types")
ELEVATIONS=$(psql -d "$TARGET_DB" -tAc "SELECT count(*) FROM case_elevations")

VERIFY_OK="false"
if echo "$VERIFY_OUTPUT" | grep -q "VERIFY: PASS"; then VERIFY_OK="true"; fi

EVIDENCE="$ROOT/docs/evidence/restore-drill.json"
SOURCE_DB="$SOURCE_DB" TARGET_DB="$TARGET_DB" DUMP_BYTES="$DUMP_BYTES" CASES="$CASES" WORK_TYPES="$WORK_TYPES" ELEVATIONS="$ELEVATIONS" VERIFY_OK="$VERIFY_OK" EVIDENCE="$EVIDENCE" node -e '
const fs = require("node:fs");
const evidence = {
  generatedAt: new Date().toISOString(),
  generator: "scripts/restore-drill.sh",
  sourceDb: process.env.SOURCE_DB,
  targetDb: process.env.TARGET_DB,
  dumpBytes: Number(process.env.DUMP_BYTES),
  verify: process.env.VERIFY_OK === "true" ? "PASS" : "FAIL",
  restored: {
    cases: Number(process.env.CASES),
    workTypes: Number(process.env.WORK_TYPES),
    elevations: Number(process.env.ELEVATIONS)
  },
  cleanup: "target DB dropped and dump removed after verification"
};
fs.writeFileSync(process.env.EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
'

echo "EVIDENCE: docs/evidence/restore-drill.json"
if [[ "$VERIFY_OK" != "true" ]]; then
  echo "RESTORE DRILL: FAIL" >&2
  exit 1
fi
echo "RESTORE DRILL: PASS (cases=${CASES}, work_types=${WORK_TYPES}, elevations=${ELEVATIONS})"
