import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { mkdir, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
if (process.platform === "darwin")
  execFileSync("swift", ["build", "--package-path", "native/collector"], {
    stdio: "inherit",
  });
await mkdir("dist/renderer", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/sidecar.ts"],
    outfile: "dist/sidecar.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node22",
  }),
  build({
    entryPoints: ["src/desktop/main.ts"],
    outfile: "dist/desktop/main.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node24",
  }),
  build({
    entryPoints: ["src/desktop/preload.ts"],
    outfile: "dist/desktop/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    target: "node24",
  }),
  build({
    entryPoints: ["src/renderer/app.tsx"],
    outfile: "dist/renderer/app.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    loader: { ".css": "css" },
  }),
]);
await copyFile("src/renderer/index.html", "dist/renderer/index.html");

if (existsSync("native/collector/.build/debug/ProactiveCollector")) {
  await mkdir("dist/native", { recursive: true });
  await copyFile(
    "native/collector/.build/debug/ProactiveCollector",
    "dist/native/ProactiveCollector",
  );
  await chmod("dist/native/ProactiveCollector", 0o755);
}
