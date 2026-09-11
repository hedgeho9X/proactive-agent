/** 验证应用背景匹配、未知身份和请求快照隔离，不访问应用用户数据。 */
import { expect, test } from "bun:test";
import { appInfoMap, resolveAppInfo } from "../src/model/app-info.ts";
import { inputManifest } from "../src/model/understanding.ts";

test("修改应用知识改变未来缓存键，不改写已经取得的背景快照", () => {
  const app = { bundle_id: "dev.zed.Zed", name: "Zed" };
  const input = {
    action: { app },
    evidence: [],
    artifacts: {},
    view: "raw" as const,
    revision: 1,
  };
  const before = inputManifest(input, "fixture");
  const snapshot = resolveAppInfo(app);
  const definition = appInfoMap[app.bundle_id];
  const purpose = definition.purpose;
  try {
    definition.purpose = "不同的测试用途";
    expect(inputManifest(input, "fixture").hash).not.toBe(before.hash);
    expect(snapshot.definition?.purpose).toBe(purpose);
  } finally {
    definition.purpose = purpose;
  }
});
import { buildUserPrompt } from "../prompts/main.ts";

test("主 Agent 应用背景按动作关联、同应用去重、旧记录不补造背景", () => {
  const zed = resolveAppInfo({ bundle_id: "dev.zed.Zed" });
  const browser = resolveAppInfo({ bundle_id: "com.brave.Browser" });
  const text = buildUserPrompt({
    trajectory: ["轨迹"],
    app_info: [
      { action_id: "a1", info: zed },
      { action_id: "a2", info: browser },
      { action_id: "a3", info: zed },
      { action_id: "old", info: null },
    ],
  });
  const groups = JSON.parse(
    text.split("## 本批应用背景 app_info\n")[1].split("\n以上每组")[0],
  );
  expect(groups).toHaveLength(3);
  expect(groups[0].action_ids).toEqual(["a1", "a3"]);
  expect(groups[1].app_info.definition.category).toBe("browser");
  expect(groups[2]).toEqual({ action_ids: ["old"], app_info: null });
});

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
