/** 验证精简仅作用于模型证据，不破坏原始 AX 或编辑正文。 */
import { test, expect } from "bun:test";
import { projectVisualEvidence } from "../src/model/understanding-evidence.ts";
import { projectUnderstanding } from "../src/model/understanding.ts";
import { buildUserPrompt } from "../prompts/understanding.ts";
import { resolveAppInfo } from "../src/model/app-info.ts";

test("空结构节点删除，title/description 去重，正文独立且不重复", () => {
  const ax = {
    nodes: [
      { node_id: "0", role: "AXGroup", title: "", value: "unrelated-value" },
      { node_id: "1", title: "页面", description: "内容" },
      { node_id: "2", title: "页面", description: "内容", parent_id: "0" },
      {
        node_id: "3",
        title: "输入",
        value: "完整草稿",
        role: "AXTextArea",
        focused: true,
      },
      { node_id: "4", title: "秘密", protected: true },
    ],
    editing_evidence: {
      text: "完整草稿",
      source: "AXValue",
      observedAt: "then",
      pid: 42,
    },
  };
  const original = JSON.stringify(ax);
  const value = projectVisualEvidence(ax, {}, null);
  expect(value.axContext.nodes).toEqual([
    { title: "页面", description: "内容" },
    { title: "输入" },
  ]);
  expect(value.focusedElement.prior_editing_observation?.text).toBe("完整草稿");
  expect(value.focusedElement.current_input).toBeUndefined();
  expect(JSON.stringify(value).match(/完整草稿/g)).toHaveLength(1);
  expect(JSON.stringify(value)).not.toContain("unrelated-value");
  expect(JSON.stringify(ax)).toBe(original);
});

test("没有草稿仍保留当前编辑器正文，不把前后不同内容误去重", () => {
  const nodes = [{ role: "AXTextArea", focused: true, value: "现在" }];
  expect(
    projectVisualEvidence({ nodes }, {}, null).focusedElement.current_input
      ?.text,
  ).toBe("现在");
  const value = projectVisualEvidence(
    { nodes, editing_evidence: { text: "之前" } },
    {},
    null,
  );
  expect(value.focusedElement.current_input?.text).toBe("现在");
  expect(value.focusedElement.prior_editing_observation?.text).toBe("之前");
});

test("历史 OCR 不能进入新 Prompt，原始对象不受影响", () => {
  const input: any = {
    action: { action_id: "fixture" },
    revision: 1,
    view: "raw",
    evidence: [{ kind: "ocr" }],
    artifacts: { ocr: { payload: { content: { text: "OCR-noise" } } } },
  };
  const projected = projectUnderstanding(input);
  expect(projected.artifacts.ocr).toBeUndefined();
  expect(projected.evidence).toEqual([]);
  expect(input.artifacts.ocr).toBeDefined();
  const prompt = buildUserPrompt({
    action: {},
    app_info: resolveAppInfo({}),
    evidence: [],
    axTree: null,
    focusTitle: null,
    ocr: { text: "OCR-noise" },
    screenshot: null,
    view: "raw",
  });
  expect(prompt).not.toContain("OCR-noise");
  expect(prompt).not.toContain("<ocr>");
});
