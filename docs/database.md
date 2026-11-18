# Database — PostgreSQL

## 1. データベース

| DB | 用途 | 接続 |
| --- | --- | --- |
| `d4d_studio` | 開発 | `postgresql:///d4d_studio?host=/var/run/postgresql` |
| `d4d_studio_test` | テスト（毎回作り直す） | `postgresql:///d4d_studio_test?host=/var/run/postgresql` |
| `d4d_studio_preview` | Preview（計画） | Preview サービス専用 |

- 認証情報は環境変数 `DATABASE_URL` / `TEST_DATABASE_URL` で渡す。値を文書・ログへ書かない。
- ローカルPostgreSQLは `127.0.0.1` / Unix socket のみ。インターネットへ公開しない。
- Preview から本番DB・開発DBへ接続しない。

## 2. Migration

```
db/migrations/001_init.sql
```

- `scripts/db.ts` が `schema_migrations`（id, checksum, applied_at）を管理する。
- 適用済み migration の checksum が変わった場合は **エラーで停止**する。変更は新しい migration を追加する。
- 適用は1ファイル1トランザクション。失敗時はロールバックする。

```bash
pnpm db:migrate
```

## 3. Seed

`scripts/seed.ts` が次を投入する（再実行可能）。

1. 工種マスタ10件（010〜090）
2. 初期辞書40件
3. サンプル案件 `SAMPLE-KANPEKI`
   - `src/web/public/samples/seawall_plan.dxf` を実際に解析した結果（20レイヤ・66要素）
   - 工程表10行
   - 工種割当20件（信頼度0.5以上を確定）
   - 標高10件（断面注記を反映）

サンプル案件のみ削除して作り直す。他の案件には触れない。すべて架空データ。

```bash
pnpm db:seed
```

## 4. Verify

```bash
pnpm db:verify
```

確認内容: 工種10件、辞書40件以上、サンプル案件、図面1件・要素>0、工程10行、割当15件以上、標高10件、
親案件の存在、有効な標高の `top > bottom`、確定済み割当の整合。1つでも失敗すると exit 1。

## 5. Reset（開発・テストのみ）

```bash
pnpm db:reset --yes
```

- `--yes` 必須。
- 対象DB名が `d4d_studio` / `d4d_studio_test` / `d4d_studio_dev` のいずれか、または `ALLOW_RESET=1` のときだけ実行できる。
- `DROP SCHEMA public CASCADE` → `CREATE SCHEMA public` → migration 再適用。
- Preview・本番相当DBでは実行しない。

## 6. Schema

| テーブル | 役割 | 主な制約 |
| --- | --- | --- |
| `work_types` | 工種マスタ | PK `code`（3桁）、`sequence` は4種 |
| `dictionary_terms` | 工種辞書 | `UNIQUE(pattern, match_type)`、FK `work_type_code` |
| `cases` | 案件 | `UNIQUE(code)`、`revision > 0` |
| `case_drawings` | 図面（メタ＋要素JSON） | PK `case_id`、FK CASCADE |
| `case_schedule_rows` | 工程行 | FK CASCADE、`end_date >= start_date` |
| `case_assignments` | 工種割当 | `UNIQUE(case_id, layer)`、FK CASCADE |
| `case_elevations` | 標高 | PK `(case_id, work_type_code)`、有効時 `top > bottom` |

### 設計メモ

- 図面要素は `case_drawings.entities`（JSONB）に保存する。MVPでは検索対象ではないため正規化しない。
- 標高は `enabled=false` の工種（準備工・片付け）を 0/0 で保持できるよう、`NOT enabled OR top > bottom` とする。
- 案件保存は1トランザクションで、子テーブルを削除→再挿入する（revision を1増やす）。
- 同時更新の楽観ロックは未実装（個人利用MVP）。必要になったら `revision` を条件に追加する。

## 7. Backup / Restore

```bash
# 取得
pg_dump -Fc d4d_studio > d4d_studio_YYYYMMDD.dump

# 復元（空DBへ）
createdb d4d_studio_restore
pg_restore -d d4d_studio_restore d4d_studio_YYYYMMDD.dump
```

- 復元先は別DB名にする。既存DBへ上書きしない。
- 復元後は `pnpm db:verify` と `GET /healthz` を確認する。
- サンプルデータのみのMVPのため、実データのバックアップ要件は第2段階で定義する。

## 8. データ方針

- 実データ・社外秘図面・個人情報を投入しない。Seed・テスト・ログは架空データのみ。
- 秘密情報をDBへ保存しない（接続情報は環境変数）。
- Preview は専用DBを使い、開発DBを参照させない。
