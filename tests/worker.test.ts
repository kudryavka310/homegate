import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../src/index";
import { MockLockService } from "../src/services/lock-service";
import { commandBody, signingFixture } from "./helpers";

const fixture = signingFixture();
const env = { DISCORD_PUBLIC_KEY: fixture.publicKey };
const url = "https://homegate.example/interactions";

test("signature covers the exact body bytes, including whitespace and Unicode", async () => {
  const body = ' { "type": 1, "extra": "玄関🔑" } ';
  const response = await createWorker().fetch(new Request(url, fixture.signed(body)), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

for (const scenario of ["missing", "malformed", "forged", "body-tampered", "timestamp-tampered", "expired", "future", "wrong-key"] as const) {
  test(`rejects ${scenario} signature without touching the lock service`, async () => {
    let calls = 0;
    const worker = createWorker({
      async getStatus() { calls++; return { deviceName: "Test", state: "locked" }; },
      async lock() { calls++; },
      async unlock() { calls++; },
    });
    const init = fixture.signed(commandBody("unlock"));
    const headers = new Headers(init.headers);
    let body = init.body;
    let publicKey = fixture.publicKey;
    switch (scenario) {
      case "missing": headers.delete("X-Signature-Ed25519"); break;
      case "malformed": headers.set("X-Signature-Ed25519", "gg".repeat(64)); break;
      case "forged": headers.set("X-Signature-Ed25519", "00".repeat(64)); break;
      case "body-tampered": body += " "; break;
      case "timestamp-tampered": headers.set("X-Signature-Timestamp", String(Number(init.headers["X-Signature-Timestamp"]) - 1)); break;
      case "expired": {
        const old = fixture.signed(body, String(Math.floor(Date.now() / 1000) - 600));
        for (const [key, value] of Object.entries(old.headers)) headers.set(key, value);
        break;
      }
      case "future": {
        const future = fixture.signed(body, String(Math.floor(Date.now() / 1000) + 600));
        for (const [key, value] of Object.entries(future.headers)) headers.set(key, value);
        break;
      }
      case "wrong-key": publicKey = signingFixture().publicKey; break;
    }
    const response = await worker.fetch(new Request(url, { ...init, body, headers }), { DISCORD_PUBLIC_KEY: publicKey });
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
}

test("valid signature is required even for malformed JSON", async () => {
  const worker = createWorker();
  assert.equal((await worker.fetch(new Request(url, { method: "POST", body: "{" }), env)).status, 401);
  assert.equal((await worker.fetch(new Request(url, fixture.signed("{")), env)).status, 400);
});

for (const body of ["null", "[]", '{"type":3}', '{"type":2}', '{"type":2,"data":{"type":1,"name":7}}']) {
  test(`rejects invalid interaction ${body}`, async () => {
    assert.equal((await createWorker().fetch(new Request(url, fixture.signed(body)), env)).status, 400);
  });
}

test("unknown commands return a private response", async () => {
  const response = await createWorker().fetch(new Request(url, fixture.signed(commandBody("unknown"))), env);
  assert.deepEqual(await response.json(), {
    type: 4, data: { content: "Unknown command.", flags: 64, allowed_mentions: { parse: [] } },
  });
});

test("adapter errors and secrets cannot leak through the response or logs", async (t) => {
  const logs = t.mock.method(console, "error", () => {});
  const sensitive = "SECRET_TOKEN_MUST_NOT_LEAK";
  const worker = createWorker({
    async getStatus() { return { deviceName: "Test Door", state: "locked" }; },
    async lock() { throw new Error(sensitive); },
    async unlock() { throw new Error(sensitive); },
  });
  const response = await worker.fetch(new Request(url, fixture.signed(commandBody("unlock"))), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: 4, data: { content: "An error occurred while processing the request.", flags: 64, allowed_mentions: { parse: [] } },
  });
  assert.equal(logs.mock.callCount(), 1);
  const output = JSON.stringify(logs.mock.calls.map((call) => call.arguments));
  assert.match(output, /interaction_failed/);
  assert.ok(!output.includes(sensitive));
  assert.ok(!output.includes(fixture.publicKey));
});

test("missing or invalid public key fails closed", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const key of ["", "not-a-key"]) {
    const response = await createWorker().fetch(new Request(url, fixture.signed('{"type":1}')), { DISCORD_PUBLIC_KEY: key });
    assert.equal(response.status, 503);
  }
});

test("HTTP routes and method restriction", async () => {
  const worker = createWorker();
  const method = await worker.fetch(new Request(url), env);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "POST");
  assert.equal((await worker.fetch(new Request("https://homegate.example/missing"), env)).status, 404);
  const home = await worker.fetch(new Request("https://homegate.example/"), env);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /初期設定を始める/);
  assert.equal(home.headers.get("Content-Security-Policy")?.includes("connect-src 'none'"), true);
  assert.equal(home.headers.get("Content-Security-Policy")?.includes("script-src 'self'"), true);
  const setup = await worker.fetch(new Request("https://homegate.example/setup"), env);
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /DISCORD_PUBLIC_KEY/);
  const setupScript = await worker.fetch(new Request("https://homegate.example/setup.js"), env);
  assert.equal(setupScript.status, 200);
  assert.match(await setupScript.text(), /clipboard/);
});

test("Discord setup page exposes status and never renders secrets", async () => {
  const clientSecret = "super-secret-client-value";
  const response = await createWorker().fetch(
    new Request("https://homegate.example/setup/discord"),
    { ...env, DISCORD_CLIENT_ID: "123456789012345678", DISCORD_CLIENT_SECRET: clientSecret },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /DISCORD_CLIENT_SECRET/);
  assert.ok(!html.includes(clientSecret));
  assert.match(html, /applications\.commands/);
  assert.match(html, /https:\/\/homegate\.example\/discord\/interactions/);
  assert.match(html, /1\. Discord Application/);
  assert.match(html, /6\. 動作確認/);
  assert.match(html, /data-copy-endpoint/);
  assert.match(html, /setup\.js/);
});

test("browser setup registers global commands with client credentials and shows the endpoint", async () => {
  const clientId = "123456789012345678";
  const clientSecret = "super-secret-client-value";
  const calls: string[] = [];
  const discordFetch: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "access-token", token_type: "Bearer" }));
    if (url.endsWith(`/applications/${clientId}/commands`)) {
      if (init.method === "POST") return new Response(JSON.stringify({ id: "987654321098765432", name: "ping", type: 1 }));
      return new Response(JSON.stringify([
        { name: "ping" }, { name: "status" }, { name: "lock" }, { name: "unlock" },
      ]));
    }
    throw new Error(`unexpected Discord URL: ${url}`);
  };
  const worker = createWorker(new MockLockService(), discordFetch);
  const response = await worker.fetch(
    new Request("https://homegate.example/setup/discord/register", {
      method: "POST",
      headers: { Origin: "https://homegate.example" },
    }),
    { ...env, DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: clientSecret },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /4コマンドをDiscordへ登録しました/);
  assert.match(html, /Command Registration/);
  assert.match(html, /Interactions Endpoint/);
  assert.ok(!html.includes(clientSecret));
  assert.equal(calls.filter((url) => url.endsWith("/oauth2/token")).length, 2);
  assert.equal(calls.filter((url) => url.endsWith(`/applications/${clientId}/commands`)).length, 5);
  assert.equal(calls.filter((url) => url.endsWith("/applications/@me")).length, 0);
});

test("setup registration rejects a cross-origin form without calling Discord", async () => {
  let calls = 0;
  const discordFetch: typeof fetch = async () => {
    calls++;
    return new Response("unexpected", { status: 500 });
  };
  const response = await createWorker(new MockLockService(), discordFetch).fetch(
    new Request("https://homegate.example/setup/discord/register", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    { ...env, DISCORD_CLIENT_ID: "123456789012345678", DISCORD_CLIENT_SECRET: "secret" },
  );
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("the documented /discord/interactions endpoint is an alias of /interactions", async () => {
  const response = await createWorker().fetch(
    new Request("https://homegate.example/discord/interactions", fixture.signed('{"type":1}')),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("mock instances start locked and do not share state", async () => {
  const first = new MockLockService();
  const second = new MockLockService();
  await first.unlock();
  assert.equal((await first.getStatus()).state, "unlocked");
  assert.equal((await second.getStatus()).state, "locked");
  const snapshot = await first.getStatus();
  snapshot.state = "locked";
  assert.equal((await first.getStatus()).state, "unlocked");
});
