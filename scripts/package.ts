import { packager } from "@electron/packager";
// 独立bundle ID，默认不申请旧应用的任何权限。
const paths = await packager({
  dir: ".",
  out: "out",
  name: "Proactive Lab",
  appBundleId: "io.github.hedgeho9x.proactive-agent",
  platform: "darwin",
  arch: process.arch as "arm64" | "x64",
  overwrite: true,
  asar: false,
  prune: true,
  ignore: [
    /^\/\.git(?:\/|$)/,
    /^\/\.runtime(?:\/|$)/,
    /^\/out(?:\/|$)/,
    /^\/src(?:\/|$)/,
    /^\/tests(?:\/|$)/,
    /^\/scripts(?:\/|$)/,
    /^\/native(?:\/|$)/,
  ],
  extendInfo: {
    NSAppleEventsUsageDescription: "Proactive Lab 仅观察你选择的应用。",
  },
});
console.log(paths.join("\n"));
