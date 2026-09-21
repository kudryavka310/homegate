import assert from "node:assert/strict";
import { test } from "node:test";
import { createInstallerWorker } from "../src/installer-entry";
import { createWorker } from "../src/index";

const runtimeEnv = { DISCORD_PUBLIC_KEY: "" };
const installerEnv = {
  CLOUDFLARE_OAUTH_CLIENT_ID: "public-client-id",
  HOMEGATE_OAUTH_STATE_SECRET: "installer-state-secret-that-is-long-enough-1234",
  HOMEGATE_BUNDLE_URL: "https://cdn.example.test/homegate-worker.js",
};

test("runtime Worker does not expose Installer routes", async () => {
  const worker = createWorker();
  for (const path of ["/install", "/oauth/start", "/oauth/callback", "/install/account"]) {
    const response = await worker.fetch(new Request(`https://homegate.example.test${path}`), runtimeEnv);
    assert.equal(response.status, 404, path);
  }
});

test("Installer Worker exposes the installation entrypoint", async () => {
  const worker = createInstallerWorker();
  const response = await worker.fetch(new Request("https://installer.example.test/install"), installerEnv);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /HomeGate Installer/);
});
