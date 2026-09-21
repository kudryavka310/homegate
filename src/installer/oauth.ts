export const CLOUDFLARE_AUTH_ENDPOINT = "https://dash.cloudflare.com/oauth2/auth";
export const CLOUDFLARE_TOKEN_ENDPOINT = "https://dash.cloudflare.com/oauth2/token";
export const CLOUDFLARE_API_ENDPOINT = "https://api.cloudflare.com/client/v4";
export const INSTALLER_SCOPES = ["account.read", "workers-platform.read", "workers-platform.write"] as const;
export const OAUTH_STATE_COOKIE = "__Host-homegate_oauth";
export const INSTALL_SESSION_COOKIE = "__Host-homegate_install";
const SESSION_TTL_SECONDS = 600;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export interface InstallerEnv {
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  HOMEGATE_OAUTH_STATE_SECRET?: string;
  HOMEGATE_BUNDLE_URL?: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface InstallSession {
  accessToken: string;
  accounts: CloudflareAccount[];
  nonce: string;
  expiresAt: number;
}

export class InstallerError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = "InstallerError";
  }
}

type Requester = typeof fetch;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function randomHex(byteLength = 6): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  return { verifier, challenge: encodeBase64Url(await sha256(verifier)) };
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new InstallerError("installer_not_configured", 503);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value: unknown, secret: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), plaintext));
  const joined = new Uint8Array(iv.length + ciphertext.length);
  joined.set(iv);
  joined.set(ciphertext, iv.length);
  return encodeBase64Url(joined);
}

async function open<T>(value: string, secret: string): Promise<T | null> {
  try {
    const joined = decodeBase64Url(value);
    if (joined.length <= 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: joined.slice(0, 12) },
      await encryptionKey(secret),
      joined.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearInstallerCookies(): string[] {
  return [cookie(OAUTH_STATE_COOKIE, "", 0), cookie(INSTALL_SESSION_COOKIE, "", 0)];
}

function validateClientId(clientId: string | undefined): string {
  if (!clientId || clientId.length > 256) throw new InstallerError("installer_not_configured", 503);
  return clientId;
}

function validateStateSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new InstallerError("installer_not_configured", 503);
  return secret;
}

export async function beginOAuth(request: Request, env: InstallerEnv): Promise<Response> {
  const clientId = validateClientId(env.CLOUDFLARE_OAUTH_CLIENT_ID);
  const secret = validateStateSecret(env.HOMEGATE_OAUTH_STATE_SECRET);
  const { verifier, challenge } = await createPkcePair();
  const state = randomToken(32);
  const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
  const payload = { state, verifier, redirectUri, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: INSTALLER_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${CLOUDFLARE_AUTH_ENDPOINT}?${params.toString()}`,
      "Set-Cookie": cookie(OAUTH_STATE_COOKIE, await seal(payload, secret), SESSION_TTL_SECONDS),
      "Cache-Control": "no-store",
    },
  });
}

async function request(fetcher: Requester, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch {
    throw new InstallerError("cloudflare_network_error", 502);
  }
}

async function exchangeCode(code: string, clientId: string, redirectUri: string, verifier: string, fetcher: Requester): Promise<string> {
  const response = await request(fetcher, CLOUDFLARE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  if (!response.ok) throw new InstallerError("oauth_exchange_failed", 502);
  let body: unknown;
  try { body = await response.json(); } catch { throw new InstallerError("oauth_exchange_failed", 502); }
  const token = body && typeof body === "object" && typeof (body as { access_token?: unknown }).access_token === "string"
    ? (body as { access_token: string }).access_token : undefined;
  if (!token || token.length < 10) throw new InstallerError("oauth_exchange_failed", 502);
  return token;
}

async function cloudflareJson<T>(token: string, path: string, init: RequestInit, fetcher: Requester): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await request(fetcher, `${CLOUDFLARE_API_ENDPOINT}${path}`, {
    ...init,
    headers,
  });
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) throw new InstallerError(response.status === 403 ? "cloudflare_permission_denied" : "cloudflare_api_error", response.status >= 400 ? response.status : 502);
  if (!body || typeof body !== "object" || (body as { success?: unknown }).success === false) throw new InstallerError("cloudflare_api_error", 502);
  return body as T;
}

export async function listAccounts(token: string, fetcher: Requester = fetch): Promise<CloudflareAccount[]> {
  const body = await cloudflareJson<{ result?: unknown }>(token, "/accounts?per_page=50", {}, fetcher);
  if (!Array.isArray(body.result)) throw new InstallerError("cloudflare_api_error", 502);
  const accounts: CloudflareAccount[] = [];
  for (const item of body.result) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    const name = (item as { name?: unknown }).name;
    if (typeof id === "string" && /^[a-f0-9]{32}$/i.test(id) && typeof name === "string" && name.length <= 100) accounts.push({ id, name });
  }
  if (accounts.length === 0) throw new InstallerError("no_cloudflare_accounts", 403);
  return accounts;
}

export async function completeOAuth(request: Request, env: InstallerEnv, fetcher: Requester = fetch): Promise<{ redirect: Response } | { error: InstallerError }> {
  try {
    const secret = validateStateSecret(env.HOMEGATE_OAUTH_STATE_SECRET);
    const clientId = validateClientId(env.CLOUDFLARE_OAUTH_CLIENT_ID);
    const url = new URL(request.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) return { error: new InstallerError("oauth_cancelled", 400) };
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const sealedState = cookieValue(request, OAUTH_STATE_COOKIE);
    if (!code || !state || !sealedState) return { error: new InstallerError("oauth_state_invalid", 400) };
    const statePayload = await open<{ state?: unknown; verifier?: unknown; redirectUri?: unknown; expiresAt?: unknown }>(sealedState, secret);
    const expectedRedirectUri = `${url.origin}/oauth/callback`;
    if (!statePayload || statePayload.state !== state || statePayload.redirectUri !== expectedRedirectUri
      || typeof statePayload.verifier !== "string" || typeof statePayload.redirectUri !== "string"
      || typeof statePayload.expiresAt !== "number" || statePayload.expiresAt < Date.now()) return { error: new InstallerError("oauth_state_invalid", 400) };
    const accessToken = await exchangeCode(code, clientId, statePayload.redirectUri, statePayload.verifier, fetcher);
    const accounts = await listAccounts(accessToken, fetcher);
    const session: InstallSession = { accessToken, accounts, nonce: randomToken(24), expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: `${new URL(request.url).origin}/install/account`,
        "Set-Cookie": cookie(INSTALL_SESSION_COOKIE, await seal(session, secret), SESSION_TTL_SECONDS),
        "Cache-Control": "no-store",
      },
    });
    response.headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
    return { redirect: response };
  } catch (error) {
    return { error: error instanceof InstallerError ? error : new InstallerError("oauth_failed", 502) };
  }
}

export async function readInstallSession(request: Request, env: InstallerEnv): Promise<InstallSession | null> {
  if (!env.HOMEGATE_OAUTH_STATE_SECRET) return null;
  const value = cookieValue(request, INSTALL_SESSION_COOKIE);
  if (!value) return null;
  const session = await open<InstallSession>(value, env.HOMEGATE_OAUTH_STATE_SECRET);
  if (!session || typeof session.accessToken !== "string" || !Array.isArray(session.accounts) || typeof session.nonce !== "string"
    || typeof session.expiresAt !== "number" || session.expiresAt < Date.now()) return null;
  return session;
}

function validWorkerName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

async function workerExists(token: string, accountId: string, workerName: string, fetcher: Requester): Promise<boolean> {
  const response = await request(fetcher, `${CLOUDFLARE_API_ENDPOINT}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new InstallerError(response.status === 403 ? "cloudflare_permission_denied" : "cloudflare_api_error", response.status);
}

async function fetchBundle(env: InstallerEnv, fetcher: Requester): Promise<string> {
  if (!env.HOMEGATE_BUNDLE_URL) throw new InstallerError("bundle_not_configured", 503);
  let url: URL;
  try { url = new URL(env.HOMEGATE_BUNDLE_URL); } catch { throw new InstallerError("bundle_not_configured", 503); }
  if (url.protocol !== "https:") throw new InstallerError("bundle_not_configured", 503);
  const response = await request(fetcher, url, { headers: { Accept: "application/javascript, text/javascript" } });
  if (!response.ok) throw new InstallerError("bundle_unavailable", 502);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BUNDLE_BYTES) throw new InstallerError("bundle_invalid", 502);
  return new TextDecoder().decode(bytes);
}

async function uploadWorker(token: string, accountId: string, workerName: string, bundle: string, fetcher: Requester): Promise<void> {
  const metadata = { main_module: "index.js", compatibility_date: "2026-09-20", bindings: [] };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("index.js", new Blob([bundle], { type: "application/javascript" }), "index.js");
  const response = await request(fetcher, `${CLOUDFLARE_API_ENDPOINT}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "If-None-Match": "*" },
    body: form,
  });
  if (!response.ok) throw new InstallerError(response.status === 409 ? "worker_name_taken" : response.status === 403 ? "cloudflare_permission_denied" : "worker_upload_failed", response.status);
}

async function enableWorkersDev(token: string, accountId: string, workerName: string, fetcher: Requester): Promise<void> {
  await cloudflareJson(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  }, fetcher);
}

async function accountSubdomain(token: string, accountId: string, fetcher: Requester): Promise<string> {
  const path = `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
  try {
    const body = await cloudflareJson<{ result?: { subdomain?: unknown } }>(token, path, {}, fetcher);
    if (!body.result || typeof body.result.subdomain !== "string" || !/^[a-z0-9-]+$/.test(body.result.subdomain)) throw new InstallerError("workers_dev_unavailable", 502);
    return body.result.subdomain;
  } catch (error) {
    if (!(error instanceof InstallerError) || error.status !== 404) throw error;
    const candidate = `homegate-${randomHex()}`;
    const created = await cloudflareJson<{ result?: { subdomain?: unknown } }>(token, path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain: candidate }),
    }, fetcher);
    if (!created.result || typeof created.result.subdomain !== "string" || !/^[a-z0-9-]+$/.test(created.result.subdomain)) {
      throw new InstallerError("workers_dev_unavailable", 502);
    }
    return created.result.subdomain;
  }
}

export async function installWorker(options: {
  session: InstallSession;
  accountId: string;
  workerName: string;
  env: InstallerEnv;
  fetcher?: Requester;
}): Promise<{ workerName: string; url: string }> {
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

export function installerErrorMessage(error: InstallerError): string {
  switch (error.code) {
    case "installer_not_configured": return "InstallerのOAuth設定がまだ完了していません。運営者に連絡してください。";
    case "oauth_cancelled": return "Cloudflareへの接続がキャンセルされました。";
    case "oauth_state_invalid": return "OAuthセッションの有効期限が切れたか、無効になっています。最初からやり直してください。";
    case "cloudflare_permission_denied": return "選択したAccountへのWorker作成権限がありません。Cloudflareの権限を確認してください。";
    case "no_cloudflare_accounts": return "利用可能なCloudflare Accountがありません。";
    case "worker_name_taken": return "同名のWorkerが存在します。別のWorker名を指定してください。";
    case "worker_name_invalid": return "Worker名は英小文字、数字、ハイフンで1〜63文字にしてください。";
    case "account_invalid": return "Cloudflare Accountの選択を確認してください。";
    case "bundle_not_configured": return "HomeGate Worker bundleの配布設定がまだ完了していません。";
    case "bundle_unavailable":
    case "bundle_invalid": return "HomeGate Worker bundleを取得できませんでした。時間を置いて再試行してください。";
    case "workers_dev_unavailable": return "Workerは作成されましたが、workers.dev URLを取得できませんでした。Cloudflare Dashboardで確認してください。";
    default: return "HomeGateを作成できませんでした。時間を置いて再試行してください。";
  }
}
