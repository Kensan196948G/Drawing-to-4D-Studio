# Security — Phase 1 MVP

版: v1.0（2026-11-18） / 対象: 個人利用MVP・Preview検証環境

## 1. 対象と資産

| 資産 | 内容 | 分類 |
| --- | --- | --- |
| 図面（DXF） | 架空サンプルのみ。実図面は扱わない | 社外秘になり得る（本MVPでは架空） |
| 工程表（CSV） | 架空サンプルのみ | 同上 |
| 工種辞書 | 初期40件＋学習分 | 業務ノウハウ（本MVPでは架空） |
| 案件データ | 図面要素・割当・標高 | 同上 |
| 認証情報 | DB接続・Tunnel資格情報・Access | Secret |

## 2. データフロー

```
[ブラウザ]
  DXF/CSV をローカルで解析（File API）
  3D/4D をブラウザ内で描画
  保存は localStorage（任意で API へ）
      │ HTTPS（Cloudflare Access 認証後）
      ▼
[Cloudflare]  Access（OTP）→ Tunnel
      ▼
[127.0.0.1:8792]  Fastify（SPA + API）
      ▼
[ローカル PostgreSQL]  d4d_studio_preview（架空データ）
```

- 図面の解析・3D/4Dはブラウザ内。解析のために外部へ送信しない。
- APIへ送るのは「保存」を選んだ場合のみ。Previewは架空データ専用。
- 本番環境・実データDBへは接続しない。

## 3. 統制（実装・設定）

| 統制 | 内容 | 状態 |
| --- | --- | --- |
| 認証 | Cloudflare Access（ワンタイムパスワード）。許可: `kensan1969@gmail.com`、`mirai-const.co.jp`。セッション12時間 | 設定済み |
| 公開範囲 | `https://d4d.mirai-dx-platform.com` は Access 保護。`/healthz` のみ bypass（状態のみ、データなし） | 設定済み |
| ネットワーク | APIは `127.0.0.1:8792` のみ。PostgreSQLは Unix socket / loopback のみ。Tunnel経由のみ到達 | 設定済み |
| 書込み保護 | 環境変数 `APP_TOKEN` を設定した場合、POST/PUTに `X-App-Token` を要求。Previewは Access で保護（APP_TOKEN未設定） | 実装済み・任意 |
| 入力検証 | Zod によるスキーマ検証、件数上限（要素20万、レイヤ500、工程5,000、割当500、標高50）、本文12MB上限 | 実装済み |
| SQL | `pg` のパラメータ化クエリのみ。文字列連結なし | 実装済み |
| トランザクション | 案件保存は1トランザクション。失敗時ロールバック | 実装済み |
| セキュリティヘッダー | CSP（`default-src 'self'`）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` | 実装済み |
| ログ | リクエストの method/url/status のみ。本文・トークン・認証ヘッダーは記録しない | 実装済み |
| Secret管理 | リポジトリに秘密情報なし。Tunnel資格情報は `~/.cloudflared`（0600）。DBは peer 認証 | 確認済み |
| 依存関係 | `pnpm audit --prod --audit-level=high` = 既知脆弱性なし | 確認済み |
| ライセンス | 本番依存84件: MIT 69 / BlueOak-1.0.0 6 / BSD-3-Clause 3 / ISC 6。コピーレフトなし | 確認済み |
| バックアップ | Preview DBのdump→別DB復元→verify→後片付け（`scripts/restore-drill.sh`） | PASS |
| 再起動 | API再起動後、ローカル/公開 `/healthz` が200へ復帰 | PASS |

## 4. 証拠

| 検証 | 結果 | 証拠 |
| --- | --- | --- |
| Secret scan | 検出0（76ファイル） | `pnpm secret-scan` |
| 依存監査 | 既知脆弱性なし | `pnpm audit --prod --audit-level=high` |
| ライセンス | コピーレフトなし | `pnpm licenses list --prod` |
| Access保護 | 未認証 `/` は302→Accessログイン | `docs/evidence/preview-verification.json` |
| health | 公開/ローカル `/healthz` 200 / db.ok | 同上 |
| 復元 | restore drill PASS（cases=2, work_types=10, elevations=20） | `docs/evidence/restore-drill.json` |
| 再起動 | API再起動後 200 | `docs/project/progress.md` |

## 5. 残余リスク

| # | リスク | 影響 | 対応 |
| --- | --- | --- | --- |
| S-01 | Preview は Access のOTPに依存。許可されたメールアカウントが侵害されると到達可能 | 中 | 12時間セッション、必要な場合のみAccessポリシーを見直す |
| S-02 | `/healthz` は公開。version/env/db状態を返す | 低 | データを含めない。必要ならAccess保護へ変更 |
| S-03 | APIにレート制限・WAFカスタムルールなし | 低〜中 | Access保護で一般公開を制限。必要時にCloudflare Rate Limiting |
| S-04 | `APP_TOKEN` 未設定（Accessのみ） | 中 | 多層防御が必要なら設定。値は会話・ログに出さない |
| S-05 | localStorage は同一オリジンのJSから読める | 低 | XSS対策（CSP・DOM構築時のエスケープ）を実装で徹底 |
| S-06 | 実図面を扱う場合、ブラウザ内処理でも端末の管理が必要 | 中 | 第2段階で端末・アカウント運用を定義 |
| S-07 | 依存の供給チェーン（pnpm approve-builds で esbuild を許可） | 低 | lockfile固定、`pnpm audit`、CIで`--frozen-lockfile` |
| S-08 | バックアップはローカルdumpのみ（暗号化なし） | 低 | 架空データのみ。実データ移行時に暗号化・保管先を定義 |

## 6. 禁止事項（再掲）

- 実データ・社外秘図面・個人情報を、DB・Seed・テスト・ログ・AIへ持ち込まない。
- Secretをリポジトリ・commit・PR・ログ・画面へ書かない。
- 本番環境・本番DB・本番DNSを変更しない。
- Accessポリシー・公開範囲の重大変更を独断で行わない。
- 破壊的DB操作を、専用の検証DB以外で行わない。
