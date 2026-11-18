# Test — 検証計画と実測

実施日: 2026-11-18（JST）

## 1. 実測結果

| 種別 | コマンド | 結果 | 証拠 |
| --- | --- | --- | --- |
| 型検査（Web/Core） | `tsc -p tsconfig.json --noEmit` | 成功 | exit 0 |
| 型検査（API） | `tsc -p tsconfig.api.json --noEmit` | 成功 | exit 0 |
| 型検査（scripts/tests） | `tsc -p tsconfig.scripts.json --noEmit` | 成功 | exit 0 |
| Lint | `eslint . --max-warnings=0` | 成功 | exit 0 |
| 単体 | `vitest run` | **37件成功**（6ファイル） | `tests/unit/*` |
| 結合 | `vitest run --config vitest.integration.config.ts` | **10件成功** | `tests/integration/api.test.ts` |
| Migration（空DB） | `tsx scripts/db.ts migrate` | 成功（applied=1） | `d4d_studio` |
| Seed | `tsx scripts/db.ts seed` | 成功（workTypes=10 / dictionary=40 / layers=20 / entities=66 / rows=10 / assignments=20 / elevations=10） | `d4d_studio` |
| DB verify | `tsx scripts/db.ts verify` | **PASS（10項目）** | 出力 |
| Secret scan | `node scripts/secret-scan.mjs` | 成功（58ファイル、検出0） | exit 0 |
| Build（Web） | `vite build` | 成功 | `dist/web/` |
| Build（Standalone） | `vite build --mode standalone` | 成功（単一HTML） | `dist/standalone/index.html` |
| MVP中核検証 | `tsx scripts/verify-mvp.ts` | **29/29 PASS**（DXF→推定→標高→3D→4D→API保存/再取得） | `docs/evidence/core-verification.json` |
| Preview 検証 | `node scripts/verify-preview.mjs` | **7/7 PASS**（公開/ローカル healthz、Access 302、カタログ、案件、CSP） | `docs/evidence/preview-verification.json` |
| Preview `/healthz` | `curl https://d4d.mirai-dx-platform.com/healthz` | 200 / db.ok=true | 2026-11-18 09:17 |
| Preview 保護 | `curl -o /dev/null -w '%{http_code}' https://d4d.mirai-dx-platform.com/` | 302（Accessログイン） | 2026-11-18 09:17 |
| E2E | `playwright test` | **未実施**（WebUI実装前） | — |

## 2. 単体テストの内容

| ファイル | 件数 | 主な検証 |
| --- | --- | --- |
| `dxf.test.ts` | 5 | サンプルDXFの単位・範囲・件数・レイヤ・閉路・注記、最小DXF、エスケープ |
| `schedule.test.ts` | 6 | BOM・日本語ヘッダ・列推定・Excelシリアル・全角日付・期間 |
| `estimate.test.ts` | 7 | レイヤ名/コード/注記/形による推定、除外、一括確定、辞書学習、面積符号 |
| `elevation.test.ts` | 5 | 断面注記10件の抽出、対応工種、反映、検証、対象外 |
| `geometry.test.ts` | 6 | bulge補間、閉路の重複除去、29部材の生成、円、標高、警告 |
| `timeline.test.ts` | 8 | 進捗、期間、ループ、each/extend/stack、工程対応、未対応非表示 |

## 3. 結合テストの内容

`tests/integration/api.test.ts`（専用DB `d4d_studio_test` を毎回再構築）:

1. `/healthz` が DB 接続を含めて ok
2. 工種10件・辞書40件以上の配信
3. 辞書学習の upsert（同一 pattern/match_type は1件）
4. 未知の工種コードを 400 で拒否
5. サンプル案件の一覧・詳細（20レイヤ / 66要素 / 10工程 / 20割当 / 10標高）
6. 案件の保存→再取得、revision の増加（1→2）
7. 図面件数の不整合を 400 で拒否
8. 案件コードの検証
9. 存在しない案件は 404
10. `APP_TOKEN` 設定時の書込み保護（401 / 201）

## 4. E2E（未実施）

`tests/e2e/` は WebUI 実装後に追加する。計画:

- F1: サンプル読込 → 工種確定 → 標高反映 → 3D生成 → 4D再生
- F2: 保存 → 再読込
- 状態: Empty / Loading / Error / Success
- キーボードのみで F1
- API接続時: 案件一覧・辞書学習

実行方法:

```bash
pnpm build:web
pnpm test:e2e
```

`scripts/e2e-server.ts` がテストDBを作り直し、`dist/web` を配信する。

## 5. 未実施・対象外

| 項目 | 理由 |
| --- | --- |
| 実図面での精度測定 | 実データが無い（架空サンプルのみ） |
| 大規模DXF（数万要素）の性能 | 実データが無い。部材上限5,000で保護 |
| Cloudflare Preview 上のE2E | 未配備 |
| 複数ブラウザ | 主要1ブラウザ（Chromium）で確認予定 |
| 本番環境の負荷・障害試験 | 本番は対象外 |

## 6. 証拠の残し方

- コマンド・作業場所・終了コード・主要出力をこの文書と `docs/project/progress.md` に記録する。
- 画面の証拠は実装後に `docs/evidence/` へ保存する（スクリーンショット）。
- 未実施・失敗・skip を成功として報告しない。
