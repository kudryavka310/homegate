import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const installer = await readFile(path.join(root, "dist", "installer.js"), "utf8");
const homegate = await readFile(path.join(root, "dist", "homegate.js"), "utf8");

const forbiddenInRuntime = [
  "dash.cloudflare.com/oauth2/auth",
  "dash.cloudflare.com/oauth2/token",
  "api.cloudflare.com/client/v4",
  "/oauth/start",
  "/oauth/callback",
  "/install/account",
  "CLOUDFLARE_OAUTH_CLIENT_ID",
  "HOMEGATE_OAUTH_STATE_SECRET",
  "HOMEGATE_BUNDLE_URL",
  "workers/subdomain",
];
const missingInRuntime = forbiddenInRuntime.filter((value) => homegate.includes(value));
if (missingInRuntime.length > 0) {
  throw new Error(`Installer strings leaked into dist/homegate.js: ${missingInRuntime.join(", ")}`);
}

const requiredInInstaller = [
  "/oauth/start",
  "/oauth/callback",
  "/install/account",
  "dash.cloudflare.com/oauth2/auth",
  "api.cloudflare.com/client/v4",
  "/workers/scripts/",
];
const missingInInstaller = requiredInInstaller.filter((value) => !installer.includes(value));
if (missingInInstaller.length > 0) {
  throw new Error(`Installer strings missing from dist/installer.js: ${missingInInstaller.join(", ")}`);
}

console.log("Bundle separation verified: dist/homegate.js contains no Cloudflare Installer strings.");
