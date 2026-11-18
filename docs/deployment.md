# Deployment — Cloudflare Preview（検証環境）

> **状態: Preview に Phase 1 MVP を配備済み（2026-11-18 10:16 JST、main `41f443b`）。**
> 公開URLのAccessログイン後の画面操作のみ利用者確認待ち。本番正式環境・本番DNS・本番自動配備は対象外。

## 1. 構成（計画）

```
Browser
  → https://d4d.mirai-dx-platform.com（Cloudflare プロキシ）
  → Cloudflare Access（メールOTP。未設定なら APP_TOKEN で代替）
  → Cloudflare Tunnel `drawing-to-4d`
  → http://127.0.0.1:8792（Fastify: SPA + API）
  → ローカルPostgreSQL `d4d_studio_preview`（127.0.0.1:5432）
```

- 図面の解析・4D表示はブラウザ内。APIはカタログ・辞書・任意の案件保存のみ。
- PostgreSQL は `127.0.0.1` / Unix socket のみ。インターネットへ直接公開しない。
- Preview は開発DB・本番DBへ接続しない。
- 本番自動配備を起動するマージ経路は作らない。

## 2. 前提条件（Deployment Gate）

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:integration` / `pnpm build` 成功
- [ ] `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:verify` 成功（空DBから再現）
- [ ] `pnpm secret-scan` 成功
- [ ] Critical/High の既知問題なし
- [ ] `docs/test.md` の未実施項目を認識している
- [ ] Cloudflare Access の適用可否を確認（不可なら `APP_TOKEN` + 非公開URL）
- [ ] 新しい費用・契約が発生しないことを確認

## 3. 手順（再現用）

```bash
# 1. Preview DB
createdb d4d_studio_preview
DATABASE_URL='postgresql:///d4d_studio_preview?host=/var/run/postgresql' pnpm db:migrate
DATABASE_URL='postgresql:///d4d_studio_preview?host=/var/run/postgresql' pnpm db:seed
DATABASE_URL='postgresql:///d4d_studio_preview?host=/var/run/postgresql' pnpm db:verify

# 2. ビルドと再配置（Web + API再起動 + 確認）
pnpm deploy:preview   # 既存のPreviewを更新する場合

# 3. 設定（0600。値はリポジトリへ置かない）
mkdir -p ~/.config/drawing-to-4d
# 例: APP_ENV=preview / PORT=8792 / DATABASE_URL=... / APP_TOKEN=...

# 4. systemd（user）
systemctl --user daemon-reload
systemctl --user enable --now drawing-to-4d-api.service
systemctl --user enable --now drawing-to-4d-tunnel.service

# 5. Tunnel（初回のみ）
cloudflared tunnel create drawing-to-4d
cloudflared tunnel route dns --overwrite-dns drawing-to-4d d4d.mirai-dx-platform.com
```

systemd unit と tunnel 設定は `deploy/systemd/` に置く（実装後）。

## 4. 検証記録（2026-11-18 09:16 JST / Preview基盤）

| 項目 | 実測値 |
| --- | --- |
| URL | `https://d4d.mirai-dx-platform.com` |
| 対象commit | `406c462`（main / PR #3 マージコミット、UI文言修正） |
| 配備日時 | 2026-11-18 09:16 JST（基盤）/ 09:53 JST（UI）/ 10:16 JST（main反映）/ **10:39 JST（文言修正）** |
| Tunnel | `drawing-to-4d` / `5cf82d33-4615-49c9-a4ba-a031310e4760` / 4コネクション（nrt01, nrt05, nrt14, nrt18） |
| DNS | `d4d` CNAME → `5cf82d33-….cfargotunnel.com`（proxied） |
| systemd | `drawing-to-4d-api.service`（active）、`drawing-to-4d-tunnel.service`（active） |
| API | `127.0.0.1:8792` |
| DB | `d4d_studio_preview`（migration/seed/verify PASS） |
| Access | アプリ `Drawing-to-4D Studio Preview`（`84df45bf-b4cc-4b3a-8006-b42670668690`）、OTP、許可: `kensan1969@gmail.com` / `mirai-const.co.jp`、12時間 |
| Access（health） | `/healthz` のみ bypass（`3d1f6243-3c52-4117-b945-f6541e7c8366`）。状態のみでデータなし |
| `/healthz`（公開） | 200 / `{"status":"ok","env":"preview","db":{"ok":true}}` |
| `/`（未認証） | 302 → `winter-lake-f4c9.cloudflareaccess.com` のログイン |
| 静的配信 | 200、CSP / X-Frame-Options / nosniff 付与 |
| API（カタログ） | 工種10件 / 辞書40件 / 案件 `SAMPLE-KANPEKI` |
| UI配信 | origin `/` の title=`Drawing-to-4D Studio`、bundle に「工種の割り当て」を確認 |
| F1 実操作（画面） | ローカルE2Eで成功（F1/F2/F3 ほか9件）。公開URLは **Accessログイン後の確認待ち** |
| 保存→再読込 | APIレベルで成功（`VERIFY-CORE-01`、66要素・10工程・20割当・10標高） |
| スクリーンショット | `docs/evidence/screens/01-import.png` 〜 `06-save-dialog.png`（ローカルE2Eで撮影） |

### 注意

- 公開URLは Cloudflare Access で保護されている。`/healthz` のみ bypass。
- 画面の実操作確認は、Access へログインして公開URL上で行う（AIはOTP入力を行わない）。
- ローカルE2E（`pnpm test:e2e`）は同じビルドを `127.0.0.1:8791` で配信して実行している。
- プレースホルダUIのため、現時点の画面確認は「配信経路とDB接続」の確認に限る。

## 5. 復旧・ロールバック

| 事象 | 対応 |
| --- | --- |
| Preview が 502/タイムアウト | `systemctl --user status drawing-to-4d-api.service`、`journalctl --user -u drawing-to-4d-api.service`、`curl 127.0.0.1:8792/healthz`、tunnel の接続を確認 |
| API が起動しない | 環境変数（`DATABASE_URL` / `PORT`）を確認。`pnpm build` の成果物を確認 |
| DB不整合 | `d4d_studio_preview` を空DBから再構築（Migration→Seed）。実データは置かない |
| 直近の変更が原因 | 直前の commit を revert して再ビルド・再起動 |
| 公開範囲の懸念 | Access ポリシーを確認。必要なら tunnel を停止（`systemctl --user stop drawing-to-4d-tunnel.service`） |

停止しても、ローカルの Standalone HTML と開発APIは利用できる。

## 6. CI

`.github/workflows/ci.yml` は self-evolution policy gate によりAIからは配置できなかったため、
2026-11-18 に利用者が [`deploy/ci/ci.yml`](ci/ci.yml) を適用した（commit `0936160`）。

- PR #1: `quality` / `e2e` 成功 → **Merged**（`41f443b`）
- main: CI 成功（run 44214408017）
