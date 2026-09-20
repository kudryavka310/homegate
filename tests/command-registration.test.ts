import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DiscordRegistrationError,
  getClientCredentialsToken,
  inspectDiscordSetup,
  registerCommandsWithClientCredentials,
  registerCommandsWithToken,
} from "../src/discord/command-registration";
import { commands } from "../src/discord/commands";

const applicationId = "123456789012345678";
const clientSecret = "client-secret-value";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("client credentials registration uses the official scope and shared definitions", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/oauth2/token")) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers && new Headers(init.headers).get("Content-Type"), "application/x-www-form-urlencoded");
      assert.equal(await new Response(init.body).text(), "grant_type=client_credentials&scope=applications.commands.update");
      assert.ok(new Headers(init.headers).get("Authorization")?.startsWith("Basic "));
      assert.ok(!await new Response(init.body).text().then((body) => body.includes(clientSecret)));
      return response({ access_token: "access-token", token_type: "Bearer" });
    }
    assert.equal(url, `https://discord.com/api/v10/applications/${applicationId}/commands`);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer access-token");
    const definition = JSON.parse(String(init.body));
    assert.ok(commands.some((command) => command.name === definition.name));
    assert.equal(definition.type, 1);
    return response({ id: "123456789012345679", ...definition });
  };

  const result = await registerCommandsWithClientCredentials({ applicationId, clientSecret, fetcher });
  assert.deepEqual(result.commandNames, ["ping", "status", "lock", "unlock"]);
  assert.equal(requests.length, 5);
});

test("registration supports the developer Bot Token fallback and guild endpoint", async () => {
  const fetcher: typeof fetch = async (input, init = {}) => {
    assert.equal(String(input), `https://discord.com/api/v10/applications/${applicationId}/guilds/987654321098765432/commands`);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bot bot-token");
    return response({ id: "123456789012345679", name: "ping", type: 1 });
  };
  const result = await registerCommandsWithToken({
    applicationId,
    guildId: "987654321098765432",
    accessToken: "bot-token",
    authScheme: "Bot",
    fetcher,
  });
  assert.equal(result.commandNames.length, commands.length);
});

test("Discord failures are classified without exposing token values", async () => {
  const authFailure: typeof fetch = async () => response({ message: "bad" }, 401);
  await assert.rejects(
    () => getClientCredentialsToken(applicationId, clientSecret, authFailure),
    (error: unknown) => error instanceof DiscordRegistrationError && error.code === "authentication_failed",
  );

  const rateLimit: typeof fetch = async () => response({ retry_after: 1 }, 429);
  await assert.rejects(
    () => registerCommandsWithToken({ applicationId, accessToken: "token", authScheme: "Bearer", fetcher: rateLimit }),
    (error: unknown) => error instanceof DiscordRegistrationError && error.code === "rate_limited",
  );

  const malformed: typeof fetch = async () => response(null);
  await assert.rejects(
    () => registerCommandsWithToken({ applicationId, accessToken: "token", authScheme: "Bearer", fetcher: malformed }),
    (error: unknown) => error instanceof DiscordRegistrationError && error.code === "invalid_response",
  );
  await assert.rejects(() => getClientCredentialsToken("not-an-id", clientSecret), /invalid_input/);
});

test("setup inspection reads registered command names", async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), `https://discord.com/api/v10/applications/${applicationId}/commands`);
    return response(commands);
  };
  const snapshot = await inspectDiscordSetup({ applicationId, accessToken: "token", fetcher });
  assert.deepEqual(snapshot.commandNames, commands.map((command) => command.name));
});
