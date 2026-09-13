/** 验证截图标注的固定默认展示，不执行采集或剪贴板写入。 */
import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FocusOverlay } from "../src/renderer/focus-overlay.tsx";
test("截图默认展示标注，不显示颜色与透明度设置", () => {
  const html = renderToStaticMarkup(
    React.createElement(FocusOverlay, {
      screenshot: {
        data: "fixture",
        coordinateSpace: "screen_top_left_points",
        shadowsExcluded: true,
        frame: { x: 0, y: 0, width: 100, height: 100 },
        regions: {
          click: {
            status: "available",
            rect: { x: 5, y: 5, width: 20, height: 20 },
          },
        },
      },
      trigger: { kind: "click", x: 10, y: 10 },
    }),
  );
  expect(html).toContain('data-bbox="click"');
  expect(html).toContain("data-click-point");
  expect(html).toContain("点击放大截图");
  for (const name of [
    "显示 bbox",
    "填充强度",
    "焦点颜色",
    "选区颜色",
    "标注范围",
  ])
    expect(html).not.toContain(name);
  expect(html).toContain("标注说明");
});
