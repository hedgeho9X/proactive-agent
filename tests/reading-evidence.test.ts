/** 阅读证据投影回归：选中文本不再依赖可编辑角色，不补造上下文或匹配时刻。 */
import { test, expect } from "bun:test";
import { readingEvidence } from "../src/model/reading-evidence.ts";
import { axObservation } from "../src/observation/ax-agent-bridge.ts";
import { projectVisualEvidence } from "../src/model/understanding-evidence.ts";

/** 合成只读阅读区，焦点角色不是输入框。 */
function oldSnapshot() {
  return {
    snapshotId: "fixture",
    pid: 1,
    focusId: "group",
    nodes: [
      {
        id: "group",
        parent: "web",
        attributes: {
          AXRole: { status: "ok", value: { text: "AXGroup" } },
          AXSelectedText: {
            status: "ok",
            value: {
              text: "只更新第二条建议，不改变其他建议。",
              truncated: false,
            },
          },
          AXSelectedTextRange: {
            status: "ok",
            value: { location: 50, length: 18 },
          },
        },
      },
    ],
    screenshot: {
      status: "captured",
      data: "fixture",
      regions: {
        selection: { status: "unavailable", reason: "selection_changed" },
      },
    },
    timing: { axStartedAt: "start", axCompletedAt: "end" },
  };
}

test("旧记录的 AXGroup 选中文字可恢复，选区框失效不伪造同步也不抹掉文字", () => {
  const snapshot = oldSnapshot(),
    before = JSON.stringify(snapshot);
  const item = axObservation(snapshot);
  const context = projectVisualEvidence(
    item.artifacts.ax?.payload.content,
    item.artifacts.screenshot?.payload.content,
    null,
  ).readingContext;
  expect(context).toMatchObject({
    status: "partial",
    selectedText: {
      source: "AXSelectedText",
      text: "只更新第二条建议，不改变其他建议。",
      imageAlignment: "not_verified",
      alignmentReason: "selection_changed",
      capturedBetween: { from: "start", to: "end" },
    },
  });
  expect(context).not.toHaveProperty("context");
  expect(JSON.stringify(snapshot)).toBe(before);
});

test("新定向正文保留范围和截断，片段正文不重复注入", () => {
  const readingContext = {
    status: "partial",
    selectedText: { text: "第二条", source: "AXSelectedText" },
    context: {
      text: "相关段落的原文内容",
      source: "AXRelatedSubtree",
      scope: "related_subtree",
      truncated: true,
      reason: "text_budget",
      visibility: "not_verified",
      fragments: [
        { nodeId: "reading:1", source: "AXValue", text: "相关段落的原文内容" },
      ],
    },
  };
  const item = axObservation({
    snapshotId: "fixture",
    nodes: [],
    readingContext,
    screenshot: { status: "captured", data: "fixture" },
  });
  const value = readingEvidence(item.artifacts.ax?.payload.content, {});
  expect(value).toMatchObject({
    context: {
      scope: "related_subtree",
      truncated: true,
      visibility: "not_verified",
    },
  });
  expect(JSON.stringify(value).match(/相关段落的原文内容/g)).toHaveLength(1);
});

test("排除或窗口错配不可从旧节点重新暴露选中文字", () => {
  const item = axObservation(oldSnapshot());
  expect(
    readingEvidence(
      {
        ...item.artifacts.ax?.payload.content,
        reading_context: {
          status: "unavailable",
          discarded: true,
          reason: "window_mismatch",
        },
      },
      {},
    ),
  ).toEqual({
    status: "unavailable",
    discarded: true,
    reason: "window_mismatch",
  });
  expect(
    readingEvidence(
      {
        ...item.artifacts.ax?.payload.content,
        reading_context: { status: "excluded" },
      },
      {},
    ),
  ).toEqual({ status: "excluded", reason: undefined });
  expect(
    readingEvidence(
      {
        ...item.artifacts.ax?.payload.content,
        coverage: {
          diagnostics: { warnings: ["ax_window_mismatch_discarded"] },
        },
      },
      {},
    ),
  ).toMatchObject({ status: "unavailable" });
  const snapshot = oldSnapshot();
  (snapshot.nodes[0] as any).protected = true;
  expect(axObservation(snapshot).artifacts.ax).toBeNull();
});

test("截图 probe 使用自己的采样时刻，原文片段保留 UTF16 定位", () => {
  const snapshot = oldSnapshot();
  Object.assign(snapshot.nodes[0]!, { source: "screenshot_region_probe" });
  Object.assign(snapshot.screenshot.regions.selection, {
    nodeId: "group",
    sampledAt: "probe-later",
  });
  const item = axObservation(snapshot);
  const value = readingEvidence(
    item.artifacts.ax?.payload.content,
    item.artifacts.screenshot?.payload.content,
  );
  expect(value).toMatchObject({
    selectedText: {
      sampledAt: "probe-later",
      timeBasis: "screenshot_region_probe",
    },
  });
  expect(value.selectedText).toMatchObject({ capturedBetween: undefined });
  const reading = readingEvidence(
    {
      reading_context: {
        status: "available",
        sampledAt: "start",
        completedAt: "end",
        nonAtomic: true,
        context: {
          text: "原文",
          fragments: [
            { nodeId: "reading:0", start: 0, length: 2, unit: "utf16" },
          ],
        },
      },
    },
    {},
  );
  expect(reading).toMatchObject({
    sampledAt: "start",
    completedAt: "end",
    nonAtomic: true,
    context: {
      fragments: [{ nodeId: "reading:0", start: 0, length: 2, unit: "utf16" }],
    },
  });
});

test("只有插入光标时不恢复过期的 selectedText", () => {
  const snapshot = oldSnapshot();
  snapshot.nodes[0]!.attributes.AXSelectedTextRange.value.length = 0;
  snapshot.nodes.push({
    ...snapshot.nodes[0]!,
    id: "web",
    parent: "",
    attributes: {
      ...snapshot.nodes[0]!.attributes,
      AXSelectedTextRange: { status: "ok", value: { location: 1, length: 18 } },
    },
  });
  const item = axObservation(snapshot);
  expect(
    readingEvidence(item.artifacts.ax?.payload.content, {}).selectedText,
  ).toBeUndefined();
});
