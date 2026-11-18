# Preview 用 systemd（user unit）

`docs/deployment.md` の手順で使用する。パスに空白があるため、プロジェクトへの
シンボリックリンク `/home/kensan/d4d-studio` を前提にしている。

## ファイル

| ファイル | 用途 |
| --- | --- |
| `drawing-to-4d-api.service` | Fastify + SPA（`127.0.0.1:8792`） |
| `drawing-to-4d-tunnel.service` | Cloudflare Tunnel（`d4d.mirai-dx-platform.com`） |

## 前提

- `/home/kensan/d4d-studio` → このリポジトリ
- `~/.config/drawing-to-4d/preview.env`（0600）
  - `APP_ENV=preview`
  - `HOST=127.0.0.1`
  - `PORT=8792`
  - `DATABASE_URL=postgresql:///d4d_studio_preview?host=/var/run/postgresql`
  - `APP_TOKEN=<ランダム>`（書込み保護）
- `~/.cloudflared/drawing-to-4d-config.yml`（0600）
- DB `d4d_studio_preview` に migration + seed 済み
- `pnpm build:web` 済み（`dist/web`）

## インストール

```bash
install -m 600 deploy/systemd/drawing-to-4d-api.service ~/.config/systemd/user/
install -m 600 deploy/systemd/drawing-to-4d-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now drawing-to-4d-api.service
systemctl --user enable --now drawing-to-4d-tunnel.service
```

## 確認

```bash
curl -s http://127.0.0.1:8792/healthz
curl -s https://d4d.mirai-dx-platform.com/healthz
systemctl --user status drawing-to-4d-api.service --no-pager
journalctl --user -u drawing-to-4d-api.service -n 50 --no-pager
```

Cloudflare Access により、未認証のアクセスはログインへリダイレクトされる。
`curl` での確認は Access を通らないため 302 になる場合がある。
