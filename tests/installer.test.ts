import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../src/index";

const accountId = "a".repeat(32);
const env = {
  DISCORD_PUBLIC_KEY: "",
  CLOUDFLARE_OAUTH_CLIENT_ID: "public-client-id",
  HOMEGATE_OAUTH_STATE_SECRET: "installer-state-secret-that-is-long-enough-1234",
  HOMEGATE_BUNDLE_URL: "https://cdn.example.test/homegate-worker.js",
};

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ?? "").split(/,(?=\s*__Host-)/).filter(Boolean);
}

function cookieHeader(response: Response, name: string): string {
  const value = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(value, `${name} cookie missing`);
  const first = value.split(";", 1)[0];
  assert.ok(first);
  return first;
}

test("OAuth start uses Cloudflare Authorization Code + PKCE and does not expose verifier", async () => {
  const response = await createWorker().fetch(new Request("https://installer.example.test/oauth/start"), env);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin, "https://dash.cloudflare.com");
  assert.equal(location.pathname, "/oauth2/auth");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("client_id"), "public-client-id");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("code_challenge"));
  assert.match(location.searchParams.get("scope") ?? "", /account\.read/);
  assert.match(location.searchParams.get("scope") ?? "", /workers-platform\.write/);
  assert.match(cookieHeader(response, "__Host-homegate_oauth"), /^__Host-homegate_oauth=[A-Za-z0-9_-]+$/);
  assert.ok(!location.search.includes("verifier"));
});

test("OAuth callback validates state and keeps the Cloudflare token out of HTML", async () => {
  let tokenRequestBody = "";
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://dash.cloudflare.com/oauth2/token") {
      tokenRequestBody = String(init.body ?? "");
      return new Response(JSON.stringify({ access_token: "oauth-access-token-secret", token_type: "bearer", expires_in: 600 }));
    }
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts?")) {
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-access-token-secret");
      return new Response(JSON.stringify({ success: true, result: [{ id: accountId, name: "Creator Studio" }] }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const callback = await worker.fetch(new Request(`https://installer.example.test/oauth/callback?code=authorization-code&state=${encodeURIComponent(authUrl.searchParams.get("state") ?? "")}`, {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  assert.equal(callback.status, 302);
  assert.equal(new URL(callback.headers.get("location") ?? "").pathname, "/install/account");
  assert.match(tokenRequestBody, /grant_type=authorization_code/);
  assert.match(tokenRequestBody, /code_verifier=/);
  const accountPage = await worker.fetch(new Request("https://installer.example.test/install/account", {
    headers: { Cookie: cookieHeader(callback, "__Host-homegate_install") },
  }), env);
  const html = await accountPage.text();
  assert.match(html, /Creator Studio/);
  assert.ok(!html.includes("oauth-access-token-secret"));
});

test("account selection checks worker collision, uploads a bundle, and enables workers.dev", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push(`${init.method ?? "GET"} ${url}`);
    if (url === "https://dash.cloudflare.com/oauth2/token") return new Response(JSON.stringify({ access_token: "oauth-access-token-secret", token_type: "bearer" }));
    if (url.startsWith("https://cdn.example.test/")) return new Response("export default { fetch() { return new Response('ok') } }", { headers: { "Content-Type": "application/javascript" } });
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts?")
      || url.endsWith(`/accounts/${accountId}/workers/subdomain`)) return new Response(JSON.stringify({ success: true, result: url.includes("workers/subdomain") ? { subdomain: "creator" } : [{ id: accountId, name: "Creator Studio" }] }));
    if (init.method !== "PUT" && url.endsWith(`/accounts/${accountId}/workers/scripts/homegate`)) return new Response(JSON.stringify({ success: false }), { status: 404 });
    if (url.endsWith(`/accounts/${accountId}/workers/scripts/homegate/subdomain`)) {
      assert.deepEqual(JSON.parse(String(init.body)), { enabled: true });
      return new Response(JSON.stringify({ success: true, result: { enabled: true } }));
    }
    if (init.method === "PUT" && url.endsWith(`/accounts/${accountId}/workers/scripts/homegate`)) {
      const body = init.body as FormData;
      assert.match(String(body.get("metadata")), /"main_module":"index.js"/);
      assert.ok(body.get("index.js") instanceof Blob);
      return new Response(JSON.stringify({ success: true, result: { id: "homegate" } }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const callback = await worker.fetch(new Request(`https://installer.example.test/oauth/callback?code=authorization-code&state=${encodeURIComponent(authUrl.searchParams.get("state") ?? "")}`, {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  const sessionCookie = cookieHeader(callback, "__Host-homegate_install");
  const accountPage = await worker.fetch(new Request("https://installer.example.test/install/account", { headers: { Cookie: sessionCookie } }), env);
  const nonce = /name="nonce" value="([^"]+)"/.exec(await accountPage.text())?.[1];
  assert.ok(nonce);
  const body = new URLSearchParams({ account_id: accountId, worker_name: "homegate", nonce });
  const complete = await worker.fetch(new Request("https://installer.example.test/install/account", {
    method: "POST", headers: { Cookie: sessionCookie, Origin: "https://installer.example.test", "Content-Type": "application/x-www-form-urlencoded" }, body,
  }), env);
  assert.equal(complete.status, 200);
  const html = await complete.text();
  assert.match(html, /https:\/\/homegate\.creator\.workers\.dev\/setup/);
  assert.ok(!html.includes("oauth-access-token-secret"));
  assert.ok(requests.some((entry) => entry.startsWith("PUT https://api.cloudflare.com/client/v4/accounts/")));
  assert.ok(requests.some((entry) => entry.includes("/subdomain")));
});

test("new accounts receive a workers.dev subdomain only when none exists", async () => {
  let subdomainCreateBody = "";
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith(`/accounts/${accountId}/workers/scripts/homegate`)) {
      if (init.method === "PUT") return new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    }
    if (url.endsWith(`/accounts/${accountId}/workers/scripts/homegate/subdomain`)) return new Response(JSON.stringify({ success: true, result: { enabled: true } }));
    if (url.endsWith(`/accounts/${accountId}/workers/subdomain`)) {
      if (init.method === "PUT") {
        subdomainCreateBody = String(init.body);
        return new Response(JSON.stringify({ success: true, result: { subdomain: "homegate-a1b2c3d4e5f6" } }));
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    }
    if (url.startsWith("https://cdn.example.test/")) return new Response("export default { fetch() { return new Response('ok') } }", { headers: { "Content-Type": "application/javascript" } });
    throw new Error(`unexpected URL: ${url}`);
  };
  const result = await (await import("../src/installer/oauth")).installWorker({
    session: { accessToken: "oauth-access-token-secret", accounts: [{ id: accountId, name: "Creator Studio" }], nonce: "nonce", expiresAt: Date.now() + 60_000 },
    accountId,
    workerName: "homegate",
    env,
    fetcher,
  });
  assert.equal(result.url, "https://homegate.homegate-a1b2c3d4e5f6.workers.dev");
  const createdSubdomain = JSON.parse(subdomainCreateBody) as { subdomain?: unknown };
  assert.equal(typeof createdSubdomain.subdomain, "string");
  assert.match(createdSubdomain.subdomain as string, /^homegate-[a-f0-9]{12}$/);
});

test("OAuth callback rejects a state mismatch before calling Cloudflare", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response("unexpected", { status: 500 }); };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const response = await worker.fetch(new Request("https://installer.example.test/oauth/callback?code=authorization-code&state=wrong", {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("OAuth callback rejects a redirect URI origin change before token exchange", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response("unexpected", { status: 500 }); };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const response = await worker.fetch(new Request(`https://other-installer.example.test/oauth/callback?code=authorization-code&state=${encodeURIComponent(authUrl.searchParams.get("state") ?? "")}`, {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("existing Worker names are rejected before upload", async () => {
  let uploadCalls = 0;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://dash.cloudflare.com/oauth2/token") return new Response(JSON.stringify({ access_token: "oauth-access-token-secret", token_type: "bearer" }));
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts?")) return new Response(JSON.stringify({ success: true, result: [{ id: accountId, name: "Creator Studio" }] }));
    if (url.endsWith(`/accounts/${accountId}/workers/scripts/homegate`)) return new Response(JSON.stringify({ success: true, result: { id: "homegate" } }));
    if (init.method === "PUT") uploadCalls++;
    return new Response("unexpected", { status: 500 });
  };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const callback = await worker.fetch(new Request(`https://installer.example.test/oauth/callback?code=authorization-code&state=${encodeURIComponent(authUrl.searchParams.get("state") ?? "")}`, {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  const sessionCookie = cookieHeader(callback, "__Host-homegate_install");
  const accountPage = await worker.fetch(new Request("https://installer.example.test/install/account", { headers: { Cookie: sessionCookie } }), env);
  const nonce = /name="nonce" value="([^"]+)"/.exec(await accountPage.text())?.[1];
  assert.ok(nonce);
  const response = await worker.fetch(new Request("https://installer.example.test/install/account", {
    method: "POST", headers: { Cookie: sessionCookie, Origin: "https://installer.example.test", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ account_id: accountId, worker_name: "homegate", nonce }),
  }), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /同名のWorkerが存在します/);
  assert.equal(uploadCalls, 0);
});

test("Cloudflare permission errors are presented without API details or tokens", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://dash.cloudflare.com/oauth2/token") return new Response(JSON.stringify({ access_token: "oauth-access-token-secret", token_type: "bearer" }));
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts?")) return new Response(JSON.stringify({ success: false, errors: [{ message: "raw secret or token" }] }), { status: 403 });
    return new Response("unexpected", { status: 500 });
  };
  const worker = createWorker(undefined, fetch, fetcher);
  const start = await worker.fetch(new Request("https://installer.example.test/oauth/start"), env);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const response = await worker.fetch(new Request(`https://installer.example.test/oauth/callback?code=authorization-code&state=${encodeURIComponent(authUrl.searchParams.get("state") ?? "")}`, {
    headers: { Cookie: cookieHeader(start, "__Host-homegate_oauth") },
  }), env);
  assert.equal(response.status, 403);
  const html = await response.text();
  assert.match(html, /利用可能なCloudflare Accountがありません|権限がありません/);
  assert.ok(!html.includes("oauth-access-token-secret"));
  assert.ok(!html.includes("raw secret or token"));
});
