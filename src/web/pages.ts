const securityHeaders = {
  "Content-Type": "text/html; charset=UTF-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src https://deploy.workers.cloudflare.com; connect-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function page(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | HomeGate</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 2rem 1rem 4rem; line-height: 1.65; }
    .card { border: 1px solid #8886; border-radius: .75rem; padding: 1.25rem; margin: 1rem 0; }
    .steps { counter-reset: step; list-style: none; padding: 0; }
    .steps li { counter-increment: step; margin: 1rem 0; }
    .steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 1.8rem; height: 1.8rem; margin-right: .5rem; border-radius: 50%; background: #f38020; color: #fff; font-weight: 700; }
    a { color: #f38020; }
    code { padding: .1rem .3rem; border-radius: .25rem; background: #8883; }
    .button { display: inline-block; padding: .65rem 1rem; border-radius: .5rem; background: #f38020; color: #fff; text-decoration: none; font-weight: 700; }
    button.button { border: 0; cursor: pointer; font: inherit; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #8886; padding: .5rem; text-align: left; }
    .notice { padding: .75rem; border-left: 4px solid #c33; background: #c331; }
    small { opacity: .8; }
  </style>
</head>
<body>${body}</body>
</html>`, { headers: securityHeaders });
}

export function homePage(): Response {
  return page("ブラウザ導入", `
    <h1>HomeGate</h1>
    <p>Discordからスマートロックを操作するCloudflare Workerです。現在は安全確認用のMock Lock Serviceを使用しています。</p>
    <div class="card">
      <h2>ブラウザだけでセットアップ</h2>
      <p>Node.js、npm、Wrangler、Git、ターミナルは、利用者のセットアップには必要ありません。</p>
      <p><a class="button" href="/setup">初期設定を始める</a></p>
    </div>
    <div class="card">
      <h2>動作確認</h2>
      <p>DiscordのInteractions Endpointは <code>/interactions</code> です。</p>
      <p>Discordから署名付きPINGを受け取ると、Workerは確認応答を返します。</p>
    </div>
    <p><small>PoC: 実機の鍵、権限管理、永続化はまだ接続されていません。</small></p>
  `);
}

export function setupScript(): Response {
  return new Response(`(() => {
  const button = document.querySelector('[data-copy-endpoint]');
  const input = document.querySelector('[data-endpoint-url]');
  if (!(button instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) return;
  button.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(input.value);
      copied = true;
    } catch {
      try {
        input.focus();
        input.select();
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
    }
    button.textContent = copied ? 'コピーしました' : '手動でコピーしてください';
  });
})();`, {
    headers: {
      "Content-Type": "application/javascript; charset=UTF-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function setupPage(): Response {
  return page("初期設定", `
    <h1>HomeGate 初期設定</h1>
    <p>Cloudflare公式の画面を使って、秘密情報をブラウザから設定します。HomeGateが秘密情報を受け取ったり保存したりするフォームはありません。</p>
    <ol class="steps">
      <li><strong>Discord Applicationを作成</strong><br><a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portalを開く</a> → General InformationからApplication Public Keyをコピーします。</li>
      <li><strong>Cloudflare Secretを設定</strong><br><a href="https://dash.cloudflare.com/" rel="noreferrer">Cloudflare Dashboardを開く</a> → Workers &amp; Pages → このWorker → Settings → Variables and Secrets → Add → Secretで、名前 <code>DISCORD_PUBLIC_KEY</code> を入力し、1のPublic Keyを保存します。</li>
      <li><strong>Interactions Endpoint URLを設定</strong><br>Discord Developer PortalのGeneral Informationへ戻り、<code>https://あなたのWorkerURL/discord/interactions</code> をInteractions Endpoint URLに保存します。</li>
      <li><strong>Slash Commandを登録</strong><br><a href="/setup/discord">Discord設定画面</a>から、Cloudflare SecretにClient ID／Client Secretを設定した後、Workerから公式APIへ登録できます。Bot TokenはWorkerへ入力しません。</li>
    </ol>
    <div class="card">
      <h2>設定後の確認</h2>
      <p>コマンド登録後、Discordで <code>/ping</code> を実行し、<code>HomeGate is running.</code> と表示されれば接続完了です。</p>
      <p><a href="/">HomeGateトップへ戻る</a></p>
    </div>
    <p><small>この画面は設定値をURL、HTML、JavaScript、ログへ書き込みません。既存のWorker、DNS、D1、KV、ドメインは変更しません。</small></p>
  `);
}

export interface DiscordSetupView {
  applicationConfigured: boolean;
  publicKeyConfigured: boolean;
  clientCredentialsConfigured: boolean;
  commandRegistered: boolean;
  endpointConfigured: boolean | null;
  serverInstallation: "manual" | "unknown";
  applicationId?: string;
  installUrl?: string;
  message?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function check(value: boolean | null): string {
  if (value === true) return "✓";
  if (value === false) return "✗";
  return "—";
}

export function discordSetupPage(endpointUrl: string, view: DiscordSetupView): Response {
  const safeEndpoint = escapeHtml(endpointUrl);
  const message = view.message ? `<p class="notice">${escapeHtml(view.message)}</p>` : "";
  const install = view.installUrl
    ? `<p><a class="button" href="${escapeHtml(view.installUrl)}" rel="noreferrer">DiscordサーバーへAppを追加</a></p>`
    : "";
  return page("Discord設定", `
    <h1>HomeGate Discord設定</h1>
    <p>秘密情報はこの画面に入力しません。Cloudflare DashboardでSecretとして保存した値をWorkerがDiscord公式APIへ一時的に使い、応答後に破棄します。</p>
    ${message}
    <div class="card">
      <h2>設定状態</h2>
      <table>
        <tr><th>Application ID</th><td>${check(view.applicationConfigured)}</td></tr>
        <tr><th>Public Key</th><td>${check(view.publicKeyConfigured)}</td></tr>
        <tr><th>Client Credentials</th><td>${check(view.clientCredentialsConfigured)}</td></tr>
        <tr><th>Command Registration</th><td>${check(view.commandRegistered)}</td></tr>
        <tr><th>Interactions Endpoint</th><td>${check(view.endpointConfigured)}</td></tr>
        <tr><th>Server Installation</th><td>${view.serverInstallation === "manual" ? "手動確認" : "未確認"}</td></tr>
      </table>
    </div>
    <h2>1. Discord Applicationを作成</h2>
    <p><a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portalを開く</a>からNew Applicationを作成し、General InformationのApplication IDとPublic Key、OAuth2のClient Secretを確認してください。</p>
    <h2>2. Cloudflare Secret</h2>
    <p>Cloudflare Dashboard → このWorker → Settings → Variables and Secrets → Add → Secretで、次の値を保存します。既存のBot Tokenは使いません。</p>
    <ul><li><code>DISCORD_PUBLIC_KEY</code>：General InformationのPublic Key</li><li><code>DISCORD_CLIENT_ID</code>：Application ID</li><li><code>DISCORD_CLIENT_SECRET</code>：OAuth2のClient Secret</li></ul>
    <p><a href="https://dash.cloudflare.com/" rel="noreferrer">Cloudflare Dashboardを開く</a>　<a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portalを開く</a></p>
    <h2>3. コマンド登録</h2>
    <p><code>applications.commands.update</code>のClient Credentials Grantで、HomeGateの4コマンドをグローバル登録します。登録APIへ渡すのはWorker内のSecretだけです。</p>
    <form method="post" action="/setup/discord/register">
      <button class="button" type="submit">4コマンドを登録・確認</button>
    </form>
    <h2>4. Interactions Endpoint</h2>
    <p>Discord Developer Portal → General Information → Interactions Endpoint URLに、次のURLを貼り付けて保存してください。DiscordのPING検証が成功するまでEndpoint状態は完了になりません。</p>
    <div style="display:flex;gap:.5rem;align-items:center"><input data-endpoint-url aria-label="Interactions Endpoint URL" readonly value="${safeEndpoint}" style="flex:1;min-width:0;box-sizing:border-box;padding:.6rem"><button class="button" type="button" data-copy-endpoint>コピー</button></div>
    <h2>5. Appのインストール</h2>
    <p><code>applications.commands</code>だけ、権限0で要求します。Gateway接続やAdministrator権限は要求しません。</p>
    ${install}
    <h2>6. 動作確認</h2>
    <p>Discordのテストサーバーで<code>/ping</code>を実行し、<code>HomeGate is running.</code>が返れば完了です。続けて<code>/status</code>、<code>/lock</code>、<code>/unlock</code>も確認できます。</p>
    <p><a href="/setup">初期設定へ戻る</a>　<a href="/">HomeGateトップへ戻る</a></p>
    <p><small>Client Secret、Public Key、アクセストークンはHTML、URL、ログへ出しません。Server Installationの検証はDiscordの対象サーバー情報を取得しないため、画面上で手動確認します。</small></p>
    <script src="/setup.js" defer></script>
  `);
}
