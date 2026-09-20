import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestHarness } from "wrangler";
import { commandBody, signingFixture } from "./helpers";

test("signed Discord requests run inside the Workers runtime", { timeout: 60_000 }, async (t) => {
  const fixture = signingFixture();
  const server = createTestHarness({
    workers: [{ configPath: "./wrangler.jsonc", secrets: { DISCORD_PUBLIC_KEY: fixture.publicKey } }],
  });
  t.after(async () => { await server.close(); });
  await server.listen();

  await t.test("Discord endpoint verification PING", async () => {
    const response = await server.fetch("/interactions", fixture.signed('{"type":1}'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: 1 });
  });

  await t.test("browser setup pages are available without a secret in the HTML", async () => {
    const home = await server.fetch("/");
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /初期設定を始める/);
    assert.ok(!html.includes(fixture.publicKey));
    const setup = await server.fetch("/setup");
    assert.equal(setup.status, 200);
    assert.match(await setup.text(), /DISCORD_PUBLIC_KEY/);
  });

  for (const [command, expected] of [
    ["ping", "HomeGate is running."],
    ["status", "Studio Door\nStatus: Locked"],
    ["unlock", "Studio Door has been unlocked."],
    ["status", "Studio Door\nStatus: Unlocked"],
    ["lock", "Studio Door has been locked."],
    ["status", "Studio Door\nStatus: Locked"],
  ] as const) {
    await t.test(`/${command}: ${expected}`, async () => {
      const response = await server.fetch("/interactions", fixture.signed(commandBody(command)));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        type: 4, data: { content: expected, flags: 64, allowed_mentions: { parse: [] } },
      });
    });
  }

  await t.test("forged unlock returns 401 and does not change state", async () => {
    const signed = fixture.signed(commandBody("unlock"));
    signed.headers["X-Signature-Ed25519"] = "00".repeat(64);
    assert.equal((await server.fetch("/interactions", signed)).status, 401);
    const status = await server.fetch("/interactions", fixture.signed(commandBody("status")));
    assert.deepEqual(await status.json(), {
      type: 4, data: { content: "Studio Door\nStatus: Locked", flags: 64, allowed_mentions: { parse: [] } },
    });
  });
});
