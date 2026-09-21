import { build } from "esbuild";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const entries = [
  ["installer", "src/installer-entry.ts"],
  ["homegate", "src/homegate-entry.ts"],
];

for (const [name, entry] of entries) {
  const output = path.join(dist, `${name}.js`);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const { size } = await stat(output);
  console.log(`dist/${name}.js (${size} bytes)`);
}

const releaseDir = path.join(root, "releases", "0.1.0");
await mkdir(releaseDir, { recursive: true });
await rm(path.join(releaseDir, "index.js"), { force: true });
await copyFile(path.join(dist, "homegate.js"), path.join(releaseDir, "homegate.js"));
console.log("releases/0.1.0/homegate.js updated from dist/homegate.js");
