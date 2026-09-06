import { build } from "esbuild";
await build({
  entryPoints: ["src/sidecar.ts"],
  outfile: "dist/sidecar.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
});
