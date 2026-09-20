# HomeGate 公開・実環境E2Eチェックリスト

このチェックリストは、CloudflareとDiscordの実アカウントを使って、初めてHomeGateを導入する人がブラウザだけで`/ping`まで到達できるか確認するためのものです。

このリポジトリでは外部アカウントへのログイン、公開操作、実Workerの作成を代行しません。資格情報を設定した担当者が、実施日とURLを記録してください。

## 事前条件

- [ ] `docs/deploy.html`のDeploy Button URLを、実際の公開GitHubまたはGitLabリポジトリへ置き換えた
- [ ] リポジトリに`.env`、`.dev.vars`、Bot Token、Client Secret、Cloudflare Account IDなどの実値がない
- [ ] GitHub/GitLabリポジトリがPublicになっている
- [ ] Cloudflare Accountへブラウザでログインできる
- [ ] Discord Developer Portalへブラウザでログインできる
- [ ] テスト用Discord ServerでAppを追加できる権限がある

## Deploy Button

- [ ] 配布ページを開ける
- [ ] Deploy to Cloudflareを押せる
- [ ] CloudflareのAccount選択画面で、利用者のAccountを選べる
- [ ] Worker名を確認・変更できる（既定値は`homegate`）
- [ ] `DISCORD_PUBLIC_KEY`をDeploy画面またはDashboardのSecretとして入力できる
- [ ] `DISCORD_CLIENT_ID`と`DISCORD_CLIENT_SECRET`を、コマンド登録用Secretとして入力できる
- [ ] 既存のWorker、DNS、ドメイン、D1、KVが変更されていない
- [ ] Worker作成が完了する

## Worker画面

`https://<Worker URL>/`を開き、次を確認します。

- [ ] `/`が表示される
- [ ] `/setup`が表示される
- [ ] `/setup/discord`が表示される
- [ ] 画面にSecret値そのものが表示されない
- [ ] `DISCORD_PUBLIC_KEY`、`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`の設定状態が表示される
- [ ] 未実施のEndpointやServer Installationが完了済みと表示されない

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

実アカウントを使った項目が未実施のままの場合は、公開報告で「未確認」と記載してください。
