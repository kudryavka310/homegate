import {
  beginOAuth,
  clearInstallerCookies,
  completeOAuth,
  installWorker,
  installerErrorMessage,
  readInstallSession,
  type InstallerEnv,
  InstallerError,
} from "./installer/oauth";
import { accountSelectionPage, installCompletePage, installerErrorPage, installerPage } from "./web/installer-pages";

export interface Env extends InstallerEnv {}

function notFound(): Response {
  return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function createInstallerWorker(cloudflareFetch: typeof fetch = fetch) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if ((path === "/" || path === "/install") && request.method === "GET") {
        return installerPage(Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID && env.HOMEGATE_OAUTH_STATE_SECRET));
      }
      if (path === "/oauth/start" && request.method === "GET") {
        try {
          return await beginOAuth(request, env);
        } catch (error) {
          const installerError = error instanceof InstallerError ? error : new InstallerError("installer_not_configured", 503);
          return installerErrorPage(installerErrorMessage(installerError), installerError.status);
        }
      }
      if (path === "/oauth/callback" && request.method === "GET") {
        const result = await completeOAuth(request, env, cloudflareFetch);
        if ("error" in result) return installerErrorPage(installerErrorMessage(result.error), result.error.status);
        return result.redirect;
      }
      if (path === "/install/account" && request.method === "GET") {
        const session = await readInstallSession(request, env);
        if (!session) return Response.redirect(`${url.origin}/install`, 302);
        return accountSelectionPage(session.accounts, session.nonce);
      }
      if (path === "/install/account" && request.method === "POST") {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) return installerErrorPage("不正な送信元です。", 403);
        const session = await readInstallSession(request, env);
        if (!session) return installerErrorPage("Installerセッションの有効期限が切れました。最初からやり直してください。", 400);
        let form: FormData;
        try { form = await request.formData(); } catch { return installerErrorPage("入力を確認してください。", 400); }
        const accountId = form.get("account_id");
        const workerName = form.get("worker_name");
        const nonce = form.get("nonce");
        if (typeof accountId !== "string" || typeof workerName !== "string" || typeof nonce !== "string" || nonce !== session.nonce) {
          return accountSelectionPage(session.accounts, session.nonce, "入力を確認してください。");
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
      return notFound();
    },
  };
}

export default createInstallerWorker();
