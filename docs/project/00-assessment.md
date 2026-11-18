# 00 Assessment — Drawing-to-4D Studio

実施日: 2026-11-18（JST） / 対象: `/home/kensan/Projects/Business-Project/Drawing-to-4D Studio`

## 1. 実行環境（実測）

| 項目 | 実測値 | 根拠 |
| --- | --- | --- |
| cwd | `/home/kensan/Projects/Business-Project/Drawing-to-4D Studio` | `pwd` |
| ホスト | `kensan1969` / Ubuntu 24.04 (kernel 7.0.0-43) | `hostname` / `uname -a` |
| ユーザー | `kensan` | `whoami` |
| DSH | 0.2.1-rc.4 | `dsh --version` |
| モデル | `deepseek-flash`（セッション選択中） | `list_agents` |
| 権限 | file policy = danger-full-access。承認プロンプトは無効化（承認要求不可）。シェルはポリシープロキシ経由でネットワーク接続 | runtime context |
| Node / pnpm | v22.22.3 / 12.21.0 | `node --version` / `pnpm --version` |
| PostgreSQL | **サーバー 16.15**（`psql` クライアントは 18.6）、`/var/run/postgresql:5432` 受付中、`postgresql.service` active | `show server_version` / `pg_isready` / `systemctl` |
| GitHub CLI | 2.45.0、`Kensan196948G` でログイン（repo/workflow/gist/read:org） | `gh auth status` |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID` 設定済み。`cloudflared tunnel list` 応答あり（既存トンネル多数） | 環境変数 / CLI |
| OpenDesign | 0.21.1、`http://127.0.0.1:5173`（200）、daemon `127.0.0.1:7456` | `curl` / `od tools directions` |
| Agent Teams | 有効（セッションに Team Lead として参加）。現時点のメンバーは lead のみ | `list_agents` |

利用可能な主なツール: シェル、ファイル Read/Write/Edit、Glob/Grep、ブラウザ（dsh_browser_*）、GitHub ツール群、Cloudflare MCP、OpenViking メモリ、Task Passport、goal、Agent Teams、サブエージェント。
OpenDesign は MCP としては本セッションに公開されていないが、CLI（`od`）と daemon API が利用できる。

## 2. プロジェクトの初期状態（実測）

作業開始時、**Git リポジトリではなかった**（`.git` なし、remote なし）。存在したのは次の4ファイルのみ。

| ファイル | 内容 | 位置づけ |
| --- | --- | --- |
| `2D施工計画図 4D化システム 企画構想案 V1.0.html` | 全17章の構想案。Phase 0〜3、6ステップ、自動化範囲、レイヤ名ルール案、システム構成、KPI | 要件の候補。**「ワーキンググループ検討用（案）」であり承認済み仕様ではない** |
| `Drawing-to-4D Studio 2D施工計画図 4D化 Standalone PoC V1.0.html` | 628KB の単一HTML。three.js r160 を内包。4ステップ＋4D表示、サンプル図面を内蔵 | Phase 0 の見せ方サンプル（**ソースは minify 済みバンドルのみ**） |
| `サンプル_岸壁施工計画図.dxf` | ASCII DXF（AC1015、$INSUNITS=6=m）。平面図＋標準断面図＋標高注記 | 架空のサンプルデータ |
| `サンプル_工程表.csv` | 10工種、2027/04/01〜2028/03/24 | 架空のサンプルデータ |

初期状態の整理:
- 実装コード、テスト、CI、DB、Migration、Seed、API、認証、配備設定は **存在しない**。
- PoC は「見せ方の確認」であり、DXFを取り込んで作り替える版ではない（構想案 §13 の Phase 1 が今回の対象）。
- 構想案は V1.0 の「案」であり、名称・リポジトリ名・対象工種・工程表CSVの列・第2段階のサーバ配置は未決事項として明記されている。

## 3. インプットから確定できた要件

- 目的: 2D施工計画図と工程表から、施工順序が伝わる4Dを作る。
- 利用者: 施工計画担当（1名）。
- 価値: 専用ソフトなしで、確認中心の半自動で4Dを作り、説明に使う。
- Phase 1 の範囲: DXF＋工程表CSVの取り込み、レイヤ名等からの工種推定、担当者による確認、標高付与、押し出し3D、工程連動4D、保存。
- Phase 1 の非対象: SXF/PDF/Excel/DWG直接、AI推定、Blender動画、IFC/glTF、複数ユーザー、本番運用。
- 重要な制約: 図面は外部に出さない。概略の4Dであり数量・干渉確認には使わない。

## 4. Gap Discovery（初期状態で不足していたもの）

| 区分 | 不足 | MVPへの影響 | 対応 |
| --- | --- | --- | --- |
| 実装 | Phase 1 のアプリ本体が無い | 中核価値が動作しない | 新規実装（本作業） |
| 実装 | DXF パーサ、工程表パーサ、工種推定、3D生成、4D再生のコードが無い | 同上 | `src/core` に実装済み（2026-11-18） |
| テスト | 単体・結合・E2E が無い | 回帰を保証できない | Vitest / Playwright を追加 |
| CI | GitHub Actions が無い | マージ条件を満たせない | `ci.yml` を追加 |
| DB | Schema / Migration / Seed が無い | 保存・辞書共有を検証できない | PostgreSQL 16（実測 16.15）に追加 |
| 配備 | Preview が無い | 実操作の証拠を残せない | Cloudflare Tunnel + systemd |
| 認証 | 認証・認可が無い | 公開範囲を制御できない | Cloudflare Access（第一候補） |
| 文書 | README、要件、設計、DB、API、Test、Deployment が無い | 引継ぎできない | `docs/` に整備 |
| 設計 | OpenDesign の成果物が無い | WebUI 実装の承認根拠が無い | 設計仕様を作成し登録済み |

## 5. 既知のリスク・未確認事項

| # | 内容 | 影響 | 扱い |
| --- | --- | --- | --- |
| R-01 | 構想案は「案」であり、承認済み仕様ではない | 仕様の正本が弱い | 本AssessmentとMVP Scopeで仮定を明示し、設計承認を得る |
| R-02 | 構想案の Phase 1 は「完全オフライン Standalone」、一方で本開発指示は Cloudflare Preview とローカルPostgreSQLを含む | 構成の矛盾 | Phase 1 の中核はオフラインSPAとし、検証環境のみ API/DB を追加する（下記 6）。設計承認時に明示 |
| R-03 | PoC は minify 済みでソースが無い | 再利用できない | 画面の見た目・トークンのみ参照し、実装は新規 |
| R-04 | 実図面（社外秘）は無い | 精度の実測ができない | 架空サンプルで検証。実図面検証は利用者側の作業として残す |
| R-05 | Cloudflare Access の設定可否が未確認 | Preview の保護方法 | 設定可能なら Access、不可ならアプリトークン＋非公開URLで代替し、制限を記録 |
| R-06 | ブラウザ localStorage の容量（約5MB） | 大きな図面の保存 | 保存前にサイズ検査。超過は ERR-107 とし、図面は再取込で復元 |
| R-07 | 方式B（断面押し出し）は今回未実装 | 捨石等の断面形状の再現度 | 方式A（平面押し出し）でMVP。Backlogへ |
| R-08 | 認証情報・秘密値は出力しない | — | 値は表示せず、キー名と有無のみ記録 |

## 6. 構成上の判断（設計承認の対象）

構想案の Phase 1（完全オフライン）と、開発指示の基盤（Cloudflare Preview / ローカルPostgreSQL）を両立させるため、次の二層構成とする。

1. **製品の中核 = オフラインSPA**。DXF/CSVの解析・工種推定・3D・4D・保存はすべてブラウザ内。`file://` で動作し、図面を送信しない。
2. **検証環境 = SPA + ローカルAPI + PostgreSQL**。APIは「サンプル案件カタログ」「工種辞書の共有」「案件のサーバ保存（任意）」のみを担当。SPAはAPI不在でも全主要フローを実行できる。PreviewはCloudflare TunnelでローカルAPIへ接続し、DBは `127.0.0.1` のみ。
3. **本番環境は対象外**。プレビュー用の専用DB（`d4d_studio_preview`）を使い、実データを置かない。

この判断により、構想案の「図面は社外に出ない」を守りつつ、指示された GitHub / Cloudflare / PostgreSQL の検証要件を満たす。

## 7. 初動の結論

- 実装対象は明確（Phase 1 の5ステップ）。
- 中核ロジック（DXF・CSV・工種推定・標高・3D・4D）は実装済みで、サンプルに対して37件の単体テストが成功。
- 次は WebUI 設計の承認を得て、画面実装 → API/DB → CI → Preview の順に進む。
