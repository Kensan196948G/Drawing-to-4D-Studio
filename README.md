# Drawing-to-4D Studio

2D施工計画図（DXF）と工程表（CSV）から、施工順序が伝わる **4D** を作る Phase 1 MVP です。
図面の解析・工種の推定・標高の付与・3D生成・4D再生はブラウザ内で完結し、**図面を外部へ送信しません**。
推定は下書きで、確定は必ず担当者が行います（半自動）。

- 構想: [`reference/企画構想案_V1.0.html`](reference/企画構想案_V1.0.html)（V1.0・案）
- 画面設計: [`docs/design/d4d-studio-design.html`](docs/design/d4d-studio-design.html)（v1.0・承認待ち）
- 対象範囲: [`docs/project/01-mvp-scope.md`](docs/project/01-mvp-scope.md)

## 実装状況（2026-11-18）

| 領域 | 状態 |
| --- | --- |
| 中核エンジン（DXF/CSV/工種推定/標高/3D/4D） | 実装済み・単体テスト37件成功・MVP中核検証29/29 PASS |
| API・PostgreSQL（Migration/Seed/案件・辞書） | 実装済み・結合テスト10件成功 |
| WebUI（5ステップ＋2ダイアログ） | **実装済み**・E2E 8件成功（F1/F2/F3・Empty・キーボード・Standaloneオフライン） |
| Standalone HTML | **実装済み**（単一HTML 約716KB、`file://` で動作） |
| Cloudflare Preview | **UI配備済み**（`https://d4d.mirai-dx-platform.com`、Access保護。ログイン後の画面操作は利用者確認待ち） |
| CI | `deploy/ci/ci.yml` にテンプレートを用意。この環境のポリシーが `.github/workflows/**` への書込みを拒否するため人間適用が必要 |

## 画面

主要画面の証拠（E2Eで自動撮影）:

- [SCR-01 取り込み](docs/evidence/screens/01-import.png)
- [SCR-02 工種の割り当て](docs/evidence/screens/02-assign.png)
- [SCR-03 高さの付与](docs/evidence/screens/03-elevation.png)
- [SCR-04 3D生成](docs/evidence/screens/04-generate.png)
- [SCR-05 4D表示](docs/evidence/screens/05-4d.png)
- [保存ダイアログ](docs/evidence/screens/06-save-dialog.png)

## 主要フロー

1. **F1 取り込み → 4D**: DXF＋工程表CSV → 工種の確認 → 標高の確認 → 3D生成 → 4D再生。
2. **F2 保存と再開**: 案件を保存し、次回同じ4Dを再現。
3. **F3 辞書の改善**: 手動修正をレイヤ名辞書へ学習し、次回の自動割当に反映。

## 構成

```
src/core/       DXF・CSV・工種推定・標高・3D部材・タイムライン（純粋TS、ブラウザ/Node共用）
src/web/        Vite + TypeScript のSPA（three.js）
src/api/        Fastify + pg のローカルAPI
db/migrations/  PostgreSQL migration
db/seed/        （seedは scripts/seed.ts がサンプル図面から生成）
scripts/        db / e2e-server / secret-scan
tests/          unit / integration / e2e
deploy/         CIテンプレート、systemd/Tunnel 設定（Preview用）
docs/           project / design / 運用文書
reference/      構想案・PoC・サンプル原本
```

## 必要環境

- Node.js 22 以上（実測 22.22.3）
- pnpm 12 以上（実測 12.21.0）
- PostgreSQL 16 以上（実測サーバー 16.15、`psql` クライアント 18.6、ローカル `127.0.0.1:5432`）

## セットアップ

```bash
# 依存関係
pnpm install

# DB（初回のみ。既にある場合は不要）
createdb d4d_studio
createdb d4d_studio_test

# スキーマとサンプルデータ
pnpm db:migrate
pnpm db:seed
pnpm db:verify

# 開発（API :8790 / Web :5179）
pnpm dev
```

ブラウザで `http://127.0.0.1:5179` を開きます。API は `http://127.0.0.1:8790/healthz` で確認できます。
API が無くても、ビルド済み Standalone HTML は単体で動作します。

## ビルド

```bash
pnpm build            # dist/web と dist/standalone/index.html
pnpm build:standalone # 単一HTML（オフライン配布用）
```

`dist/standalone/index.html` は `file://` で開けます（外部通信なし、約716KB）。

## テスト

```bash
pnpm typecheck
pnpm lint
pnpm test              # 単体
pnpm test:integration  # 結合（d4d_studio_test）
pnpm test:e2e          # Playwright（UI実装後）
pnpm secret-scan
pnpm verify:mvp        # DXF→工種→標高→3D→4D→API保存/再取得（API起動中）
pnpm verify:preview    # Preview の healthz / Access / カタログ / CSP を確認
pnpm deploy:preview    # Webビルド → Preview API再起動 → 到達性確認
pnpm verify:all        # typecheck + lint + unit + build + secret-scan
```

## DB

| DB | 用途 |
| --- | --- |
| `d4d_studio` | 開発 |
| `d4d_studio_test` | テスト（毎回作り直し） |
| `d4d_studio_preview` | Preview（未作成） |

詳細は [`docs/database.md`](docs/database.md)。

## API

ローカルAPIは、サンプルカタログ・辞書共有・案件のサーバ保存（任意）を担当します。
詳細は [`docs/api.md`](docs/api.md)。

## Preview

`https://d4d.mirai-dx-platform.com`（Cloudflare Access のワンタイムパスワードで保護）。
現在は配信経路とDB接続を確認するためのプレースホルダUIです。WebUI実装後に再ビルド・再起動して
主要フローを実操作します。`/healthz` のみ Access bypass で 200 を返します。
詳細と復旧手順は [`docs/deployment.md`](docs/deployment.md)。

## 既知の制限

[`docs/limitations.md`](docs/limitations.md) を参照してください。主なもの:

- 3D化は方式A（平面の押し出し）のみ。方式B（断面の法線押し出し）は将来対応。
- 対応形式は DXF と工程表CSV のみ。SXF/PDF/Excel/DWG直接は第2段階。
- 4Dは説明・合意形成用の概略であり、数量・干渉確認には使えません。
- ブラウザ保存は約5MBまで。大きな図面は再取込が必要です。

## セキュリティ

- 図面・工程表はブラウザ内で処理し、外部サービスへ送信しません。
- サーバ保存を使う場合のみ、ローカルAPI（127.0.0.1）へ送信します。
- 秘密情報はリポジトリ・ログ・Seed・画面に置きません。`pnpm secret-scan` で確認します。
- Preview は Cloudflare Access で保護する予定です（未設定）。

## 文書

- [Assessment](docs/project/00-assessment.md)
- [MVP Scope](docs/project/01-mvp-scope.md)
- [Plan](docs/project/02-plan.md)
- [Design / OpenDesign](docs/project/03-design.md)
- [Approval](docs/project/04-approval.md)
- [Database](docs/database.md)
- [API](docs/api.md)
- [Test](docs/test.md)
- [Deployment](docs/deployment.md)
- [Limitations](docs/limitations.md)
- [Security](docs/security.md)
- [Progress](docs/project/progress.md)

## ライセンス

未設定（private リポジトリ、社内利用）。第三者ライブラリのライセンスは `pnpm licenses list` で確認できます。
