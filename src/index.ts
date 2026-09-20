import { handleInteraction, message } from "./discord/interaction";
import { isPublicKey, verifyDiscordRequest } from "./discord/verify";
import { MockLockService } from "./services/lock-service";
import type { LockService } from "./services/lock-service";
import { isInteraction } from "./types/discord";
import {
  DiscordRegistrationError,
  getClientCredentialsToken,
  inspectDiscordSetup,
  registerCommandsWithClientCredentials,
} from "./discord/command-registration";
import { commands } from "./discord/commands";
import { homePage, setupPage, setupScript, discordSetupPage, type DiscordSetupView } from "./web/pages";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

const INTERNAL_ERROR = "An error occurred while processing the request.";

function setupErrorMessage(error: unknown): string {
  if (!(error instanceof DiscordRegistrationError)) return "Discord APIへの接続に失敗しました。";
  switch (error.code) {
    case "invalid_input":
    case "missing_credentials":
    case "authentication_failed":
      return "Discord Application IDまたはClient Secretを確認してください。";
    case "rate_limited":
      return "Discord APIの利用制限中です。少し待ってから再試行してください。";
    case "network_error":
      return "Discord APIへ接続できませんでした。時間を置いて再試行してください。";
    default:
      return "Discord APIで処理に失敗しました。Application設定と権限を確認してください。";
  }
}

async function getDiscordSetupView(
  env: Env,
  fetcher: typeof fetch,
  message?: string,
): Promise<DiscordSetupView> {
  const applicationId = env.DISCORD_CLIENT_ID;
  const publicKeyConfigured = isPublicKey(env.DISCORD_PUBLIC_KEY);
  const applicationConfigured = typeof applicationId === "string" && /^\d{17,20}$/.test(applicationId);
  const clientCredentialsConfigured = applicationConfigured
    && typeof env.DISCORD_CLIENT_SECRET === "string" && env.DISCORD_CLIENT_SECRET.length > 0;
  const view: DiscordSetupView = {
    applicationConfigured,
    publicKeyConfigured,
    clientCredentialsConfigured,
    commandRegistered: false,
    endpointConfigured: null,
    serverInstallation: "manual",
    applicationId: applicationConfigured ? applicationId : undefined,
    installUrl: applicationConfigured
      ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=applications.commands&permissions=0`
      : undefined,
    message,
  };
  if (!clientCredentialsConfigured || !applicationId || !env.DISCORD_CLIENT_SECRET) return view;

  try {
    const token = await getClientCredentialsToken(applicationId, env.DISCORD_CLIENT_SECRET, fetcher);
    const snapshot = await inspectDiscordSetup({ applicationId, accessToken: token, fetcher });
    view.commandRegistered = commands.every((command) => snapshot.commandNames.includes(command.name));
    // Discord documents the Client Credentials scope for command endpoints.
    // Endpoint/Public Key validation remains in the Developer Portal's signed PING check.
    view.endpointConfigured = null;
  } catch (error) {
    view.message = message ?? setupErrorMessage(error);
  }
  return view;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Dependency injection keeps real lock adapters out of the Discord transport.
export function createWorker(locks: LockService = new MockLockService(), discordFetch: typeof fetch = fetch) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/" && request.method === "GET") {
        return homePage();
      }
      if (path === "/setup" && request.method === "GET") {
        return setupPage();
      }
      if (path === "/setup.js" && request.method === "GET") {
        return setupScript();
      }
      if (path === "/setup/discord" && request.method === "GET") {
        const endpointUrl = `${new URL(request.url).origin}/discord/interactions`;
        return discordSetupPage(endpointUrl, await getDiscordSetupView(env, discordFetch));
      }
      if (path === "/setup/discord/register" && request.method === "POST") {
        const origin = request.headers.get("Origin");
        if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden.", { status: 403 });
        const endpointUrl = `${new URL(request.url).origin}/discord/interactions`;
        let message: string | undefined;
        if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
          message = "Cloudflare SecretのDISCORD_CLIENT_IDとDISCORD_CLIENT_SECRETを先に設定してください。";
        } else {
          try {
            await registerCommandsWithClientCredentials({
              applicationId: env.DISCORD_CLIENT_ID,
              clientSecret: env.DISCORD_CLIENT_SECRET,
              fetcher: discordFetch,
            });
            message = "4コマンドをDiscordへ登録しました。";
          } catch (error) {
            const requestId = crypto.randomUUID();
            const code = error instanceof DiscordRegistrationError ? error.code : "unknown";
            console.error(JSON.stringify({ event: "discord_command_registration_failed", requestId, code }));
            message = setupErrorMessage(error);
          }
        }
        return discordSetupPage(endpointUrl, await getDiscordSetupView(env, discordFetch, message));
      }
      const interactionPath = path === "/interactions" || path === "/discord/interactions";
      if (!interactionPath) return json({ error: "Not found." }, 404);
      if (request.method !== "POST") {
        return new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } });
      }

      const requestId = crypto.randomUUID();
      if (!isPublicKey(env.DISCORD_PUBLIC_KEY)) {
        console.error(JSON.stringify({ event: "configuration_error", requestId }));
        return json({ error: "Service unavailable." }, 503);
      }

      try {
        const rawBody = await request.arrayBuffer();
        if (!await verifyDiscordRequest(rawBody, request.headers, env.DISCORD_PUBLIC_KEY)) {
          return json({ error: "Invalid request signature." }, 401);
        }

        let interaction: unknown;
        try {
          interaction = JSON.parse(new TextDecoder().decode(rawBody));
        } catch {
          return json({ error: "Invalid JSON." }, 400);
        }
        if (!isInteraction(interaction)) return json({ error: "Unsupported interaction." }, 400);

        try {
          return json(await handleInteraction(interaction, locks));
        } catch {
          // Do not log exceptions, payloads, headers, or tokens: adapters may include secrets.
          console.error(JSON.stringify({ event: "interaction_failed", requestId, interactionType: interaction.type }));
          return json(message(INTERNAL_ERROR));
        }
      } catch {
        console.error(JSON.stringify({ event: "request_failed", requestId }));
        return json({ error: INTERNAL_ERROR }, 500);
      }
    },
  };
}

export default createWorker();
