# 03 Design — WebUI 設計と OpenDesign 記録

版: v1.0（2026-11-18） / 状態: 承認待ち

## 1. 設計成果物

| 項目 | 内容 |
| --- | --- |
| 成果物（正） | [`docs/design/d4d-studio-design.html`](design/d4d-studio-design.html) |
| 版 | v1.0（2026-11-18） |
| 画面数 | 5ステップ（SCR-01〜05）＋2ダイアログ（DLG-01/02） |
| 基調 | Phase 0 PoC の図面紺・施工中オレンジ・担当者確認紫を継承 |
| 追加の方向性 | OpenDesign `tech-utility`（表の密度・等幅数値・ヘアライン）＋ `human-approachable`（12px角丸・余白） |

## 2. OpenDesign の利用記録

| 項目 | 実測値 |
| --- | --- |
| OpenDesign | v0.21.1、`http://127.0.0.1:5173`（HTTP 200）、daemon `127.0.0.1:7456` |
| プロジェクト | `Drawing-to-4D Studio — 画面設計`（id: `drawing-to-4d-studio`） |
| プロジェクト作成 | `POST /api/projects`（2026-11-18、`od`/daemon API） |
| 成果物登録 | `od artifacts create --name design/d4d-studio-design.html --project drawing-to-4d-studio` |
| 登録結果 | `ok: true`、version 1、`contentDigest: d38839907bd60e80a4a6cad1a5149e30fec1b232fc70741905f20e1b5657fbd2` |
| 方向性トークン | `od tools directions --id tech-utility --json` と `--id human-approachable --json` を取得し、仕様 §5 に反映 |
| 検査 | `od lint --fail-on p0 --json` → **P0 0 / P1 0 / P2 0**（初回P2 1件の `data-od-id` 欠落を修正して再検査） |
| 実装後の比較 | 実装後に主要画面のスクリーンショットと本仕様を比較し、差異を §6 に記録する |

## 3. 画面と構想案ステップの対応

| 構想案 | 本設計 | 備考 |
| --- | --- | --- |
| STEP 01 図面の取り込み | SCR-01 | 工程表CSVも同じ画面で取り込む（構想案 STEP 05 の入力） |
| STEP 02 工種の割り当て | SCR-02 | 辞書学習を含む |
| STEP 03 高さの付与 | SCR-03 | 断面注記の抽出・反映 |
| STEP 04 3D生成 | SCR-04 | 方式A（平面押し出し） |
| STEP 05 工程表の取り込み | SCR-01 | 取込み画面に統合（1画面1判断の原則） |
| STEP 06 4D表示と出力 | SCR-05 | 再生・日付・視点・保存 |

## 4. PoC からの変更点（WHY）

| 変更 | 理由 |
| --- | --- |
| 4ステップ → 5ステップ | 工程表を取込みに統合し、3D生成と4D表示を分けた。生成結果の警告を確認してから再生するため。 |
| 工種表に「根拠」列を追加 | 推定の理由が見えないと担当者が判断できない。確からしさの数字だけにしない。 |
| 辞書登録のオン/オフ | 誤修正を辞書に入れないための制御。既定オン、行単位で解除可能。 |
| 標高注記パネルを追加 | 断面図の注記を一括反映できるようにし、手入力を減らす。 |
| 開いた輪郭の自動補正を警告表示 | エプロン舗装の0.5mの隙間のような実例に対応。黙って閉じない。 |
| API状態をヘッダに表示 | オフラインでも動くことを明示し、通信エラーで止めない。 |
| 保存形式に辞書を含める | F3（辞書の改善）を案件と一緒に再現するため。 |

## 5. 実装との対応

| 設計 | 実装ファイル（予定） |
| --- | --- |
| トークン・レイアウト | `src/web/styles/app.css` |
| SCR-01〜05 | `src/web/main.ts`、`src/web/screens/*.ts` |
| 3D・4D | `src/web/scene.ts` |
| 保存・辞書 | `src/web/storage.ts` |
| API | `src/api/server.ts`、`src/api/routes/*.ts` |
| DB | `db/migrations/001_init.sql`、`db/seed/001_sample.sql` |

## 6. 実装後の比較（未実施）

| 画面 | 仕様との差異 | 採用方針 | 状態 |
| --- | --- | --- | --- |
| SCR-01〜05 | — | — | 実装後に記入 |

## 7. 承認

設計の承認は `04-approval.md` に記録する。承認前に WebUI の実装を開始しない。
