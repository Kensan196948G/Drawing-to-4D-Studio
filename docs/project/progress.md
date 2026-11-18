# Progress — Drawing-to-4D Studio Phase 1

更新: 2026-11-18 09:15 JST / セッション開始: 2026-11-18 08:48 JST

## 1. 現在の状態

| 項目 | 状態 |
| --- | --- |
| フェーズ | P3（中核エンジン）完了 → P4（WebUI）設計承認待ち |
| repo / branch | `Kensan196948G/Drawing-to-4D-Studio` / `auto/phase1-mvp` |
| 基準SHA | `4b9c36c`（draft PR #1） |
| 中核エンジン | 実装済み。単体テスト37件成功 |
| API・DB | 実装済み。結合テスト10件成功、DB verify PASS |
| 設計 | OpenDesign 登録済み、lint 0/0/0。**承認待ち** |
| WebUI | 未着手（承認後） |
| CI | テンプレート `deploy/ci/ci.yml`。`.github/workflows/**` はポリシー拒否のため人間適用待ち |
| Preview | **基盤配備済み**（`https://d4d.mirai-dx-platform.com`、Access保護、UIはプレースホルダ） |

## 2. 完了した作業

1. 初期Assessment（環境・4ファイル・Gap・リスク）→ `00-assessment.md`
2. MVP範囲・仮定・受入条件 → `01-mvp-scope.md`
3. 計画・Round管理・検証計画 → `02-plan.md`
4. リポジトリ初期化、Node/pnpm/TypeScript/Vite/Vitest/Playwright/ESLint/Prettier
5. 中核エンジン
   - DXFパーサ（LAYER/BLOCKS/INSERT、LWPOLYLINE/POLYLINE/VERTEX、CIRCLE/ARC/TEXT/MTEXT、単位換算、Shift_JIS、bulge）
   - 工程表CSV（BOM、ヘッダ推定、Excelシリアル、全角、不良行）
   - 工種推定（レイヤ名・コード・注記・同形繰り返し、除外、辞書学習、一括確定）
   - 標高（断面注記10件の抽出・反映・検証、進行方向）
   - 3D部材（閉路＋開いた輪郭の自動補正、円、方式A）
   - タイムライン（extend/each/stack/instant、工程対応）
6. DB
   - `db/migrations/001_init.sql`（7テーブル、制約、FK）
   - Migration/Seed/Verify/Reset（`scripts/db.ts`、`scripts/seed.ts`）
   - サンプル案件 `SAMPLE-KANPEKI`（20レイヤ / 66要素 / 10工程 / 20割当 / 10標高）
7. API
   - Fastify、`/healthz`、カタログ、辞書学習、案件一覧・取得・保存
   - Zod検証、トランザクション、APP_TOKEN、CSP/セキュリティヘッダー
   - 結合テスト10件
8. 設計
   - OpenDesign プロジェクト `drawing-to-4d-studio` 作成
   - `tech-utility` / `human-approachable` のトークン取得
   - `docs/design/d4d-studio-design.html` 作成・登録（version 1）
   - `od lint` P0/P1/P2 = 0
9. 文書: README、AGENTS、DB、API、Test、Deployment、Limitations
10. Secret scan（58ファイル、検出0）、Lint、型検査、Build（Web/Standalone）

## 3. 主要な証拠

| 検証 | 結果 | 日時 |
| --- | --- | --- |
| `vitest run` | 37 passed | 2026-11-18 09:08 |
| `vitest run --config vitest.integration.config.ts` | 10 passed | 2026-11-18 09:08 |
| `tsc -p ... --noEmit`（3構成） | 成功 | 2026-11-18 09:10 |
| `eslint . --max-warnings=0` | 成功 | 2026-11-18 09:10 |
| `scripts/db.ts seed` | layers=20 entities=66 rows=10 assignments=20 elevations=10 | 2026-11-18 09:06 |
| `scripts/db.ts verify` | PASS 10/10 | 2026-11-18 09:06 |
| `node scripts/secret-scan.mjs` | OK 58 files | 2026-11-18 09:11 |
| `vite build` / `--mode standalone` | 成功 | 2026-11-18 09:08 |
| `od lint`（設計） | P0 0 / P1 0 / P2 0 | 2026-11-18 09:03 |
| `od artifacts create` | version 1, digest d3883990… | 2026-11-18 09:04 |
| `tsx scripts/verify-mvp.ts` | **29/29 PASS**（API保存→再取得を含む） | 2026-11-18 09:19 |
| Preview `/healthz` | 200 / db.ok=true / Access 302 | 2026-11-18 09:17 |

## 4. 課題Round

| 課題 | Round | 仮説・原因 | 対応 | 結果 |
| --- | --- | --- | --- | --- |
| CSVヘッダ推定が「工種コード」を工種名と誤認 | 1 | 正規表現 `工種` がコード列に一致 | コード列を除外して探索 | 解決（10行正常） |
| 右クリック/資格情報パス参照が承認拒否 | 1 | `~/.cloudflared` の秘密情報パスを読もうとした | 資格情報を読まない方針へ変更 | 解決 |
| 工種割当で Layer3 が未割当 | 1 | 文字注記が別レイヤ（TEXT）にある | 図形内包判定で近傍注記を収集 | 解決（045 / 65%） |
| エプロン舗装が3D化されない | 1 | 輪郭が0.5m開いている | 0.5mまたは周長1%以内を自動補正し警告 | 解決（29部材） |
| 標高制約違反でSeed失敗 | 1 | 3D対象外の0/0をCHECKが拒否 | `NOT enabled OR top > bottom` に変更 | 解決 |
| ESLintがTS7非対応 | 1 | typescript-eslint 8.73 がTS7を拒否 | TypeScript 6.0.3 へ | 解決 |
| CIワークフロー書込み拒否 | 1 | self-evolution policy gate（DEPLOY=critical） | 回避せず `deploy/ci/ci.yml` にテンプレート化 | **ブロッカー（人間適用待ち）** |
| DNS CNAMEが別トンネル（onegate）を指した | 1 | `cloudflared tunnel route dns` が名前解決で既存トンネルを選択 | `--overwrite-dns` ＋ トンネルID明示で再設定 | 解決（5cf82d33へ） |

## 5. 次の一手

1. WebUI設計 v1.0 の承認を得る（選択肢1〜3）。
2. 承認後: SCR-01〜05 / DLG-01/02 を実装（`src/web/**`）。
3. E2E（F1〜F3、状態、キーボード）を追加し、`pnpm test:e2e` を成功させる。
4. ~~GitHub リポジトリ作成、ブランチ `auto/phase1-mvp`、PR 作成。~~ 完了（draft PR #1）
5. `.github/workflows/ci.yml` の適用を依頼（人間）。CI 緑を確認。
6. ~~Preview 基盤配備（Tunnel / systemd / Access / DB）~~ 完了。UI実装後に再ビルド・再起動し、画面で F1 を実操作。
7. 最終報告と引継ぎ。

## 5-1. PR

- draft PR #1: https://github.com/Kensan196948G/Drawing-to-4D-Studio/pull/1
- base: `main` / head: `auto/phase1-mvp`
- CI: 未設定（`deploy/ci/ci.yml` の人間適用待ち）

## 6. ブロッカー

| # | 内容 | 必要な対応 | 影響 |
| --- | --- | --- | --- |
| B-01 | `.github/workflows/**` は self-evolution policy gate が拒否 | 人間が `deploy/ci/ci.yml` をコピーして適用 | CI が動かない。auto-merge の必須チェックなし |
| B-02 | WebUI 設計の承認 | 数字選択式で回答 | WebUI 実装を開始できない |
| B-03 | Cloudflare Access の可否未確認 | 配備時に確認。不可なら APP_TOKEN | Preview の保護方式 |
