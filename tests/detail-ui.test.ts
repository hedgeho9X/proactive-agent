/** 验证详情首屏和固定截图标注，不读取真实历史或请求模型。 */
import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AITrace } from "../src/renderer/ai-trace.tsx";
import { AXRecordDetails } from "../src/renderer/ax-record-details.tsx";

test("理解摘要无需等追踪文件加载，且排在记录操作上方", () => {
  const html = renderToStaticMarkup(
    React.createElement(AXRecordDetails, {
      recordId: "fixture",
      recording: false,
      onRemoved() {},
      aiStatus: "delivered",
      summary: {
        action_title: "点击 Open",
        action_detail: "当前选中测试项目。",
      },
    }),
  );
  expect(html.indexOf("点击 Open")).toBeLessThan(html.indexOf("复制 ID"));
  expect(html).toContain("当前选中测试项目。");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("中文 Prompt");
});

test("等待和失败状态始终可见", () => {
  const queued = renderToStaticMarkup(
    React.createElement(AITrace, { id: "fixture", status: "queued" }),
  );
  expect(queued).toContain("等待 AI 理解");
  const failed = renderToStaticMarkup(
    React.createElement(AITrace, {
      id: "fixture",
      status: "failed",
      reason: "fixture_error",
    }),
  );
  expect(failed).toContain("fixture_error");
  expect(failed).toContain("重试处理");
});
