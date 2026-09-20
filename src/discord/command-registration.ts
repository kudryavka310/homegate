import { commands, type CommandDefinition } from "./commands";

const DISCORD_API = "https://discord.com/api/v10";
const CLIENT_CREDENTIALS_SCOPE = "applications.commands.update";

export type DiscordAuthScheme = "Bot" | "Bearer";

export type DiscordRegistrationErrorCode =
  | "invalid_input"
  | "missing_credentials"
  | "authentication_failed"
  | "rate_limited"
  | "discord_api_failed"
  | "network_error"
  | "invalid_response";

export class DiscordRegistrationError extends Error {
  constructor(
    readonly code: DiscordRegistrationErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = "DiscordRegistrationError";
  }
}

export interface DiscordRegistrationResult {
  commandNames: readonly string[];
}

export interface DiscordSetupSnapshot {
  commandNames: readonly string[];
}

type Requester = typeof fetch;

function validSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function authHeader(scheme: DiscordAuthScheme, token: string): string {
  return `${scheme} ${token}`;
}

function classifyStatus(status: number, authentication = false): DiscordRegistrationError {
  if (authentication || status === 401 || status === 403) {
    return new DiscordRegistrationError("authentication_failed", status);
  }
  if (status === 429) return new DiscordRegistrationError("rate_limited", status);
  return new DiscordRegistrationError("discord_api_failed", status);
}

async function request(fetcher: Requester, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch {
    throw new DiscordRegistrationError("network_error");
  }
}

async function json<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new DiscordRegistrationError("invalid_response", response.status);
  }
}

export async function getClientCredentialsToken(
  clientId: string,
  clientSecret: string,
  fetcher: Requester = fetch,
): Promise<string> {
  if (!validSnowflake(clientId) || clientSecret.length === 0 || clientSecret.length > 256) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const encoded = btoa(`${clientId}:${clientSecret}`);
  const response = await request(fetcher, `${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: CLIENT_CREDENTIALS_SCOPE,
    }),
  });
  if (!response.ok) throw classifyStatus(response.status, response.status === 400);
  const payload = await json<{ access_token?: unknown; token_type?: unknown }>(response);
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0
    || payload.token_type !== "Bearer") {
    throw new DiscordRegistrationError("invalid_response", response.status);
  }
  return payload.access_token;
}

export async function registerCommandsWithToken(options: {
  applicationId: string;
  accessToken: string;
  authScheme: DiscordAuthScheme;
  guildId?: string;
  fetcher?: Requester;
  definitions?: readonly CommandDefinition[];
}): Promise<DiscordRegistrationResult> {
  const { applicationId, accessToken, authScheme, guildId, definitions = commands } = options;
  if (!validSnowflake(applicationId) || !accessToken
    || (guildId !== undefined && !validSnowflake(guildId))) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const scope = guildId ? `/guilds/${guildId}` : "";
  const fetcher = options.fetcher ?? fetch;
  // Register each HomeGate command independently so unrelated commands on the
  // same Discord application are preserved.
  for (const definition of definitions) {
    const response = await request(fetcher,
      `${DISCORD_API}/applications/${applicationId}${scope}/commands`, {
        method: "POST",
        headers: {
          Authorization: authHeader(authScheme, accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(definition),
      });
    if (!response.ok) throw classifyStatus(response.status);
    const payload = await json<unknown>(response);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DiscordRegistrationError("invalid_response", response.status);
    }
  }
  return { commandNames: definitions.map((command) => command.name) };
}

export async function registerCommandsWithClientCredentials(options: {
  applicationId: string;
  clientSecret: string;
  fetcher?: Requester;
}): Promise<DiscordRegistrationResult> {
  const fetcher = options.fetcher ?? fetch;
  const token = await getClientCredentialsToken(options.applicationId, options.clientSecret, fetcher);
  return registerCommandsWithToken({
    applicationId: options.applicationId,
    accessToken: token,
    authScheme: "Bearer",
    fetcher,
  });
}

export async function inspectDiscordSetup(options: {
  applicationId: string;
  accessToken: string;
  fetcher?: Requester;
}): Promise<DiscordSetupSnapshot> {
  if (!validSnowflake(options.applicationId) || !options.accessToken) {
    throw new DiscordRegistrationError("invalid_input");
  }
  const fetcher = options.fetcher ?? fetch;
  const commandResponse = await request(fetcher,
    `${DISCORD_API}/applications/${options.applicationId}/commands`, {
      headers: { Authorization: authHeader("Bearer", options.accessToken) },
    });
  if (!commandResponse.ok) throw classifyStatus(commandResponse.status);
  const payload = await json<unknown>(commandResponse);
  if (!Array.isArray(payload) || payload.some((item) => typeof item !== "object" || item === null)) {
    throw new DiscordRegistrationError("invalid_response", commandResponse.status);
  }
  const commandNames = payload.flatMap((item) => {
    const name = (item as { name?: unknown }).name;
    return typeof name === "string" ? [name] : [];
  });
  return { commandNames };
}
