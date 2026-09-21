# HomeGate 公開・実環境E2Eチェックリスト

このチェックリストは、CloudflareとDiscordの実アカウントを使って、初めてHomeGateを導入する人がブラウザだけで`/ping`まで到達できるか確認するためのものです。

このリポジトリでは外部アカウントへのログイン、公開操作、実Workerの作成を代行しません。資格情報を設定した担当者が、実施日とURLを記録してください。

## 事前条件

- [ ] Cloudflare OAuth Clientを作成し、Public化に必要なClient URLのドメイン検証を完了した
- [ ] OAuth ClientのRedirect URLが`https://<Installer host>/oauth/callback`になっている
- [ ] OAuth Clientのscopeが`account.read`、`workers-platform.read`、`workers-platform.write`だけになっている
- [ ] Installerへ`CLOUDFLARE_OAUTH_CLIENT_ID`、`HOMEGATE_OAUTH_STATE_SECRET`、`HOMEGATE_BUNDLE_URL`を設定した
- [ ] `HOMEGATE_BUNDLE_URL`のbundleがHTTPSで取得できる
- [ ] `HOMEGATE_BUNDLE_URL`が`releases/0.1.0/homegate.js`を指している
- [ ] リポジトリに`.env`、`.dev.vars`、Bot Token、Client Secret、Cloudflare Account IDなどの実値がない
- [ ] Cloudflare Accountへブラウザでログインできる
- [ ] Discord Developer Portalへブラウザでログインできる
- [ ] テスト用Discord ServerでAppを追加できる権限がある

## Cloudflare OAuth Installer

- [ ] Installerの`/install`を開ける
- [ ] 「Cloudflareで続行」からCloudflare OAuth同意画面へ遷移できる
- [ ] OAuth同意画面にAccount選択と要求scopeが表示される
- [ ] Authorization Code + PKCE（S256）でCallbackが完了する
- [ ] CloudflareのAccount選択画面で、利用者のAccountを選べる
- [ ] Worker名を確認・変更できる（既定値は`homegate`）
- [ ] 同名Workerがある場合に上書きせずエラーになる
- [ ] Worker bundleがScript Upload APIへアップロードされる
- [ ] Accountにworkers.devサブドメインがない場合、`homegate-`接頭辞のサブドメインが作成される
- [ ] workers.devが有効になり、完了画面にWorker URLが表示される
- [ ] 既存のWorker、DNS、ドメイン、D1、KVが変更されていない
- [ ] Worker作成が完了する

## Deploy Button（Advanced / Developer installation）

- [ ] OAuth Installerが利用できない場合だけ、`docs/deploy.html`のDeploy Buttonを開ける
- [ ] Deploy Buttonの公開リポジトリURLが正しい
- [ ] Deploy Buttonは一般利用者向けの標準導線に表示していない

## Bundle分離

- [ ] `npm run build`で`dist/installer.js`が生成される
- [ ] `npm run build`で`dist/homegate.js`が生成される
- [ ] `releases/0.1.0/homegate.js`が生成される
- [ ] `dist/homegate.js`にCloudflare OAuth URL、Token endpoint、Worker upload API、Installer Cookie、`/install`系ルートが含まれない
- [ ] `dist/installer.js`にOAuth開始、Callback、Account選択、Worker upload処理が含まれる

## Worker画面

`https://<Worker URL>/`を開き、次を確認します。

- [ ] `/`が表示される
- [ ] `/setup`が表示される
- [ ] `/setup/discord`が表示される
- [ ] 画面にSecret値そのものが表示されない
- [ ] `DISCORD_PUBLIC_KEY`、`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`の設定状態が表示される
- [ ] 未実施のEndpointやServer Installationが完了済みと表示されない
- [ ] Runtime Workerの`/install`、`/oauth/start`、`/oauth/callback`、`/install/account`が404になる

## Discord設定

- [ ] Discord Developer PortalでApplicationを作成する
- [ ] Application IDをCloudflare Secret `DISCORD_CLIENT_ID`へ保存する
- [ ] General InformationのPublic KeyをCloudflare Secret `DISCORD_PUBLIC_KEY`へ保存する
- [ ] OAuth2のClient SecretをCloudflare Secret `DISCORD_CLIENT_SECRET`へ保存する
- [ ] `/setup/discord`のコマンド登録ボタンを押す
- [ ] `/ping`、`/status`、`/lock`、`/unlock`の登録成功が表示される
- [ ] 失敗時にSecret、Token、Authorizationヘッダーが画面やログへ出ない

## Interactions Endpoint

- [ ] `/setup/discord`に表示された`https://<Worker>/discord/interactions`をコピーする
- [ ] Discord Developer PortalのInteractions Endpoint URLへ貼り付ける
- [ ] DiscordのPING検証が成功する
- [ ] Endpoint状態を、PING検証前に完了済みとして扱っていない

## Discord Server

- [ ] `/setup/discord`のAppインストールリンクを開く
- [ ] `applications.commands`だけが要求され、Bot GatewayやAdministrator権限を要求しない
- [ ] テスト用Discord ServerへAppを追加する
- [ ] Slash Command一覧に`/ping`が表示される

## Discordコマンド

- [ ] `/ping`が`HomeGate is running.`を返す
- [ ] `/status`が応答する
- [ ] `/lock`が応答する
- [ ] `/unlock`が応答する
- [ ] `/status`でMock状態の変化を確認する

## 実施記録

| 項目 | 記録 |
| --- | --- |
| 実施日 |  |
| 実施者 |  |
| Cloudflare Account |  |
| Worker URL |  |
| Discord Application ID |  |
| テストServer |  |
| 結果 |  |

Application ID、Worker URL、Server名は記録して構いません。Client Secret、Bot Token、Public Keyの値は記録・共有しないでください。

## ローカル自動検証

開発者が変更を公開する前に、次を実行します。これは実Cloudflareや実Discordへ接続するE2Eではありません。

```text
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Installerの実OAuth、実AccountへのWorker作成、bundle配布、workers.dev有効化は、資格情報を設定した担当者が実アカウントで実施します。未実施のままの場合は、公開報告で「未確認」と記載してください。
