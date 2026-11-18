# 02 Plan — Drawing-to-4D Studio Phase 1

版: v1.0（2026-11-18） / 状態: 設計承認待ち

## 1. 進め方（フェーズ）

| # | フェーズ | 主な成果 | 完了条件 | 状態 |
| --- | --- | --- | --- | --- |
| P0 | 初動Assessment | 環境・初期状態・Gapの記録 | `00-assessment.md` | 完了 |
| P1 | MVP範囲 | フロー・対象・仮定・受入 | `01-mvp-scope.md` | 完了 |
| P2 | 設計（OpenDesign） | 画面仕様・状態・トークン・成果物登録 | `03-design.md`、`od lint` P0/P1/P2=0 | 完了（承認待ち） |
| P3 | 中核エンジン | DXF/CSV/推定/標高/3D/4D＋単体テスト | 37テスト成功 | 完了 |
| P4 | WebUI実装 | 5ステップ＋2ダイアログ | E2EでF1〜F3成功 | 完了（E2E 8件成功） |
| P5 | API・DB | Migration/Seed/API、Read/Write | 空DBから再構築、結合テスト成功 | 完了（結合10件・DB verify PASS） |
| P6 | CI・文書 | GitHub Actions、README、各文書 | CI緑、Secret scan成功 | 文書・テンプレート完了。`.github/workflows/**` はポリシー拒否のため人間適用待ち |
| P7 | GitHub | ブランチ、PR、auto-merge | Merged確認 | 完了（PR #1 Merged / `41f443b` / main CI成功） |
| P8 | Preview | Tunnel、systemd、Access、実動作 | PreviewでF1成功 | mainを配備済み（10:16）。公開URLのログイン後操作のみ利用者確認待ち |
| P9 | 最終確認 | 受入条件の証拠、引継ぎ | 完了報告 | 未着手 |

## 2. タスク分解と依存

| ID | タスク | 担当 | 依存 | 書き込み範囲 | 検証 |
| --- | --- | --- | --- | --- | --- |
| T-01 | リポジトリ初期化・規約 | Lead | — | ルート設定、`AGENTS.md` | npm scripts |
| T-02 | 中核エンジン | Lead | T-01 | `src/core/**`、`tests/unit/**` | Vitest 37件 |
| T-03 | 設計仕様・OpenDesign登録 | Lead | T-01 | `docs/design/**` | `od lint` 0/0/0 |
| T-04 | WebUI（SCR-01〜05、DLG） | Lead | T-03承認、T-02 | `src/web/**` | E2E、目視、axe |
| T-05 | API・DB | Lead | T-01 | `src/api/**`、`db/**`、`scripts/db.ts` | 結合テスト、db:verify |
| T-06 | E2E・アクセシビリティ | Lead / レビュー担当 | T-04 | `tests/e2e/**` | Playwright |
| T-07 | CI | Lead | T-04,T-05 | `.github/workflows/**` | GitHub Actions |
| T-08 | Preview 配備 | Lead | T-05 | `deploy/**`、systemd | Preview実操作 |
| T-09 | 独立レビュー | レビュー担当 | T-04,T-05 | 読み取りのみ | レビュー記録 |
| T-10 | 最終報告・記録 | Lead | 全 | `docs/**` | 受入条件照合 |

## 3. 検証計画

| 種別 | コマンド | 合格条件 |
| --- | --- | --- |
| 型検査 | `pnpm typecheck` | エラー0 |
| Lint | `pnpm lint` | warning 0 |
| 単体 | `pnpm test` | 全件成功 |
| 結合 | `pnpm test:integration` | 全件成功（`d4d_studio_test`） |
| E2E | `pnpm test:e2e` | F1〜F3成功 |
| Build | `pnpm build` | `dist/web` と `dist/standalone/index.html` 生成 |
| DB | `pnpm db:migrate && pnpm db:seed && pnpm db:verify` | 空DBから再構築、再実行も成功 |
| Secret | `pnpm secret-scan` | 検出0 |
| 手動 | PreviewでF1 | 画面→4D再生→保存→再読込 |

**未実施・失敗・skip を成功として報告しない。** 実行できない場合は理由と代替を記録する。

## 4. 役割と分離

- Lead: 統合判断、設計承認の取りまとめ、GitHub操作、Preview配備、最終検証。
- レビュー担当（サブエージェント／Team）: 差分レビュー、要件・Security・不要変更の確認。読み取り専用。
- テスト担当（サブエージェント／Team）: E2Eの独立実行と証拠採取。`tests/e2e/**` のみ書き込み可。
- 同一ファイルの並行編集は行わない。共有ブランチ操作・Push・PR・merge・配備は Lead に集約する。

## 5. Round 管理

- 同一課題は最大8 Round、同一アプローチは最大3回。
- Round 1: 最小修正。Round 2: 原因の絞り込み。Round 3: 環境・再現条件。Round 4: 仮説の選び直し。Round 5: 契約・Schema・状態管理。Round 6: 独立担当の異なる仮説。Round 7: 代替戦略。Round 8: 最終修正または引継ぎ。
- 連続3 Round で改善がない場合は、仮説・要件解釈・環境を再確認し、代替案を2案以上比較する。
- 試行数は再開・担当変更でリセットしない。

## 6. リスクと復旧

| リスク | 兆候 | 対応 | 復旧 |
| --- | --- | --- | --- |
| 設計承認が得られない | 回答なし／修正指示 | WebUIを保留し、API/DB・CI・文書を先に進める | 設計を修正して再提示 |
| 3D表示が重い | フレームレート低下 | 部材数上限、クリップ、描画停止 | 部材を間引く設定 |
| localStorage 容量超過 | 保存失敗 | サイズ検査、案件削除、API保存 | 図面を再取込 |
| Preview が到達不能 | 502/タイムアウト | tunnel/systemd/port確認 | サービス再起動、ロールバック |
| CI が赤 | 失敗ログ | 原因修正、追加commit | ブランチを戻す（revert） |
| 実図面で精度不足 | 警告多発 | 辞書追加、レイヤ名ルール | 手動確定で継続 |

## 7. ブランチ・コミット・PR

- ブランチ: `auto/phase1-mvp`
- コミット: Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `chore:` / `refactor:`）
- PR本文: 目的 / MVP範囲 / 変更 / UI影響 / API影響 / DB影響 / Security影響 / 検証 / CI / Preview / 制限 / 復旧 / 未検証
- マージ: Required Checks 緑、未解決レビューなし、Critical/Highなしのとき Squash。`--match-head-commit` を使用。
- 本番自動配備を起動するマージ経路がある場合は、auto-mergeを予約しない。
