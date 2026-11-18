# AGENTS.md — Drawing-to-4D Studio

このリポジトリで作業する AI エージェント（DeepSeek Harness / Claude Code / Codex 等）向けの指示です。

## 1. 目的と範囲

- 目的: 2D施工計画図（DXF）と工程表（CSV）から、施工順序が伝わる4Dを作る Phase 1 MVP。
- 範囲: `docs/project/01-mvp-scope.md` の In Scope。本番環境、複数ユーザー、AI推定、SXF/PDF/Excel、Blender動画は対象外。
- 設計の正: `docs/design/d4d-studio-design.html`（承認後に有効）。画面ID・状態・エラーコードを勝手に変えない。

## 2. 禁止事項

1. 実データ・社外秘図面・個人情報を、DB・Seed・テスト・ログ・AIへ持ち込まない。**架空のサンプルだけ**を使う。
2. Secrets（パスワード・トークン・接続文字列）をリポジトリ、commit、PR、ログ、画面、Seed、Memoryへ書かない。
3. 破壊的DB操作（`DROP DATABASE` / `DROP TABLE` / `TRUNCATE` / 大量DELETE / 不可逆migration）を、明示的な承認なしに実行しない。
4. main へ直接 push しない。force push・`--admin` マージ・保護ルール回避をしない。
5. 既存の仕様・設計・ユーザー変更を、理由なく revert / 上書き / 削除しない。
6. 本番環境・Cloudflare Production・課金・契約・権限の重大変更を、承認なしに行わない。
7. 図面データを外部サービスへ送信しない（Phase 1 の前提）。

## 3. ブランチ・コミット・PR

- ブランチ: `auto/<slug>`（例: `auto/phase1-mvp`）。
- コミット: Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `chore:` / `refactor:`）。
- PR本文: 目的 / MVP範囲 / 変更 / UI影響 / API影響 / DB影響 / Security影響 / 検証 / CI / Preview / 制限 / 復旧 / 未検証。
- Required Checks が緑・未解決レビューなし・Critical/Highなしのときだけ Squash Merge。
- 本番自動配備を起動するマージ経路がある場合は auto-merge を予約しない。

## 4. 変更の進め方

1. 変更前に `docs/project/` の該当仕様を読む。
2. WHY / WHAT / HOW / VERIFY を決めてから編集する。
3. 変更後に関連テストを実行する。
4. DBを変えたら additive な migration を追加し、空DBからの再構築と再実行を確認する。
5. UIを変えたら設計成果物との差異を確認し、`docs/project/03-design.md` §6 に記録する。
6. 図面・工程表の解析を変えたら `tests/unit` の該当テストを更新し、サンプルの期待値を理由なく変えない。

## 5. 検証コマンド

```bash
pnpm typecheck
pnpm lint
pnpm test              # 単体
pnpm test:integration  # 結合（d4d_studio_test）
pnpm test:e2e          # Playwright
pnpm build             # Web + Standalone
pnpm db:migrate && pnpm db:seed && pnpm db:verify
pnpm secret-scan
```

**未実施・失敗・skip のテストを成功として報告しない。**

## 6. 環境

| 項目 | 値 |
| --- | --- |
| Node | 22 以上（実測 22.22.3） |
| pnpm | 12.x（実測 12.21.0） |
| PostgreSQL | 16（実測サーバー 16.15、クライアント 18.6）。DB: `d4d_studio` / `d4d_studio_test` / `d4d_studio_preview` |
| API | `127.0.0.1:8790`（dev） |
| Web | `127.0.0.1:5179`（Vite、`/api` を 8790 へプロキシ） |
| Preview | `https://d4d.mirai-dx-platform.com` → `127.0.0.1:8792`（予定） |
| OpenDesign | `http://127.0.0.1:5173`、プロジェクト `drawing-to-4d-studio` |

## 7. リポジトリ

- GitHub: `Kensan196948G/Drawing-to-4D-Studio`（private）
- 保存場所: `/home/kensan/Projects/Business-Project/Drawing-to-4D Studio`
- 参考資料: `reference/`（構想案、PoC、サンプル原本）

## 8. 既知の制限

`docs/limitations.md` を参照。方式B（断面押し出し）、AI推定、SXF/PDF/Excel、Blender動画、複数ユーザー、本番運用は対象外。
