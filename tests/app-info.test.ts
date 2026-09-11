/** 验证应用背景匹配、未知身份和请求快照隔离，不访问应用用户数据。 */
import { expect, test } from "bun:test";
import { resolveAppInfo } from "../src/model/app-info.ts";

test("按 Bundle ID 查应用，不用显示名称覆盖应用身份", () => {
  const info = resolveAppInfo({
    bundle_id: "com.tencent.xinWeChat",
    name: "WeChat",
  });
  expect(info.source).toBe("local_registry");
  expect(info.observed_name).toBe("WeChat");
  expect(info.definition?.display_name).toBe("微信");
  expect(info.definition?.common_features).toContain("文件传输");
});

test("未知应用、名称伪装和通用 Electron ID 不猜用途", () => {
  for (const bundle_id of [
    undefined,
    "unknown.app",
    "com.github.Electron",
    "toString",
    "__proto__",
  ])
    expect(resolveAppInfo({ bundle_id, name: "微信" })).toMatchObject({
      source: "unknown",
      definition: null,
    });
  expect(resolveAppInfo().bundle_id).toBeNull();
});

test("返回独立快照，调用方不能通过结果污染全局知识表", () => {
  const app = { bundle_id: "dev.zed.Zed", name: "Zed" };
  const info = resolveAppInfo(app);
  info.definition!.display_name = "changed";
  (info.definition!.common_features as string[]).push("invented");
  expect(resolveAppInfo(app).definition?.display_name).toBe("Zed");
  expect(resolveAppInfo(app).definition?.common_features).not.toContain(
    "invented",
  );
});
