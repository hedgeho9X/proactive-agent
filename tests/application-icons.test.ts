/** 应用图标入口只接受身份字符串，不允许渲染端指定任意文件。 */
import { test, expect } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationIcons } from "../src/desktop/application-icons.ts";
import { ApplicationIcon } from "../src/renderer/application-icon.tsx";

test("非法身份不启动采集器，图标缺失使用应用首字", async () => {
  const cache = new ApplicationIcons("/nonexistent-fixture");
  expect(await cache.get("/etc/passwd")).toBeNull();
  expect(await cache.get("$(echo bad)")).toBeNull();
  const first = cache.get("com.example.fixture");
  expect(cache.get("com.example.fixture")).toBe(first);
  expect(await first).toBeNull();
  expect(
    renderToStaticMarkup(
      React.createElement(ApplicationIcon, {
        name: "微信",
        bundleId: "com.tencent.xinWeChat",
      }),
    ),
  ).toContain("微");
});
