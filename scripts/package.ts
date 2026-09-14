import { packager } from "@electron/packager";
// 独立bundle ID，默认不申请旧应用的任何权限。
const paths = await packager({
  dir: ".",
  out: "out",
  name: "Proactive Agent",
  appBundleId: "io.github.hedgeho9x.proactive-agent",
  platform: "darwin",
  arch: process.arch as "arm64" | "x64",
  // 可显式复用已下载的同版本 Electron，避免重复联网。
  electronZipDir: process.env.PROACTIVE_ELECTRON_ZIP_DIR,
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
    NSAppleEventsUsageDescription: "Proactive Agent 仅观察你选择的应用。",
  },
});
console.log(paths.join("\n"));
