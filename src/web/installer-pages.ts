import type { CloudflareAccount } from "../installer/oauth";

const headers = {
  "Content-Type": "text/html; charset=UTF-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | HomeGate</title>
<style>:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{max-width:760px;margin:0 auto;padding:2rem 1rem 4rem;line-height:1.65}.card{border:1px solid #8886;border-radius:.75rem;padding:1.25rem;margin:1rem 0}a{color:#f38020}.button{display:inline-block;padding:.7rem 1.1rem;border:0;border-radius:.5rem;background:#f38020;color:#fff;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}label{display:block;padding:.7rem;border:1px solid #8886;border-radius:.5rem;margin:.5rem 0}input[type=text]{box-sizing:border-box;width:100%;padding:.65rem;margin:.3rem 0 .8rem;font:inherit}input[type=radio]{margin-right:.5rem}.notice{padding:.75rem;border-left:4px solid #c33;background:#c331}small{opacity:.8}</style></head>
<body>${body}</body></html>`, { status, headers });
}

export function installerPage(configured: boolean, message?: string): Response {
  const notice = message ? `<p class="notice">${escapeHtml(message)}</p>` : "";
  const action = configured
    ? `<p><a class="button" href="/oauth/start">Cloudflareで続行</a></p>`
    : `<p class="notice">このInstallerはまだCloudflare OAuth Clientに接続されていません。</p>`;
  return page("HomeGate Installer", `${notice}
    <h1>HomeGate Installer</h1>
    <p>HomeGateをあなたのCloudflare環境にインストールします。</p>
    <div class="card"><p>GitHub、GitLab、Node.js、npm、Wrangler、Docker、ターミナルは必要ありません。</p><p>Cloudflare OAuthの認可後、選択したAccountにHomeGate Workerだけを作成します。既存のWorker、DNS、ドメイン、D1、KVは変更しません。</p>${action}</div>
    <p><small>OAuth Access Tokenはインストール処理中だけ暗号化された短期セッションに保持し、運営側のDBやログには保存しません。通常利用は作成されたWorkerだけで完結します。</small></p>`);
}

export function accountSelectionPage(accounts: readonly CloudflareAccount[], nonce: string, message?: string): Response {
  const notice = message ? `<p class="notice">${escapeHtml(message)}</p>` : "";
  const choices = accounts.map((account, index) => `<label><input type="radio" name="account_id" value="${escapeHtml(account.id)}"${index === 0 ? " checked" : ""}>${escapeHtml(account.name)} <small>(${escapeHtml(account.id)})</small></label>`).join("");
  return page("Install HomeGate", `${notice}
    <h1>Install HomeGate</h1>
    <p>Workerを作成するCloudflare Accountを選択してください。</p>
    <form method="post" action="/install/account">
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      <div class="card"><h2>Cloudflare Account</h2>${choices}</div>
      <label for="worker_name">Worker名</label>
      <input id="worker_name" name="worker_name" type="text" value="homegate" pattern="[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?" maxlength="63" required>
      <button class="button" type="submit">このAccountにインストール</button>
    </form>
    <p><small>同名のWorkerがある場合は上書きせず、エラーを表示します。</small></p>`);
}

export function installCompletePage(workerName: string, url: string): Response {
  const safeUrl = escapeHtml(url);
  return page("HomeGate is ready", `<h1>HomeGate is ready.</h1>
    <div class="card"><p>✓ Cloudflare Account</p><p>✓ Worker created: <code>${escapeHtml(workerName)}</code></p><p>✓ HomeGate uploaded</p><p>✓ workers.dev deployment complete</p></div>
    <p><a class="button" href="${safeUrl}/setup">セットアップを続ける</a></p>
    <p>Worker URL: <a href="${safeUrl}">${safeUrl}</a></p>
    <p><small>以後のDiscord、SESAME、Permission、Audit設定はあなたのHomeGate Workerで行います。</small></p>`);
}

export function installerErrorPage(message: string, status = 400): Response {
  return page("HomeGate Installer", `<h1>HomeGateを作成できませんでした。</h1><p class="notice">${escapeHtml(message)}</p><p><a href="/install">最初からやり直す</a></p>`, status);
}
