# 05 UI Implementation Plan — SCR-01〜05 / DLG-01・02

版: v1.0（2026-11-18） / 状態: 設計承認待ち（実装前の準備）

## 1. 方針

- 設計の正: `docs/design/d4d-studio-design.html` v1.0（承認後）。
- 実装: Vite + TypeScript（フレームワークなし）。three.js はバンドルする。
- 中核ロジックは `src/core/**` をそのまま利用し、UI にロジックを複製しない。
- 1画面1判断。ステップは戻る自由、進むは条件付き。
- F1（取り込み→4D）を最初の縦断スライスとし、F2（保存/再開）、F3（辞書）を続ける。

## 2. ファイル構成（予定）

```
src/web/
  index.html
  main.ts                 起動・ルーター・全体再描画
  app-state.ts            AppState とアクション（純粋関数中心）
  api.ts                  /api クライアント（失敗時はオフライン継続）
  storage.ts              localStorage 保存・読込・容量検査
  scene.ts                three.js シーン（生成・4D更新・視点）
  components/
    header.ts             KPI・保存/開く・テーマ・API状態
    step-nav.ts           5ステップの状態
    toast.ts              aria-live トースト
    dialog.ts             <dialog> ラッパ（フォーカス/ Esc）
    plan-preview.ts       SVG 平面プレビュー（パン/ズーム/レイヤ強調）
    gantt.ts              工程ストリップ
    tables.ts             工種表・標高表
  screens/
    import.ts             SCR-01
    assign.ts             SCR-02
    elevation.ts          SCR-03
    generate.ts           SCR-04
    view-4d.ts            SCR-05
  styles/app.css          トークン・レイアウト・表・状態
tests/e2e/
  flow.spec.ts            F1/F2/F3
  states.spec.ts          Empty/Loading/Error/Success
  a11y.spec.ts            キーボード・axe
```

## 3. AppState（要点）

```ts
interface AppState {
  step: 1 | 2 | 3 | 4 | 5;
  drawing: DxfDrawing | null;
  drawingMeta: { filename: string; sizeBytes: number; sha256?: string } | null;
  schedule: ParsedSchedule | null;
  assignments: Assignment[];
  elevations: ElevationEntry[];
  dictionary: DictionaryTerm[];
  parts: Part[];
  buildWarnings: PartWarning[];
  timeline: TimelineRange;
  playing: boolean;
  speed: 1 | 2 | 7 | 30;
  selectedPartId: string | null;
  source: 'offline' | 'api';
  caseMeta: ProjectMeta;
  busy: boolean;
  toast: { kind: 'ok' | 'warn' | 'err'; message: string } | null;
}
```

- 保存形式は `StudioDocument`（`src/core/types.ts`）に一致させる。
- localStorage キー: `d4d-studio:doc:v1`、辞書: `d4d-studio:dictionary:v1`、テーマ: `d4d-studio:theme`。
- 保存前に JSON サイズを検査し、4.5MB 超は ERR-107。

## 4. 画面実装の要点

### SCR-01 取り込み

- ドロップゾーン＋ファイル選択。`File.arrayBuffer()` → `decodeDxfBuffer` → `parseDxf`。
- CSV は `File.text()` → `parseScheduleCsv`。
- サンプルは `?raw` インポート（Standalone でも動作）。`source='sample'` バナー。
- プレビューは SVG。`viewBox` を bounds から設定、ホイールで拡大、ドラッグで移動、フィット。
- 進捗バーは解析中のみ。失敗はインライン ERR-102 と再選択。
- 次へ: DXF があること。CSV は任意（不足は SCR-03 で明示）。

### SCR-02 工種の割り当て

- 表: レイヤ / 要素数 / 候補セレクト / 確からしさ / 確認 / 辞書。
- 候補が無い行は「未割当」。除外行は淡色＋「対象外」。
- 変更時: `workTypeCode`、`source='manual'`、`confidence=1`、`confirmed=true`。
- 辞書チェックONなら `learnLayerTerm` を適用し、localStorage と（API接続時）`POST /api/dictionary/learn`。
- 一括確定: `bulkConfirm(assignments, 0.8)`。
- 未確定フィルタ。残留数をナビに表示。
- プレビュー: 行ホバー/選択でレイヤ強調。
- 次へ: 3D対象がすべて確定/除外、または DLG-02 で続行。

### SCR-03 高さの付与

- 表: 対象 / 工種 / 天端 / 底面 / 進行方向 / 根拠。
- 数値入力は `step=0.01`、`change` で state 更新、`input` では再描画しない。
- 注記パネル: `extractElevationNotes` の結果を一覧。個別反映 / すべて反映。
- 検証: `validateElevations` の結果を行下に赤字。次へを無効化。
- サンプルでは 10 件の注記、040=2.0/-11.0、050=3.5/2.0。

### SCR-04 3D生成

- `buildParts` を実行し、部材数・工種別件数・面積・警告を表示。
- 警告は消さない（自動補正・面積不足・工程未対応）。
- 3Dプレビューは `scene.ts` で構築。初回のみ生成し、部材0件なら ERR-110。
- 次へ: parts.length > 0。

### SCR-05 4D表示

- シーン: 部材メッシュ（ExtrudeGeometry）、色は工種、クリッピング有効。
- タイムライン: `makeTimeline`、`computePartProgress` を毎フレームではなく 100ms 間隔で。
- 進行方向: extend=クリップ面、each=出現、stack=scaleY、instant=表示。
- 視点: 斜め/海側/上空/断面。OrbitControls。
- ガント: 工程バー＋現在日線。クリックで日付移動。
- 部材一覧: 行クリックで強調。
- 再生: `requestAnimationFrame`、速度 1/2/7/30 日/秒、終端で先頭へ。
- `prefers-reduced-motion` では自動再生を無効化し、手動スライダーのみ。

### DLG-01 保存・開く

- `<dialog>`。保存: 案件コード・名前・説明。既存は上書き確認。
- 開く: ブラウザ一覧（localStorage）＋ API 一覧（接続時）。
- 削除: DLG-02 で確認。
- 保存内容は `StudioDocument`。図面要素を含むためサイズ検査。

## 5. E2E 用 test id

| 画面 | data-testid |
| --- | --- |
| 共通 | `app`, `step-nav`, `step-1..5`, `toast`, `api-status` |
| SCR-01 | `dropzone`, `file-input`, `load-sample`, `stat-entities`, `stat-layers`, `warning-list`, `next` |
| SCR-02 | `layer-table`, `row-<layer>`, `select-<layer>`, `confirm-<layer>`, `bulk-confirm`, `pending-count`, `next` |
| SCR-03 | `elevation-table`, `top-040`, `bottom-040`, `sequence-040`, `apply-all-notes`, `next` |
| SCR-04 | `generate`, `part-count`, `warning-list`, `next` |
| SCR-05 | `canvas-3d`, `play`, `pause`, `date-input`, `date-slider`, `speed`, `view-iso`, `view-top`, `gantt`, `save` |
| DLG-01 | `save-dialog`, `case-code`, `case-name`, `case-list`, `open-case-<code>` |

## 6. E2E シナリオ

| ID | 内容 | 期待 |
| --- | --- | --- |
| E2E-F1 | サンプル読込→一括確定→注記反映→3D生成→再生→日付移動 | 29部材、040=5、工程が進む |
| E2E-F2 | F1後、保存→再読込 | 部材数・工種・標高一致 |
| E2E-F3 | Layer3 を手動で 045 に修正→辞書登録→再推定 | 信頼度100% |
| E2E-EMPTY | 初期表示 | ドロップゾーン、KPI 0 |
| E2E-ERROR | 不正ファイル | ERR-102、入力保持 |
| E2E-A11Y | キーボードのみで F1 | 完了、フォーカス可視 |
| E2E-PREVIEW | Preview 上で F1（Accessログイン後） | 同一結果 |

## 7. 実装順（承認後）

1. 骨格（header / step-nav / ルーター / tokens）と SCR-01。
2. SCR-02（推定・確定・辞書）→ SCR-03（注記）。
3. SCR-04（3D生成）→ scene.ts。
4. SCR-05（4D再生・ガント・視点）。
5. DLG-01/02、保存/再開。
6. E2E（F1→F2→F3→states→a11y）、目視、設計比較。
7. Preview 再デプロイ（`pnpm deploy:preview`）と Access ログイン後の実操作。
8. PR更新・（CI適用後）auto-merge。

## 8. リスク

| リスク | 対応 |
| --- | --- |
| three.js のバンドルサイズ | Standalone で数MB。許容。必要なら遅延読込 |
| 大きな図面の描画 | 部材上限5,000、プレビューは線のみ、必要なら間引き |
| クリッピングの負荷 | 材質ごとにクリップ面。部材数が多い場合は間引き |
| localStorage 容量 | サイズ検査、API保存、図面再取込 |
| ブラウザ差異 | Chromium を基準。WebGL2 非対応時はメッセージ |
| アクセシビリティ | axe + キーボードE2E、色だけに依存しない |
