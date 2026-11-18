# API — ローカル検証用

ベースURL: `http://127.0.0.1:8790`（開発） / Preview は Tunnel 経由。

## 1. 認証

- 書き込み（POST/PUT）は、環境変数 `APP_TOKEN` が設定されている場合 `X-App-Token` ヘッダーが必要。
- 未設定（開発・テスト）では不要。
- Preview では Cloudflare Access を前段に置く予定。多層防御として `APP_TOKEN` も設定できる。
- 認証失敗は `401` / `ERR-401`。値はログへ出さない。

## 2. エラー形式

```json
{ "error": { "code": "ERR-422", "message": "drawing.meta.entityCount: ..." } }
```

| ステータス | コード | 意味 |
| --- | --- | --- |
| 400 | `ERR-422` | 入力検証エラー |
| 401 | `ERR-401` | トークン不足・不一致 |
| 404 | `ERR-404` | 対象なし |
| 413 | `ERR-413` | 送信データが大きすぎる（上限12MB） |
| 500 | `ERR-500` | サーバ内部エラー（詳細はログのみ） |

## 3. エンドポイント

### GET `/healthz`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "env": "development",
  "db": { "ok": true },
  "timestamp": "2026-11-18T00:00:00.000Z"
}
```

DB接続不可時は `503` / `status=degraded` / `db.ok=false`。

### GET `/api/catalog/work-types`

工種マスタ10件。

```json
{
  "workTypes": [
    {
      "code": "040",
      "name": "ケーソン据付工（5函）",
      "color": "#2f6f8f",
      "sequence": "each",
      "order": 40,
      "defaultTop": 3.5,
      "defaultBottom": -11
    }
  ]
}
```

### GET `/api/catalog/dictionary`

辞書（初期40件＋学習分）。`priority` 降順。

```json
{
  "terms": [
    {
      "id": "learned-040-CAISSON",
      "pattern": "CAISSON",
      "matchType": "exact",
      "workTypeCode": "040",
      "confidence": 1,
      "priority": 200,
      "source": "learned"
    }
  ]
}
```

### POST `/api/dictionary/learn`

担当者の修正を辞書へ追加・更新する。`(pattern, match_type)` で upsert。`priority` は200以上。

```bash
curl -s -X POST http://127.0.0.1:8790/api/dictionary/learn \
  -H 'Content-Type: application/json' \
  -d '{"pattern":"CAISSON","matchType":"exact","workTypeCode":"040","confidence":1}'
```

```json
{ "term": { "pattern": "CAISSON", "matchType": "exact", "workTypeCode": "040", "source": "learned" } }
```

未知の工種コードは `400` / `ERR-422`。

### GET `/api/cases`

案件一覧（更新日時降順）。

```json
{
  "cases": [
    {
      "code": "SAMPLE-KANPEKI",
      "name": "岸壁築造工事（架空サンプル）",
      "description": "…",
      "revision": 1,
      "updatedAt": "2026-11-18T00:00:00.000Z",
      "drawing": { "filename": "seawall_plan.dxf", "layerCount": 20, "entityCount": 66 },
      "confirmedLayers": 7,
      "enabledElevations": 8
    }
  ]
}
```

### GET `/api/cases/:code`

案件の全体（図面メタ・レイヤ・要素・工程・割当・標高）。`code` は `^[A-Za-z0-9_-]{1,40}$`。

```json
{
  "case": {
    "meta": { "code": "SAMPLE-KANPEKI", "name": "…", "description": "…", "revision": 1, "updatedAt": "…" },
    "drawing": {
      "meta": {
        "filename": "seawall_plan.dxf",
        "sizeBytes": 7413,
        "units": 6,
        "unitName": "m",
        "layerCount": 20,
        "entityCount": 66,
        "bounds": { "minX": -2, "minY": -30, "maxX": 256, "maxY": 56 },
        "sha256": "…"
      },
      "layers": [],
      "entities": []
    },
    "schedule": {
      "sourceName": "seawall_plan.dxf の工程表",
      "rows": [{ "code": "010", "name": "準備工・汚濁防止膜設置", "start": 1806537600000, "end": 1808956800000 }],
      "badRows": [],
      "columns": { "code": 0, "name": 1, "start": 2, "end": 3 }
    },
    "assignments": [],
    "elevations": []
  }
}
```

日付は UTC 深夜0時の epoch ms。終了日は「翌日0時」で、その日を含む。

### PUT `/api/cases/:code`

案件を保存（新規は revision=1、更新は revision+1）。1トランザクションで子テーブルを置き換える。

```json
{
  "meta": { "name": "案件名", "description": "説明" },
  "drawing": { "meta": { "...": "..." }, "layers": [], "entities": [] },
  "schedule": { "sourceName": "…", "rows": [], "badRows": [], "columns": { "code": 0, "name": 1, "start": 2, "end": 3 } },
  "assignments": [],
  "elevations": []
}
```

検証:

- `drawing.meta.entityCount === entities.length`、`layerCount === layers.length`
- `schedule.rows[].end > start`
- 工種コードがマスタに存在する
- 有効な標高は `top > bottom`
- 要素数上限 200,000、レイヤ 500、工程行 5,000、割当 500、標高 50

成功: `{ "case": { "code": "…", "revision": 2 } }`

## 4. セキュリティヘッダー

`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、
CSP（`default-src 'self'`、`frame-ancestors 'none'`）を付与する。

## 5. 静的配信

`dist/web` が存在する場合、APIはSPAを配信する。`/api/` 以外のGETは `index.html` へフォールバックする。
