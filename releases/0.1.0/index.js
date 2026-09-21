var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/discord/commands.ts
var commands = [
  { name: "ping", description: "Check whether HomeGate is running.", type: 1 },
  { name: "status", description: "Show the mock Studio Door status.", type: 1 },
  { name: "lock", description: "Lock the mock Studio Door.", type: 1 },
  { name: "unlock", description: "Unlock the mock Studio Door.", type: 1 }
];
function isCommandName(name) {
  return commands.some((command) => command.name === name);
}
__name(isCommandName, "isCommandName");

// src/discord/interaction.ts
function message(content) {
  return { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } };
}
__name(message, "message");
async function handleInteraction(interaction, locks) {
  if (interaction.type === 1) return { type: 1 };
  const name = interaction.data.name;
  if (!isCommandName(name)) return message("Unknown command.");
  switch (name) {
    case "ping":
      return message("HomeGate is running.");
    case "status": {
      const status = await locks.getStatus();
      return message(`${status.deviceName}
Status: ${status.state === "locked" ? "Locked" : "Unlocked"}`);
    }
    case "lock": {
      const { deviceName } = await locks.getStatus();
      await locks.lock();
      return message(`${deviceName} has been locked.`);
    }
    case "unlock": {
      const { deviceName } = await locks.getStatus();
      await locks.unlock();
      return message(`${deviceName} has been unlocked.`);
    }
  }
}
__name(handleInteraction, "handleInteraction");

// src/discord/verify.ts
var MAX_TIMESTAMP_AGE_SECONDS = 300;
function isPublicKey(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}
__name(isPublicKey, "isPublicKey");
function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}
__name(fromHex, "fromHex");
async function verifyDiscordRequest(rawBody, headers2, publicKey, now = Date.now()) {
  const signature = headers2.get("X-Signature-Ed25519");
  const timestamp = headers2.get("X-Signature-Timestamp");
  if (!isPublicKey(publicKey) || !signature || !/^[0-9a-f]{128}$/i.test(signature) || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1e3 - Number(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS) return false;
  const timestampBytes = new TextEncoder().encode(timestamp);
  const message2 = new Uint8Array(timestampBytes.length + rawBody.byteLength);
  message2.set(timestampBytes);
  message2.set(new Uint8Array(rawBody), timestampBytes.length);
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKey), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromHex(signature), message2);
  } catch {
    return false;
  }
}
__name(verifyDiscordRequest, "verifyDiscordRequest");

// src/services/lock-service.ts
var MockLockService = class {
  static {
    __name(this, "MockLockService");
  }
  state = "locked";
  async getStatus() {
    return { deviceName: "Studio Door", state: this.state };
  }
  async lock() {
    this.state = "locked";
  }
  async unlock() {
    this.state = "unlocked";
  }
};

// src/types/discord.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord, "isRecord");
function isInteraction(value) {
  if (!isRecord(value)) return false;
  if (value.type === 1) return true;
  return value.type === 2 && isRecord(value.data) && value.data.type === 1 && typeof value.data.name === "string" && value.data.name.length > 0 && value.data.name.length <= 32;
}
__name(isInteraction, "isInteraction");

// src/discord/command-registration.ts
var DISCORD_API = "https://discord.com/api/v10";
var CLIENT_CREDENTIALS_SCOPE = "applications.commands.update";
var DiscordRegistrationError = class extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "DiscordRegistrationError";
  }
  code;
  status;
  static {
    __name(this, "DiscordRegistrationError");
  }
};
function validSnowflake(value) {
  return /^\d{17,20}$/.test(value);
}
__name(validSnowflake, "validSnowflake");
function authHeader(scheme, token) {
  return `${scheme} ${token}`;
}
__name(authHeader, "authHeader");
function classifyStatus(status, authentication = false) {
  if (authentication || status === 401 || status === 403) {
    return new DiscordRegistrationError("authentication_failed", status);
  }
  if (status === 429) return new DiscordRegistrationError("rate_limited", status);
  return new DiscordRegistrationError("discord_api_failed", status);
}
__name(classifyStatus, "classifyStatus");
async function request(fetcher, input, init) {
  try {
    return await fetcher(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15e3) });
  } catch {
    throw new DiscordRegistrationError("network_error");
  }
}
__name(request, "request");
async function json(response) {
  try {
    return await response.json();
  } catch {
    throw new DiscordRegistrationError("invalid_response", response.status);
  }
}
__name(json, "json");
async function getClientCredentialsToken(clientId, clientSecret, fetcher = fetch) {
  if (!validSnowflake(clientId) || clientSecret.length === 0 || clientSecret.length > 256) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const encoded = btoa(`${clientId}:${clientSecret}`);
  const response = await request(fetcher, `${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: CLIENT_CREDENTIALS_SCOPE
    })
  });
  if (!response.ok) throw classifyStatus(response.status, response.status === 400);
  const payload = await json(response);
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0 || payload.token_type !== "Bearer") {
    throw new DiscordRegistrationError("invalid_response", response.status);
  }
  return payload.access_token;
}
__name(getClientCredentialsToken, "getClientCredentialsToken");
async function registerCommandsWithToken(options) {
  const { applicationId, accessToken, authScheme, guildId, definitions = commands } = options;
  if (!validSnowflake(applicationId) || !accessToken || guildId !== void 0 && !validSnowflake(guildId)) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const scope = guildId ? `/guilds/${guildId}` : "";
  const fetcher = options.fetcher ?? fetch;
  for (const definition of definitions) {
    const response = await request(
      fetcher,
      `${DISCORD_API}/applications/${applicationId}${scope}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(authScheme, accessToken),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(definition)
      }
    );
    if (!response.ok) throw classifyStatus(response.status);
    const payload = await json(response);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DiscordRegistrationError("invalid_response", response.status);
    }
  }
  return { commandNames: definitions.map((command) => command.name) };
}
__name(registerCommandsWithToken, "registerCommandsWithToken");
async function registerCommandsWithClientCredentials(options) {
  const fetcher = options.fetcher ?? fetch;
  const token = await getClientCredentialsToken(options.applicationId, options.clientSecret, fetcher);
  return registerCommandsWithToken({
    applicationId: options.applicationId,
    accessToken: token,
    authScheme: "Bearer",
    fetcher
  });
}
__name(registerCommandsWithClientCredentials, "registerCommandsWithClientCredentials");
async function inspectDiscordSetup(options) {
  if (!validSnowflake(options.applicationId) || !options.accessToken) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const fetcher = options.fetcher ?? fetch;
  const commandResponse = await request(
    fetcher,
    `${DISCORD_API}/applications/${options.applicationId}/commands`,
    {
      headers: { Authorization: authHeader("Bearer", options.accessToken) }
    }
  );
  if (!commandResponse.ok) throw classifyStatus(commandResponse.status);
  const payload = await json(commandResponse);
  if (!Array.isArray(payload) || payload.some((item) => typeof item !== "object" || item === null)) {
    throw new DiscordRegistrationError("invalid_response", commandResponse.status);
  }
  const commandNames = payload.flatMap((item) => {
    const name = item.name;
    return typeof name === "string" ? [name] : [];
  });
  return { commandNames };
}
__name(inspectDiscordSetup, "inspectDiscordSetup");

// src/web/pages.ts
var securityHeaders = {
  "Content-Type": "text/html; charset=UTF-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src https://deploy.workers.cloudflare.com; connect-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};
function page(title, body) {
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
__name(page, "page");
function homePage() {
  return page("\u30D6\u30E9\u30A6\u30B6\u5C0E\u5165", `
    <h1>HomeGate</h1>
    <p>Discord\u304B\u3089\u30B9\u30DE\u30FC\u30C8\u30ED\u30C3\u30AF\u3092\u64CD\u4F5C\u3059\u308BCloudflare Worker\u3067\u3059\u3002\u73FE\u5728\u306F\u5B89\u5168\u78BA\u8A8D\u7528\u306EMock Lock Service\u3092\u4F7F\u7528\u3057\u3066\u3044\u307E\u3059\u3002</p>
    <div class="card">
      <h2>Cloudflare\u304B\u3089\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB</h2>
      <p>\u516C\u958BInstaller\u3092\u5229\u7528\u3059\u308B\u5834\u5408\u306F\u3001Cloudflare OAuth\u3067Account\u3092\u9078\u629E\u3057\u3066Worker\u3092\u4F5C\u6210\u3067\u304D\u307E\u3059\u3002</p>
      <p><a class="button" href="/install">Cloudflare\u3067\u7D9A\u884C</a></p>
    </div>
    <div class="card">
      <h2>\u30D6\u30E9\u30A6\u30B6\u3060\u3051\u3067\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7</h2>
      <p>Node.js\u3001npm\u3001Wrangler\u3001Git\u3001\u30BF\u30FC\u30DF\u30CA\u30EB\u306F\u3001\u5229\u7528\u8005\u306E\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7\u306B\u306F\u5FC5\u8981\u3042\u308A\u307E\u305B\u3093\u3002</p>
      <p><a class="button" href="/setup">\u521D\u671F\u8A2D\u5B9A\u3092\u59CB\u3081\u308B</a></p>
    </div>
    <div class="card">
      <h2>\u52D5\u4F5C\u78BA\u8A8D</h2>
      <p>Discord\u306EInteractions Endpoint\u306F <code>/interactions</code> \u3067\u3059\u3002</p>
      <p>Discord\u304B\u3089\u7F72\u540D\u4ED8\u304DPING\u3092\u53D7\u3051\u53D6\u308B\u3068\u3001Worker\u306F\u78BA\u8A8D\u5FDC\u7B54\u3092\u8FD4\u3057\u307E\u3059\u3002</p>
    </div>
    <p><small>PoC: \u5B9F\u6A5F\u306E\u9375\u3001\u6A29\u9650\u7BA1\u7406\u3001\u6C38\u7D9A\u5316\u306F\u307E\u3060\u63A5\u7D9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002</small></p>
  `);
}
__name(homePage, "homePage");
function setupScript() {
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
    button.textContent = copied ? '\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F' : '\u624B\u52D5\u3067\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044';
  });
})();`, {
    headers: {
      "Content-Type": "application/javascript; charset=UTF-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(setupScript, "setupScript");
function setupPage() {
  return page("\u521D\u671F\u8A2D\u5B9A", `
    <h1>HomeGate \u521D\u671F\u8A2D\u5B9A</h1>
    <p>Cloudflare\u516C\u5F0F\u306E\u753B\u9762\u3092\u4F7F\u3063\u3066\u3001\u79D8\u5BC6\u60C5\u5831\u3092\u30D6\u30E9\u30A6\u30B6\u304B\u3089\u8A2D\u5B9A\u3057\u307E\u3059\u3002HomeGate\u304C\u79D8\u5BC6\u60C5\u5831\u3092\u53D7\u3051\u53D6\u3063\u305F\u308A\u4FDD\u5B58\u3057\u305F\u308A\u3059\u308B\u30D5\u30A9\u30FC\u30E0\u306F\u3042\u308A\u307E\u305B\u3093\u3002</p>
    <ol class="steps">
      <li><strong>Discord Application\u3092\u4F5C\u6210</strong><br><a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portal\u3092\u958B\u304F</a> \u2192 General Information\u304B\u3089Application Public Key\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3059\u3002</li>
      <li><strong>Cloudflare Secret\u3092\u8A2D\u5B9A</strong><br><a href="https://dash.cloudflare.com/" rel="noreferrer">Cloudflare Dashboard\u3092\u958B\u304F</a> \u2192 Workers &amp; Pages \u2192 \u3053\u306EWorker \u2192 Settings \u2192 Variables and Secrets \u2192 Add \u2192 Secret\u3067\u3001\u540D\u524D <code>DISCORD_PUBLIC_KEY</code> \u3092\u5165\u529B\u3057\u30011\u306EPublic Key\u3092\u4FDD\u5B58\u3057\u307E\u3059\u3002</li>
      <li><strong>Interactions Endpoint URL\u3092\u8A2D\u5B9A</strong><br>Discord Developer Portal\u306EGeneral Information\u3078\u623B\u308A\u3001<code>https://\u3042\u306A\u305F\u306EWorkerURL/discord/interactions</code> \u3092Interactions Endpoint URL\u306B\u4FDD\u5B58\u3057\u307E\u3059\u3002</li>
      <li><strong>Slash Command\u3092\u767B\u9332</strong><br><a href="/setup/discord">Discord\u8A2D\u5B9A\u753B\u9762</a>\u304B\u3089\u3001Cloudflare Secret\u306BClient ID\uFF0FClient Secret\u3092\u8A2D\u5B9A\u3057\u305F\u5F8C\u3001Worker\u304B\u3089\u516C\u5F0FAPI\u3078\u767B\u9332\u3067\u304D\u307E\u3059\u3002Bot Token\u306FWorker\u3078\u5165\u529B\u3057\u307E\u305B\u3093\u3002</li>
    </ol>
    <div class="card">
      <h2>\u8A2D\u5B9A\u5F8C\u306E\u78BA\u8A8D</h2>
      <p>\u30B3\u30DE\u30F3\u30C9\u767B\u9332\u5F8C\u3001Discord\u3067 <code>/ping</code> \u3092\u5B9F\u884C\u3057\u3001<code>HomeGate is running.</code> \u3068\u8868\u793A\u3055\u308C\u308C\u3070\u63A5\u7D9A\u5B8C\u4E86\u3067\u3059\u3002</p>
      <p><a href="/">HomeGate\u30C8\u30C3\u30D7\u3078\u623B\u308B</a></p>
    </div>
    <p><small>\u3053\u306E\u753B\u9762\u306F\u8A2D\u5B9A\u5024\u3092URL\u3001HTML\u3001JavaScript\u3001\u30ED\u30B0\u3078\u66F8\u304D\u8FBC\u307F\u307E\u305B\u3093\u3002\u65E2\u5B58\u306EWorker\u3001DNS\u3001D1\u3001KV\u3001\u30C9\u30E1\u30A4\u30F3\u306F\u5909\u66F4\u3057\u307E\u305B\u3093\u3002</small></p>
  `);
}
__name(setupPage, "setupPage");
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
__name(escapeHtml, "escapeHtml");
function check(value) {
  if (value === true) return "\u2713";
  if (value === false) return "\u2717";
  return "\u2014";
}
__name(check, "check");
function discordSetupPage(endpointUrl, view) {
  const safeEndpoint = escapeHtml(endpointUrl);
  const message2 = view.message ? `<p class="notice">${escapeHtml(view.message)}</p>` : "";
  const install = view.installUrl ? `<p><a class="button" href="${escapeHtml(view.installUrl)}" rel="noreferrer">Discord\u30B5\u30FC\u30D0\u30FC\u3078App\u3092\u8FFD\u52A0</a></p>` : "";
  return page("Discord\u8A2D\u5B9A", `
    <h1>HomeGate Discord\u8A2D\u5B9A</h1>
    <p>\u79D8\u5BC6\u60C5\u5831\u306F\u3053\u306E\u753B\u9762\u306B\u5165\u529B\u3057\u307E\u305B\u3093\u3002Cloudflare Dashboard\u3067Secret\u3068\u3057\u3066\u4FDD\u5B58\u3057\u305F\u5024\u3092Worker\u304CDiscord\u516C\u5F0FAPI\u3078\u4E00\u6642\u7684\u306B\u4F7F\u3044\u3001\u5FDC\u7B54\u5F8C\u306B\u7834\u68C4\u3057\u307E\u3059\u3002</p>
    ${message2}
    <div class="card">
      <h2>\u8A2D\u5B9A\u72B6\u614B</h2>
      <table>
        <tr><th>Application ID</th><td>${check(view.applicationConfigured)}</td></tr>
        <tr><th>Public Key</th><td>${check(view.publicKeyConfigured)}</td></tr>
        <tr><th>Client Credentials</th><td>${check(view.clientCredentialsConfigured)}</td></tr>
        <tr><th>Command Registration</th><td>${check(view.commandRegistered)}</td></tr>
        <tr><th>Interactions Endpoint</th><td>${check(view.endpointConfigured)}</td></tr>
        <tr><th>Server Installation</th><td>${view.serverInstallation === "manual" ? "\u624B\u52D5\u78BA\u8A8D" : "\u672A\u78BA\u8A8D"}</td></tr>
      </table>
    </div>
    <h2>1. Discord Application\u3092\u4F5C\u6210</h2>
    <p><a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portal\u3092\u958B\u304F</a>\u304B\u3089New Application\u3092\u4F5C\u6210\u3057\u3001General Information\u306EApplication ID\u3068Public Key\u3001OAuth2\u306EClient Secret\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>
    <h2>2. Cloudflare Secret</h2>
    <p>Cloudflare Dashboard \u2192 \u3053\u306EWorker \u2192 Settings \u2192 Variables and Secrets \u2192 Add \u2192 Secret\u3067\u3001\u6B21\u306E\u5024\u3092\u4FDD\u5B58\u3057\u307E\u3059\u3002\u65E2\u5B58\u306EBot Token\u306F\u4F7F\u3044\u307E\u305B\u3093\u3002</p>
    <ul><li><code>DISCORD_PUBLIC_KEY</code>\uFF1AGeneral Information\u306EPublic Key</li><li><code>DISCORD_CLIENT_ID</code>\uFF1AApplication ID</li><li><code>DISCORD_CLIENT_SECRET</code>\uFF1AOAuth2\u306EClient Secret</li></ul>
    <p><a href="https://dash.cloudflare.com/" rel="noreferrer">Cloudflare Dashboard\u3092\u958B\u304F</a>\u3000<a href="https://discord.com/developers/applications" rel="noreferrer">Discord Developer Portal\u3092\u958B\u304F</a></p>
    <h2>3. \u30B3\u30DE\u30F3\u30C9\u767B\u9332</h2>
    <p><code>applications.commands.update</code>\u306EClient Credentials Grant\u3067\u3001HomeGate\u306E4\u30B3\u30DE\u30F3\u30C9\u3092\u30B0\u30ED\u30FC\u30D0\u30EB\u767B\u9332\u3057\u307E\u3059\u3002\u767B\u9332API\u3078\u6E21\u3059\u306E\u306FWorker\u5185\u306ESecret\u3060\u3051\u3067\u3059\u3002</p>
    <form method="post" action="/setup/discord/register">
      <button class="button" type="submit">4\u30B3\u30DE\u30F3\u30C9\u3092\u767B\u9332\u30FB\u78BA\u8A8D</button>
    </form>
    <h2>4. Interactions Endpoint</h2>
    <p>Discord Developer Portal \u2192 General Information \u2192 Interactions Endpoint URL\u306B\u3001\u6B21\u306EURL\u3092\u8CBC\u308A\u4ED8\u3051\u3066\u4FDD\u5B58\u3057\u3066\u304F\u3060\u3055\u3044\u3002Discord\u306EPING\u691C\u8A3C\u304C\u6210\u529F\u3059\u308B\u307E\u3067Endpoint\u72B6\u614B\u306F\u5B8C\u4E86\u306B\u306A\u308A\u307E\u305B\u3093\u3002</p>
    <div style="display:flex;gap:.5rem;align-items:center"><input data-endpoint-url aria-label="Interactions Endpoint URL" readonly value="${safeEndpoint}" style="flex:1;min-width:0;box-sizing:border-box;padding:.6rem"><button class="button" type="button" data-copy-endpoint>\u30B3\u30D4\u30FC</button></div>
    <h2>5. App\u306E\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB</h2>
    <p><code>applications.commands</code>\u3060\u3051\u3001\u6A29\u96500\u3067\u8981\u6C42\u3057\u307E\u3059\u3002Gateway\u63A5\u7D9A\u3084Administrator\u6A29\u9650\u306F\u8981\u6C42\u3057\u307E\u305B\u3093\u3002</p>
    ${install}
    <h2>6. \u52D5\u4F5C\u78BA\u8A8D</h2>
    <p>Discord\u306E\u30C6\u30B9\u30C8\u30B5\u30FC\u30D0\u30FC\u3067<code>/ping</code>\u3092\u5B9F\u884C\u3057\u3001<code>HomeGate is running.</code>\u304C\u8FD4\u308C\u3070\u5B8C\u4E86\u3067\u3059\u3002\u7D9A\u3051\u3066<code>/status</code>\u3001<code>/lock</code>\u3001<code>/unlock</code>\u3082\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002</p>
    <p><a href="/setup">\u521D\u671F\u8A2D\u5B9A\u3078\u623B\u308B</a>\u3000<a href="/">HomeGate\u30C8\u30C3\u30D7\u3078\u623B\u308B</a></p>
    <p><small>Client Secret\u3001Public Key\u3001\u30A2\u30AF\u30BB\u30B9\u30C8\u30FC\u30AF\u30F3\u306FHTML\u3001URL\u3001\u30ED\u30B0\u3078\u51FA\u3057\u307E\u305B\u3093\u3002Server Installation\u306E\u691C\u8A3C\u306FDiscord\u306E\u5BFE\u8C61\u30B5\u30FC\u30D0\u30FC\u60C5\u5831\u3092\u53D6\u5F97\u3057\u306A\u3044\u305F\u3081\u3001\u753B\u9762\u4E0A\u3067\u624B\u52D5\u78BA\u8A8D\u3057\u307E\u3059\u3002</small></p>
    <script src="/setup.js" defer><\/script>
  `);
}
__name(discordSetupPage, "discordSetupPage");

// src/installer/oauth.ts
var CLOUDFLARE_AUTH_ENDPOINT = "https://dash.cloudflare.com/oauth2/auth";
var CLOUDFLARE_TOKEN_ENDPOINT = "https://dash.cloudflare.com/oauth2/token";
var CLOUDFLARE_API_ENDPOINT = "https://api.cloudflare.com/client/v4";
var INSTALLER_SCOPES = ["account.read", "workers-platform.read", "workers-platform.write"];
var OAUTH_STATE_COOKIE = "__Host-homegate_oauth";
var INSTALL_SESSION_COOKIE = "__Host-homegate_install";
var SESSION_TTL_SECONDS = 600;
var MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
var InstallerError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "InstallerError";
  }
  code;
  status;
  static {
    __name(this, "InstallerError");
  }
};
function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(encodeBase64Url, "encodeBase64Url");
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(decodeBase64Url, "decodeBase64Url");
function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}
__name(randomToken, "randomToken");
function randomHex(byteLength = 6) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
__name(sha256, "sha256");
async function createPkcePair() {
  const verifier = randomToken(48);
  return { verifier, challenge: encodeBase64Url(await sha256(verifier)) };
}
__name(createPkcePair, "createPkcePair");
async function encryptionKey(secret) {
  if (secret.length < 32) throw new InstallerError("installer_not_configured", 503);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(encryptionKey, "encryptionKey");
async function seal(value, secret) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), plaintext));
  const joined = new Uint8Array(iv.length + ciphertext.length);
  joined.set(iv);
  joined.set(ciphertext, iv.length);
  return encodeBase64Url(joined);
}
__name(seal, "seal");
async function open(value, secret) {
  try {
    const joined = decodeBase64Url(value);
    if (joined.length <= 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: joined.slice(0, 12) },
      await encryptionKey(secret),
      joined.slice(12)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}
__name(open, "open");
function cookieValue(request3, name) {
  const header = request3.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return void 0;
}
__name(cookieValue, "cookieValue");
function cookie(name, value, maxAge) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
__name(cookie, "cookie");
function clearInstallerCookies() {
  return [cookie(OAUTH_STATE_COOKIE, "", 0), cookie(INSTALL_SESSION_COOKIE, "", 0)];
}
__name(clearInstallerCookies, "clearInstallerCookies");
function validateClientId(clientId) {
  if (!clientId || clientId.length > 256) throw new InstallerError("installer_not_configured", 503);
  return clientId;
}
__name(validateClientId, "validateClientId");
function validateStateSecret(secret) {
  if (!secret || secret.length < 32) throw new InstallerError("installer_not_configured", 503);
  return secret;
}
__name(validateStateSecret, "validateStateSecret");
async function beginOAuth(request3, env) {
  const clientId = validateClientId(env.CLOUDFLARE_OAUTH_CLIENT_ID);
  const secret = validateStateSecret(env.HOMEGATE_OAUTH_STATE_SECRET);
  const { verifier, challenge } = await createPkcePair();
  const state = randomToken(32);
  const redirectUri = `${new URL(request3.url).origin}/oauth/callback`;
  const payload = { state, verifier, redirectUri, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1e3 };
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: INSTALLER_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${CLOUDFLARE_AUTH_ENDPOINT}?${params.toString()}`,
      "Set-Cookie": cookie(OAUTH_STATE_COOKIE, await seal(payload, secret), SESSION_TTL_SECONDS),
      "Cache-Control": "no-store"
    }
  });
}
__name(beginOAuth, "beginOAuth");
async function request2(fetcher, input, init) {
  try {
    return await fetcher(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15e3) });
  } catch {
    throw new InstallerError("cloudflare_network_error", 502);
  }
}
__name(request2, "request");
async function exchangeCode(code, clientId, redirectUri, verifier, fetcher) {
  const response = await request2(fetcher, CLOUDFLARE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier })
  });
  if (!response.ok) throw new InstallerError("oauth_exchange_failed", 502);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new InstallerError("oauth_exchange_failed", 502);
  }
  const token = body && typeof body === "object" && typeof body.access_token === "string" ? body.access_token : void 0;
  if (!token || token.length < 10) throw new InstallerError("oauth_exchange_failed", 502);
  return token;
}
__name(exchangeCode, "exchangeCode");
async function cloudflareJson(token, path, init, fetcher) {
  const headers2 = new Headers(init.headers);
  headers2.set("Accept", "application/json");
  headers2.set("Authorization", `Bearer ${token}`);
  const response = await request2(fetcher, `${CLOUDFLARE_API_ENDPOINT}${path}`, {
    ...init,
    headers: headers2
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = void 0;
  }
  if (!response.ok) throw new InstallerError(response.status === 403 ? "cloudflare_permission_denied" : "cloudflare_api_error", response.status >= 400 ? response.status : 502);
  if (!body || typeof body !== "object" || body.success === false) throw new InstallerError("cloudflare_api_error", 502);
  return body;
}
__name(cloudflareJson, "cloudflareJson");
async function listAccounts(token, fetcher = fetch) {
  const body = await cloudflareJson(token, "/accounts?per_page=50", {}, fetcher);
  if (!Array.isArray(body.result)) throw new InstallerError("cloudflare_api_error", 502);
  const accounts = [];
  for (const item of body.result) {
    if (!item || typeof item !== "object") continue;
    const id = item.id;
    const name = item.name;
    if (typeof id === "string" && /^[a-f0-9]{32}$/i.test(id) && typeof name === "string" && name.length <= 100) accounts.push({ id, name });
  }
  if (accounts.length === 0) throw new InstallerError("no_cloudflare_accounts", 403);
  return accounts;
}
__name(listAccounts, "listAccounts");
async function completeOAuth(request3, env, fetcher = fetch) {
  try {
    const secret = validateStateSecret(env.HOMEGATE_OAUTH_STATE_SECRET);
    const clientId = validateClientId(env.CLOUDFLARE_OAUTH_CLIENT_ID);
    const url = new URL(request3.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) return { error: new InstallerError("oauth_cancelled", 400) };
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const sealedState = cookieValue(request3, OAUTH_STATE_COOKIE);
    if (!code || !state || !sealedState) return { error: new InstallerError("oauth_state_invalid", 400) };
    const statePayload = await open(sealedState, secret);
    const expectedRedirectUri = `${url.origin}/oauth/callback`;
    if (!statePayload || statePayload.state !== state || statePayload.redirectUri !== expectedRedirectUri || typeof statePayload.verifier !== "string" || typeof statePayload.redirectUri !== "string" || typeof statePayload.expiresAt !== "number" || statePayload.expiresAt < Date.now()) return { error: new InstallerError("oauth_state_invalid", 400) };
    const accessToken = await exchangeCode(code, clientId, statePayload.redirectUri, statePayload.verifier, fetcher);
    const accounts = await listAccounts(accessToken, fetcher);
    const session = { accessToken, accounts, nonce: randomToken(24), expiresAt: Date.now() + SESSION_TTL_SECONDS * 1e3 };
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: `${new URL(request3.url).origin}/install/account`,
        "Set-Cookie": cookie(INSTALL_SESSION_COOKIE, await seal(session, secret), SESSION_TTL_SECONDS),
        "Cache-Control": "no-store"
      }
    });
    response.headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
    return { redirect: response };
  } catch (error) {
    return { error: error instanceof InstallerError ? error : new InstallerError("oauth_failed", 502) };
  }
}
__name(completeOAuth, "completeOAuth");
async function readInstallSession(request3, env) {
  if (!env.HOMEGATE_OAUTH_STATE_SECRET) return null;
  const value = cookieValue(request3, INSTALL_SESSION_COOKIE);
  if (!value) return null;
  const session = await open(value, env.HOMEGATE_OAUTH_STATE_SECRET);
  if (!session || typeof session.accessToken !== "string" || !Array.isArray(session.accounts) || typeof session.nonce !== "string" || typeof session.expiresAt !== "number" || session.expiresAt < Date.now()) return null;
  return session;
}
__name(readInstallSession, "readInstallSession");
function validWorkerName(name) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}
__name(validWorkerName, "validWorkerName");
async function workerExists(token, accountId, workerName, fetcher) {
  const response = await request2(fetcher, `${CLOUDFLARE_API_ENDPOINT}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new InstallerError(response.status === 403 ? "cloudflare_permission_denied" : "cloudflare_api_error", response.status);
}
__name(workerExists, "workerExists");
async function fetchBundle(env, fetcher) {
  if (!env.HOMEGATE_BUNDLE_URL) throw new InstallerError("bundle_not_configured", 503);
  let url;
  try {
    url = new URL(env.HOMEGATE_BUNDLE_URL);
  } catch {
    throw new InstallerError("bundle_not_configured", 503);
  }
  if (url.protocol !== "https:") throw new InstallerError("bundle_not_configured", 503);
  const response = await request2(fetcher, url, { headers: { Accept: "application/javascript, text/javascript" } });
  if (!response.ok) throw new InstallerError("bundle_unavailable", 502);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BUNDLE_BYTES) throw new InstallerError("bundle_invalid", 502);
  return new TextDecoder().decode(bytes);
}
__name(fetchBundle, "fetchBundle");
async function uploadWorker(token, accountId, workerName, bundle, fetcher) {
  const metadata = { main_module: "index.js", compatibility_date: "2026-09-20", bindings: [] };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("index.js", new Blob([bundle], { type: "application/javascript" }), "index.js");
  const response = await request2(fetcher, `${CLOUDFLARE_API_ENDPOINT}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "If-None-Match": "*" },
    body: form
  });
  if (!response.ok) throw new InstallerError(response.status === 409 ? "worker_name_taken" : response.status === 403 ? "cloudflare_permission_denied" : "worker_upload_failed", response.status);
}
__name(uploadWorker, "uploadWorker");
async function enableWorkersDev(token, accountId, workerName, fetcher) {
  await cloudflareJson(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  }, fetcher);
}
__name(enableWorkersDev, "enableWorkersDev");
async function accountSubdomain(token, accountId, fetcher) {
  const path = `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
  try {
    const body = await cloudflareJson(token, path, {}, fetcher);
    if (!body.result || typeof body.result.subdomain !== "string" || !/^[a-z0-9-]+$/.test(body.result.subdomain)) throw new InstallerError("workers_dev_unavailable", 502);
    return body.result.subdomain;
  } catch (error) {
    if (!(error instanceof InstallerError) || error.status !== 404) throw error;
    const candidate = `homegate-${randomHex()}`;
    const created = await cloudflareJson(token, path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain: candidate })
    }, fetcher);
    if (!created.result || typeof created.result.subdomain !== "string" || !/^[a-z0-9-]+$/.test(created.result.subdomain)) {
      throw new InstallerError("workers_dev_unavailable", 502);
    }
    return created.result.subdomain;
  }
}
__name(accountSubdomain, "accountSubdomain");
async function installWorker(options) {
  const { session, accountId, workerName, env, fetcher = fetch } = options;
  if (!session.accounts.some((account) => account.id === accountId)) throw new InstallerError("account_invalid", 400);
  if (!validWorkerName(workerName)) throw new InstallerError("worker_name_invalid", 400);
  if (await workerExists(session.accessToken, accountId, workerName, fetcher)) throw new InstallerError("worker_name_taken", 409);
  const bundle = await fetchBundle(env, fetcher);
  await uploadWorker(session.accessToken, accountId, workerName, bundle, fetcher);
  await enableWorkersDev(session.accessToken, accountId, workerName, fetcher);
  const subdomain = await accountSubdomain(session.accessToken, accountId, fetcher);
  return { workerName, url: `https://${workerName}.${subdomain}.workers.dev` };
}
__name(installWorker, "installWorker");
function installerErrorMessage(error) {
  switch (error.code) {
    case "installer_not_configured":
      return "Installer\u306EOAuth\u8A2D\u5B9A\u304C\u307E\u3060\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u904B\u55B6\u8005\u306B\u9023\u7D61\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "oauth_cancelled":
      return "Cloudflare\u3078\u306E\u63A5\u7D9A\u304C\u30AD\u30E3\u30F3\u30BB\u30EB\u3055\u308C\u307E\u3057\u305F\u3002";
    case "oauth_state_invalid":
      return "OAuth\u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u305F\u304B\u3001\u7121\u52B9\u306B\u306A\u3063\u3066\u3044\u307E\u3059\u3002\u6700\u521D\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "cloudflare_permission_denied":
      return "\u9078\u629E\u3057\u305FAccount\u3078\u306EWorker\u4F5C\u6210\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002Cloudflare\u306E\u6A29\u9650\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "no_cloudflare_accounts":
      return "\u5229\u7528\u53EF\u80FD\u306ACloudflare Account\u304C\u3042\u308A\u307E\u305B\u3093\u3002";
    case "worker_name_taken":
      return "\u540C\u540D\u306EWorker\u304C\u5B58\u5728\u3057\u307E\u3059\u3002\u5225\u306EWorker\u540D\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "worker_name_invalid":
      return "Worker\u540D\u306F\u82F1\u5C0F\u6587\u5B57\u3001\u6570\u5B57\u3001\u30CF\u30A4\u30D5\u30F3\u30671\u301C63\u6587\u5B57\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "account_invalid":
      return "Cloudflare Account\u306E\u9078\u629E\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "bundle_not_configured":
      return "HomeGate Worker bundle\u306E\u914D\u5E03\u8A2D\u5B9A\u304C\u307E\u3060\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002";
    case "bundle_unavailable":
    case "bundle_invalid":
      return "HomeGate Worker bundle\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "workers_dev_unavailable":
      return "Worker\u306F\u4F5C\u6210\u3055\u308C\u307E\u3057\u305F\u304C\u3001workers.dev URL\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002Cloudflare Dashboard\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    default:
      return "HomeGate\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
  }
}
__name(installerErrorMessage, "installerErrorMessage");

// src/web/installer-pages.ts
var headers = {
  "Content-Type": "text/html; charset=UTF-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};
function escapeHtml2(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
__name(escapeHtml2, "escapeHtml");
function page2(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml2(title)} | HomeGate</title>
<style>:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{max-width:760px;margin:0 auto;padding:2rem 1rem 4rem;line-height:1.65}.card{border:1px solid #8886;border-radius:.75rem;padding:1.25rem;margin:1rem 0}a{color:#f38020}.button{display:inline-block;padding:.7rem 1.1rem;border:0;border-radius:.5rem;background:#f38020;color:#fff;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}label{display:block;padding:.7rem;border:1px solid #8886;border-radius:.5rem;margin:.5rem 0}input[type=text]{box-sizing:border-box;width:100%;padding:.65rem;margin:.3rem 0 .8rem;font:inherit}input[type=radio]{margin-right:.5rem}.notice{padding:.75rem;border-left:4px solid #c33;background:#c331}small{opacity:.8}</style></head>
<body>${body}</body></html>`, { status, headers });
}
__name(page2, "page");
function installerPage(configured, message2) {
  const notice = message2 ? `<p class="notice">${escapeHtml2(message2)}</p>` : "";
  const action = configured ? `<p><a class="button" href="/oauth/start">Cloudflare\u3067\u7D9A\u884C</a></p>` : `<p class="notice">\u3053\u306EInstaller\u306F\u307E\u3060Cloudflare OAuth Client\u306B\u63A5\u7D9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002</p>`;
  return page2("HomeGate Installer", `${notice}
    <h1>HomeGate Installer</h1>
    <p>HomeGate\u3092\u3042\u306A\u305F\u306ECloudflare\u74B0\u5883\u306B\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u3057\u307E\u3059\u3002</p>
    <div class="card"><p>GitHub\u3001GitLab\u3001Node.js\u3001npm\u3001Wrangler\u3001Docker\u3001\u30BF\u30FC\u30DF\u30CA\u30EB\u306F\u5FC5\u8981\u3042\u308A\u307E\u305B\u3093\u3002</p><p>Cloudflare OAuth\u306E\u8A8D\u53EF\u5F8C\u3001\u9078\u629E\u3057\u305FAccount\u306BHomeGate Worker\u3060\u3051\u3092\u4F5C\u6210\u3057\u307E\u3059\u3002\u65E2\u5B58\u306EWorker\u3001DNS\u3001\u30C9\u30E1\u30A4\u30F3\u3001D1\u3001KV\u306F\u5909\u66F4\u3057\u307E\u305B\u3093\u3002</p>${action}</div>
    <p><small>OAuth Access Token\u306F\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u51E6\u7406\u4E2D\u3060\u3051\u6697\u53F7\u5316\u3055\u308C\u305F\u77ED\u671F\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u4FDD\u6301\u3057\u3001\u904B\u55B6\u5074\u306EDB\u3084\u30ED\u30B0\u306B\u306F\u4FDD\u5B58\u3057\u307E\u305B\u3093\u3002\u901A\u5E38\u5229\u7528\u306F\u4F5C\u6210\u3055\u308C\u305FWorker\u3060\u3051\u3067\u5B8C\u7D50\u3057\u307E\u3059\u3002</small></p>`);
}
__name(installerPage, "installerPage");
function accountSelectionPage(accounts, nonce, message2) {
  const notice = message2 ? `<p class="notice">${escapeHtml2(message2)}</p>` : "";
  const choices = accounts.map((account, index) => `<label><input type="radio" name="account_id" value="${escapeHtml2(account.id)}"${index === 0 ? " checked" : ""}>${escapeHtml2(account.name)} <small>(${escapeHtml2(account.id)})</small></label>`).join("");
  return page2("Install HomeGate", `${notice}
    <h1>Install HomeGate</h1>
    <p>Worker\u3092\u4F5C\u6210\u3059\u308BCloudflare Account\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>
    <form method="post" action="/install/account">
      <input type="hidden" name="nonce" value="${escapeHtml2(nonce)}">
      <div class="card"><h2>Cloudflare Account</h2>${choices}</div>
      <label for="worker_name">Worker\u540D</label>
      <input id="worker_name" name="worker_name" type="text" value="homegate" pattern="[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?" maxlength="63" required>
      <button class="button" type="submit">\u3053\u306EAccount\u306B\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB</button>
    </form>
    <p><small>\u540C\u540D\u306EWorker\u304C\u3042\u308B\u5834\u5408\u306F\u4E0A\u66F8\u304D\u305B\u305A\u3001\u30A8\u30E9\u30FC\u3092\u8868\u793A\u3057\u307E\u3059\u3002</small></p>`);
}
__name(accountSelectionPage, "accountSelectionPage");
function installCompletePage(workerName, url) {
  const safeUrl = escapeHtml2(url);
  return page2("HomeGate is ready", `<h1>HomeGate is ready.</h1>
    <div class="card"><p>\u2713 Cloudflare Account</p><p>\u2713 Worker created: <code>${escapeHtml2(workerName)}</code></p><p>\u2713 HomeGate uploaded</p><p>\u2713 workers.dev deployment complete</p></div>
    <p><a class="button" href="${safeUrl}/setup">\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7\u3092\u7D9A\u3051\u308B</a></p>
    <p>Worker URL: <a href="${safeUrl}">${safeUrl}</a></p>
    <p><small>\u4EE5\u5F8C\u306EDiscord\u3001SESAME\u3001Permission\u3001Audit\u8A2D\u5B9A\u306F\u3042\u306A\u305F\u306EHomeGate Worker\u3067\u884C\u3044\u307E\u3059\u3002</small></p>`);
}
__name(installCompletePage, "installCompletePage");
function installerErrorPage(message2, status = 400) {
  return page2("HomeGate Installer", `<h1>HomeGate\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002</h1><p class="notice">${escapeHtml2(message2)}</p><p><a href="/install">\u6700\u521D\u304B\u3089\u3084\u308A\u76F4\u3059</a></p>`, status);
}
__name(installerErrorPage, "installerErrorPage");

// src/index.ts
var INTERNAL_ERROR = "An error occurred while processing the request.";
function setupErrorMessage(error) {
  if (!(error instanceof DiscordRegistrationError)) return "Discord API\u3078\u306E\u63A5\u7D9A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002";
  switch (error.code) {
    case "invalid_input":
    case "missing_credentials":
    case "authentication_failed":
      return "Discord Application ID\u307E\u305F\u306FClient Secret\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "rate_limited":
      return "Discord API\u306E\u5229\u7528\u5236\u9650\u4E2D\u3067\u3059\u3002\u5C11\u3057\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    case "network_error":
      return "Discord API\u3078\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u6642\u9593\u3092\u7F6E\u3044\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    default:
      return "Discord API\u3067\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002Application\u8A2D\u5B9A\u3068\u6A29\u9650\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
  }
}
__name(setupErrorMessage, "setupErrorMessage");
async function getDiscordSetupView(env, fetcher, message2) {
  const applicationId = env.DISCORD_CLIENT_ID;
  const publicKeyConfigured = isPublicKey(env.DISCORD_PUBLIC_KEY);
  const applicationConfigured = typeof applicationId === "string" && /^\d{17,20}$/.test(applicationId);
  const clientCredentialsConfigured = applicationConfigured && typeof env.DISCORD_CLIENT_SECRET === "string" && env.DISCORD_CLIENT_SECRET.length > 0;
  const view = {
    applicationConfigured,
    publicKeyConfigured,
    clientCredentialsConfigured,
    commandRegistered: false,
    endpointConfigured: null,
    serverInstallation: "manual",
    applicationId: applicationConfigured ? applicationId : void 0,
    installUrl: applicationConfigured ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=applications.commands&permissions=0` : void 0,
    message: message2
  };
  if (!clientCredentialsConfigured || !applicationId || !env.DISCORD_CLIENT_SECRET) return view;
  try {
    const token = await getClientCredentialsToken(applicationId, env.DISCORD_CLIENT_SECRET, fetcher);
    const snapshot = await inspectDiscordSetup({ applicationId, accessToken: token, fetcher });
    view.commandRegistered = commands.every((command) => snapshot.commandNames.includes(command.name));
    view.endpointConfigured = null;
  } catch (error) {
    view.message = message2 ?? setupErrorMessage(error);
  }
  return view;
}
__name(getDiscordSetupView, "getDiscordSetupView");
function json2(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
__name(json2, "json");
function createWorker(locks = new MockLockService(), discordFetch = fetch, cloudflareFetch = fetch) {
  return {
    async fetch(request3, env) {
      const path = new URL(request3.url).pathname;
      if (path === "/install" && request3.method === "GET") {
        return installerPage(Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID && env.HOMEGATE_OAUTH_STATE_SECRET));
      }
      if (path === "/oauth/start" && request3.method === "GET") {
        try {
          return await beginOAuth(request3, env);
        } catch (error) {
          const installerError = error instanceof InstallerError ? error : new InstallerError("installer_not_configured", 503);
          return installerErrorPage(installerErrorMessage(installerError), installerError.status);
        }
      }
      if (path === "/oauth/callback" && request3.method === "GET") {
        const result = await completeOAuth(request3, env, cloudflareFetch);
        if ("error" in result) return installerErrorPage(installerErrorMessage(result.error), result.error.status);
        return result.redirect;
      }
      if (path === "/install/account" && request3.method === "GET") {
        const session = await readInstallSession(request3, env);
        if (!session) return Response.redirect(`${new URL(request3.url).origin}/install`, 302);
        return accountSelectionPage(session.accounts, session.nonce);
      }
      if (path === "/install/account" && request3.method === "POST") {
        const origin = request3.headers.get("Origin");
        if (origin && origin !== new URL(request3.url).origin) return installerErrorPage("\u4E0D\u6B63\u306A\u9001\u4FE1\u5143\u3067\u3059\u3002", 403);
        const session = await readInstallSession(request3, env);
        if (!session) return installerErrorPage("Installer\u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002\u6700\u521D\u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002", 400);
        let form;
        try {
          form = await request3.formData();
        } catch {
          return installerErrorPage("\u5165\u529B\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", 400);
        }
        const accountId = form.get("account_id");
        const workerName = form.get("worker_name");
        const nonce = form.get("nonce");
        if (typeof accountId !== "string" || typeof workerName !== "string" || typeof nonce !== "string" || nonce !== session.nonce) {
          return accountSelectionPage(session.accounts, session.nonce, "\u5165\u529B\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        }
        try {
          const result = await installWorker({ session, accountId, workerName, env, fetcher: cloudflareFetch });
          const response = installCompletePage(result.workerName, result.url);
          for (const header of clearInstallerCookies()) response.headers.append("Set-Cookie", header);
          return response;
        } catch (error) {
          const installerError = error instanceof InstallerError ? error : new InstallerError("cloudflare_api_error", 502);
          return accountSelectionPage(session.accounts, session.nonce, installerErrorMessage(installerError));
        }
      }
      if (path === "/" && request3.method === "GET") {
        return homePage();
      }
      if (path === "/setup" && request3.method === "GET") {
        return setupPage();
      }
      if (path === "/setup.js" && request3.method === "GET") {
        return setupScript();
      }
      if (path === "/setup/discord" && request3.method === "GET") {
        const endpointUrl = `${new URL(request3.url).origin}/discord/interactions`;
        return discordSetupPage(endpointUrl, await getDiscordSetupView(env, discordFetch));
      }
      if (path === "/setup/discord/register" && request3.method === "POST") {
        const origin = request3.headers.get("Origin");
        if (origin && origin !== new URL(request3.url).origin) return new Response("Forbidden.", { status: 403 });
        const endpointUrl = `${new URL(request3.url).origin}/discord/interactions`;
        let message2;
        if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
          message2 = "Cloudflare Secret\u306EDISCORD_CLIENT_ID\u3068DISCORD_CLIENT_SECRET\u3092\u5148\u306B\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
        } else {
          try {
            await registerCommandsWithClientCredentials({
              applicationId: env.DISCORD_CLIENT_ID,
              clientSecret: env.DISCORD_CLIENT_SECRET,
              fetcher: discordFetch
            });
            message2 = "4\u30B3\u30DE\u30F3\u30C9\u3092Discord\u3078\u767B\u9332\u3057\u307E\u3057\u305F\u3002";
          } catch (error) {
            const requestId2 = crypto.randomUUID();
            const code = error instanceof DiscordRegistrationError ? error.code : "unknown";
            console.error(JSON.stringify({ event: "discord_command_registration_failed", requestId: requestId2, code }));
            message2 = setupErrorMessage(error);
          }
        }
        return discordSetupPage(endpointUrl, await getDiscordSetupView(env, discordFetch, message2));
      }
      const interactionPath = path === "/interactions" || path === "/discord/interactions";
      if (!interactionPath) return json2({ error: "Not found." }, 404);
      if (request3.method !== "POST") {
        return new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } });
      }
      const requestId = crypto.randomUUID();
      if (!isPublicKey(env.DISCORD_PUBLIC_KEY)) {
        console.error(JSON.stringify({ event: "configuration_error", requestId }));
        return json2({ error: "Service unavailable." }, 503);
      }
      try {
        const rawBody = await request3.arrayBuffer();
        if (!await verifyDiscordRequest(rawBody, request3.headers, env.DISCORD_PUBLIC_KEY)) {
          return json2({ error: "Invalid request signature." }, 401);
        }
        let interaction;
        try {
          interaction = JSON.parse(new TextDecoder().decode(rawBody));
        } catch {
          return json2({ error: "Invalid JSON." }, 400);
        }
        if (!isInteraction(interaction)) return json2({ error: "Unsupported interaction." }, 400);
        try {
          return json2(await handleInteraction(interaction, locks));
        } catch {
          console.error(JSON.stringify({ event: "interaction_failed", requestId, interactionType: interaction.type }));
          return json2(message(INTERNAL_ERROR));
        }
      } catch {
        console.error(JSON.stringify({ event: "request_failed", requestId }));
        return json2({ error: INTERNAL_ERROR }, 500);
      }
    }
  };
}
__name(createWorker, "createWorker");
var index_default = createWorker();
export {
  createWorker,
  index_default as default
};
//# sourceMappingURL=index.js.map
