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
| Secret scan | `node scripts/secret-scan.mjs` | 成功（100ファイル、検出0） | exit 0 |
| 依存監査 | `pnpm audit --prod --audit-level=high` | 既知脆弱性なし | exit 0 |
| ライセンス | `pnpm licenses list --prod` | 84件（MIT 69 / BlueOak 6 / BSD-3 3 / ISC 6、コピーレフトなし） | 出力 |
| Build（Web） | `vite build` | 成功 | `dist/web/` |
| Build（Standalone） | `vite build --mode standalone` | 成功（単一HTML） | `dist/standalone/index.html` |
| MVP中核検証 | `tsx scripts/verify-mvp.ts` | **29/29 PASS**（DXF→推定→標高→3D→4D→API保存/再取得） | `docs/evidence/core-verification.json` |
| Preview 検証 | `node scripts/verify-preview.mjs` | **7/7 PASS**（公開/ローカル healthz、Access 302、カタログ、案件、CSP） | `docs/evidence/preview-verification.json` |
| Preview `/healthz` | `curl https://d4d.mirai-dx-platform.com/healthz` | 200 / db.ok=true | 2026-11-18 09:17 |
| Preview 保護 | `curl -o /dev/null -w '%{http_code}' https://d4d.mirai-dx-platform.com/` | 302（Accessログイン） | 2026-11-18 09:17 |
| Preview 再起動 | `pnpm deploy:preview` | ビルド→再起動→healthz 200 / preview checks 7/7 | 2026-11-18 09:21 |
| DB 復元 | `bash scripts/restore-drill.sh` | **PASS**（cases=2 / work_types=10 / elevations=20） | `docs/evidence/restore-drill.json` |
| E2E | `pnpm test:e2e` | **7件成功**（F1/F2/F3・Empty・キーボード・smoke・screenshots） | `tests/e2e/*.spec.ts` |

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

## 4. E2E

WebUI実装後の E2E は **7件成功**（2026-11-18 09:5x JST）。

| テスト | 内容 | 結果 |
| --- | --- | --- |
| F1 | サンプル読込 → 一括確定 → Layer3修正 → 標高注記 → 3D生成29部材 → 4D再生 → 保存 → 再読込 | 成功 |
| F2 | 保存後にページ再読込し、ブラウザ保存から同じ4Dを復元（29部材 / 開始日） | 成功 |
| F3 | 未知レイヤを手動で040に修正 → 辞書学習 → 再取込で信頼度100% | 成功 |
| Empty | 図面未読込のEmpty状態、step-2の無効化 | 成功 |
| Keyboard | スキップリンクのフォーカスと遷移 | 成功 |
| Smoke ×3 | healthz / サンプル案件API / app shell + CSP | 成功 |
| Screenshots | 主要5画面と保存ダイアログの撮影 | 成功 |

実行方法:

```bash
pnpm test:e2e            # build:web を含む
pnpm exec playwright test tests/e2e/screenshots.spec.ts  # 画面証拠のみ
```

`scripts/e2e-server.ts` がテストDB `d4d_studio_test` を作り直し、`dist/web` を `127.0.0.1:8791` で配信する。
Playwright は Chromium headless shell 1.65.1 を使用。画面証拠は `docs/evidence/screens/01-import.png` 〜 `06-save-dialog.png`。

## 5. 運用検証（Preview）

| 項目 | 結果 | 証拠 |
| --- | --- | --- |
| Tunnel 接続 | 4コネクション（nrt01/nrt05/nrt14/nrt18） | `cloudflared tunnel info` |
| Access 保護 | 未認証 `/` は302、`/healthz` はbypassで200 | `preview-verification.json` |
| API/DB | 工種10・辞書40・案件 `SAMPLE-KANPEKI` | `preview-verification.json` |
| 再起動 | API再起動後 200 | 2026-11-18 09:20 |
| 復元 | dump→別DB→verify→削除 | `restore-drill.json` |
| バックアップ | `scripts/restore-drill.sh`（PG16クライアント固定） | 同上 |

## 6. 未実施・対象外

| 項目 | 理由 |
| --- | --- |
| 実図面での精度測定 | 実データが無い（架空サンプルのみ） |
| 大規模DXF（数万要素）の性能 | 実データが無い。部材上限5,000で保護 |
| Cloudflare Preview 上のUI操作 | Access（OTP）ログイン後の実操作は未実施。配信・health・Access 302 は確認済み |
| 複数ブラウザ | Chromium で確認。他ブラウザは未確認 |
| 本番環境の負荷・障害試験 | 本番は対象外 |

## 7. 証拠の残し方

- コマンド・作業場所・終了コード・主要出力をこの文書と `docs/project/progress.md` に記録する。
- 画面の証拠は実装後に `docs/evidence/` へ保存する（スクリーンショット）。
- 未実施・失敗・skip を成功として報告しない。
