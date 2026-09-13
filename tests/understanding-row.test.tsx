/** 验证列表正文分行和费用未知态，不将缺失价格当作零费用。 */
import { test, expect } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  UnderstandingText,
  understandingCost,
} from "../src/renderer/understanding-row.tsx";

test("标题和细节分别展示，保留未知费用和真实零费用的区别", () => {
  const html = renderToStaticMarkup(
    <UnderstandingText title="查看论文" detail="比较两种记忆检索方法" />,
  );
  expect(html).toContain("flex-col");
  expect(html).not.toContain("<li");
  expect(html).toContain("比较两种记忆检索方法");
  expect(understandingCost({ totalTokens: 1200, elapsedMs: 2345 })).toBe(
    "费用未提供 · 1,200 tokens · 2.3s",
  );
  expect(understandingCost({ costUSD: 0 })).toBe("$0.0000");
});
