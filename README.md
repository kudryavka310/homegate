# HomeGate

## HomeGate利用者向け（ブラウザのみ）

HomeGateは、Discordからスマートロックへのアクセスを管理するセルフホスト型アクセスコントロールサービスです。

- PCへのインストール不要
- Node.js不要
- ターミナル操作不要
- 利用者自身のCloudflare環境で動作

現在はMock Lock Serviceを使うPoCです。実際のSESAMEスマートロックはまだ操作しません。

### 導入手順

1. [`docs/deploy.html`](docs/deploy.html)を開き、Deploy to Cloudflareを押します。Cloudflareへログインし、作成先AccountとWorker名を選びます。既存のWorker、DNS、ドメイン、D1、KVは変更しません。
2. Discord Developer PortalでApplicationを作成します。
3. Cloudflare DashboardのWorker → Settings → Variables and Secretsに、Discord画面で取得した3つの値をSecretとして保存します。
   - `DISCORD_PUBLIC_KEY`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
4. Worker URLの`/setup/discord`を開き、画面の案内に沿ってコマンドを登録します。
5. 画面に表示されたInteractions Endpoint URLをDiscord Developer Portalへ貼り付けて保存します。
6. 画面のリンクからDiscord ServerへAppを追加します。要求する権限は0です。
7. Discordで`/ping`を実行します。`HomeGate is running.`が表示されれば完了です。

Secret値はHomeGateの画面へ入力せず、Cloudflare Dashboardだけに保存します。HTML、URL、ログへSecretを表示しません。Discord Applicationの作成とInteractions Endpoint URLの保存は、Discord公式画面での操作として残しています。

この作業フォルダには公開リポジトリURLがまだないため、Deploy ButtonのURLは[`docs/deploy.html`](docs/deploy.html)の1箇所だけに置いています。公開者が実際の公開GitHubまたはGitLab URLへ置き換えてから配布してください。

### E2E確認

実環境での確認項目は[`docs/e2e-checklist.md`](docs/e2e-checklist.md)にまとめています。

## 開発者向け

DiscordのSlash CommandをCloudflare Workerで受け、Mockの鍵を操作するPoCです。Gatewayへの常時接続や常駐Botサーバーは使いません。利用者自身のCloudflareアカウントに配置します。

```text
Discord → POST /interactions → Ed25519署名検証 → Command Router → LockService → Mock
```

## 実装範囲

| コマンド | 応答例 |
| --- | --- |
| `/ping` | `HomeGate is running.` |
| `/status` | `Studio Door` + 改行 + `Status: Locked` |
| `/lock` | `Studio Door has been locked.` |
| `/unlock` | `Studio Door has been unlocked.` |

応答は実行者だけに見えるEphemeralメッセージです。Discordのエンドポイント確認用PING（Interaction type 1）にも応答します。

**Mockの状態はWorkerの単一インスタンスのメモリ内だけで保持します。** 初期値はLockedです。同じインスタンスではunlock → statusでUnlockedになりますが、再起動・再デプロイ・別インスタンス・別拠点への振り分けでは状態がリセットされたり一致しなかったりします。永続的な鍵状態や実機の状態を示すものではありません。

SESAME API、D1/KV、ユーザー管理、Permission Engine、一時アクセス、監査ログ、Passkey/TOTP、Calendar/LINE、管理Web UIは未実装です。コマンドを実行できるDiscordユーザーはMockを操作できます。署名検証は送信元と改ざんを検証するもので、ユーザーの解錠権限の判定ではありません。

## ファイル構成

```text
src/
  index.ts                    HTTP入口・構成検証・エラー処理・サービス注入
  discord/
    verify.ts                 生の本文とtimestampに対するEd25519署名検証
    commands.ts               Slash Command定義
    interaction.ts            コマンドからLockServiceを呼ぶルーター
  services/lock-service.ts     LockService契約とMock実装
  types/discord.ts            Interaction型と入力検証
  web/pages.ts                トップ、初期設定、Discord設定画面
  discord/command-registration.ts  Client CredentialsとDiscord REST API登録
scripts/register-commands.ts   テストサーバーへのコマンド登録
tests/                        署名・異常系・Workers実行環境の統合テスト
docs/deploy.html              利用者向けDeploy Button配布ページ
docs/e2e-checklist.md         公開・実環境E2Eの手順と未確認項目
wrangler.jsonc                Worker設定
.dev.vars.example             Workerローカル設定の雛形
.env.example                  Deploy Button／Worker Secretの雛形
.env.register.example         開発者のコマンド登録用設定の雛形
```

## 開発者のローカル環境

開発者のみNode.js 22.17以上とnpmを用意してください。プロジェクトフォルダで実行します。

```sh
npm ci
```

`.dev.vars.example`を`.dev.vars`にコピーし、Discord Developer PortalのApplication Public Key（64桁の16進数）を設定します。ファイルコピーはエディタやファイルマネージャーでも構いません。`.env.example`には、Deploy Buttonで入力できるPublic Key、Application ID、OAuth2 Client Secretの項目を置いています。

```dotenv
DISCORD_PUBLIC_KEY=YOUR_APPLICATION_PUBLIC_KEY
```

```sh
npm run dev
```

既定のURLは`http://localhost:8787`です。`GET /`はサービス名・Mockモード・エンドポイントの案内を返します。`POST /interactions`は署名必須で、未署名のcurl等は401になります。署名検証の無効化機能はありません。

Discordはlocalhostへ直接アクセスできません。Discordからの確認には以下のCloudflareへのデプロイを使ってください。

## 検証

```sh
npm run typecheck
npm test
npm run build
```

`npm test`は一時的なEd25519鍵ペアでリクエストを署名します。実際のDiscordやCloudflareの認証情報は不要です。WranglerのローカルWorkers実行環境でPING、4コマンド、施錠・解錠後の状態、偽署名の拒否を確認し、単体テストで本文・timestamp改ざん、期限切れ、入力不正、内部エラーの秘匿も確認します。

`npm run build`はデプロイのdry runです。`dist/`にバンドルを出力し、クラウドには公開しません。Windows PowerShellの実行ポリシーでnpmが止まる場合は、開発用コマンドの`npm`を`npm.cmd`に置き換えてください。

## DiscordとCloudflareの初期設定

### 1. Discord Applicationを作る

1. [Discord Developer Portal](https://discord.com/developers/applications)でNew Applicationを作成します。PoC専用Applicationを推奨します。
2. General InformationのApplication IDとPublic Keyを控えます。Public Keyを`.dev.vars`に入れます。
3. Botページで登録用Bot Tokenを取得します。必要な場合のみReset Tokenを使ってください。既存Tokenをリセットすると、そのTokenを使う別の処理が停止します。
4. Discordクライアントの設定 → 詳細設定 → 開発者モードを有効にし、テストサーバーを右クリックしてサーバーIDをコピーします。

### 2. Botをテストサーバーに追加する

Developer PortalのInstallationでGuild Installを有効にします。OAuth2 URL Generatorで`bot`と`applications.commands`を選び、生成したURLからテストサーバーへ追加します。Bot Permissionsは追加不要（0）です。Administrator権限やPrivileged Gateway Intentsは必要ありません。追加にはそのサーバーの管理権限が必要です。

Botがオフライン表示でも正常です。このPoCはGatewayへ接続しません。

### 3. Slash Commandを登録する

`.env.register.example`を`.env`にコピーして設定します。このファイルは開発者のコマンド登録専用で、Workerへデプロイしません。

```dotenv
DISCORD_APPLICATION_ID=YOUR_APPLICATION_ID
DISCORD_GUILD_ID=YOUR_TEST_SERVER_ID
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
```

```sh
npm run register:commands
```

指定したテストサーバーに4コマンドを登録します。グローバル登録は行いません。同名のSlash Commandは更新し、無関係なコマンドは削除しません。途中で失敗した場合も再実行できます。401/403ではToken・Applicationの一致・サーバーへの追加状態を確認し、429では時間を置いて再実行してください。

**Bot Tokenは開発時の登録専用です。Workerには不要です。** `.env`と`.dev.vars`はGit対象外です。コミット、画面共有、チャットへの貼り付けを避けてください。

### 4. 自分のCloudflareアカウントへ配置する

`wrangler.jsonc`の`name`が既存の別Workerと衝突しないことを確認し、必要なら名前を変更します。以下は開発者向け手順です。

```sh
npx wrangler login
npm run deploy
npx wrangler secret put DISCORD_PUBLIC_KEY
```

Secret入力プロンプトに、手順1のPublic Keyを入力します。最初のdeployからSecret設定までの間、`/interactions`は503で閉じた状態になります。Secret設定後に利用できます。Cloudflare DashboardのWorker → Settings → Variables and SecretsからSecretとして追加・デプロイすることもできます。

| Worker Secret | 内容 |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Discord ApplicationのPublic Key。必須。 |
| `DISCORD_CLIENT_ID` | Application ID。`/setup/discord`のブラウザ登録に必要。開発者のBot Token登録だけなら任意。 |
| `DISCORD_CLIENT_SECRET` | OAuth2 Client Secret。`/setup/discord`のブラウザ登録に必要。開発者のBot Token登録だけなら任意。 |

Public Key自体は公開鍵ですが、このPoCでは指定どおりSecretとして管理します。SESAME API KeyとDiscord Bot TokenはWorkerに設定しません。Client Secretを設定する場合も、`wrangler.jsonc`の`vars`やソースへ埋め込まずSecretに保存します。

### 5. Interactions Endpoint URLを設定する

deployの出力にあるURLに`/discord/interactions`を付けます（旧`/interactions`も互換のため受け付けます）。

```text
https://homegate.<YOUR_SUBDOMAIN>.workers.dev/discord/interactions
```

Developer Portal → General Information → Interactions Endpoint URLに入力して保存します。Discordの署名付きPINGへ`{"type":1}`を返せれば保存できます。保存できない場合は、Public Keyが同じApplicationのものか、Secretを設定済みか、URLのパスが正しいか確認してください。

### 6. Discordで確認する

Worker URLの`/setup/discord`を開き、「4コマンドを登録・確認」を押します。公式にClient Credentialsが対応しているグローバルコマンドAPIで登録状態を確認できます。Interactions Endpoint URLとPublic Keyの一致は、Discord Developer Portalで保存するときの署名付きPING検証で確認します。次に「DiscordサーバーへAppを追加」から`applications.commands`だけ、権限0でインストールします。Developer PortalでEndpoint URLを保存した後、テストサーバーのチャンネルで`/ping`、`/status`、`/unlock`、`/status`、`/lock`、`/status`の順で実行します。コマンドが出ない場合はアプリのインストール先、ユーザーの「アプリコマンドを使う」権限、グローバル反映時間を確認してください。Mockの状態は前述のとおり複数インスタンス間では共有されません。

開発者は`npx wrangler tail`でWorkerログを確認できます。エラーログには固定のイベント名・生成したリクエストID・Interaction種別だけを記録します。受信本文、ヘッダー、例外本文、Token、API Keyはログに出しません。

## 設計上の境界と将来の拡張

- Discordハンドラーは`LockService`のインターフェースだけを参照します。実機接続時は`services/`と`adapters/`で実装を差し替えます。
- Permission Engine導入時は、Discord User ID・対象デバイス・操作・有効期限を検証するアプリケーションサービスをLockService呼び出しの前に置きます。期限の判定は操作時に行い、Cronだけに失効を依存させない設計を想定します。今回その機能は実装していません。
- 署名はJSON解析前の生の本文で検証します。timestampは過去・未来とも300秒の範囲に制限します。永続的な重複排除は未実装で、その範囲内の同一リクエスト再送は受け入れます。
- Mockは即時応答します。実機APIなどで処理が長くなる際には、Discordの初回応答期限に合わせたdeferred responseと後続応答を追加してください。
- Workerの実行コードはWeb標準APIのみで、ローカルOS、Node.js、ファイルシステムへの依存はありません。Node.jsとWranglerは開発ツールです。
- 販売者の中央サーバーへ鍵情報を送る処理はありません。将来のSESAME等の秘密情報も利用者自身のCloudflare環境に保存する前提です。
- エンドユーザーのDeployと初期設定は、`docs/deploy.html` のDeploy Button、`/setup`、`/setup/discord`でブラウザから進められます。Discord Applicationの作成とInteractions Endpoint URLの保存は公式画面での手動操作として残しています。最終利用者にNode.js、npm、Wrangler、Git、ターミナルを要求しません。

## 公式資料

- [Cloudflare Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Deploy ButtonのSecrets対応](https://developers.cloudflare.com/changelog/post/2025-07-01-workers-deploy-button-supports-environment-variables-and-secrets/)
- [Wranglerで必須Secretを宣言](https://developers.cloudflare.com/changelog/post/2026-03-24-secrets-config-property/)
- [Discord Interactionsと署名検証](https://docs.discord.com/developers/interactions/overview)
- [Discordの応答形式・初回応答期限](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Slash Commandの登録とスコープ](https://docs.discord.com/developers/interactions/application-commands)
- [Discord OAuth2とClient Credentials](https://docs.discord.com/developers/topics/oauth2)
- [Discord Application管理API](https://docs.discord.com/developers/resources/application)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
