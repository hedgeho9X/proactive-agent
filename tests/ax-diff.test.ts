import { test, expect } from "bun:test";
import { diffAX, alignDiffLines } from "../src/renderer/ax-diff.ts";

test("Git式对齐保留插入行之后的相同行", () => {
  const rows = alignDiffLines(["a", "c"], ["a", "b", "c"]);
  expect(rows[1]).toMatchObject({ left: undefined, right: "b", rightLine: 2 });
  expect(rows[2]).toEqual({ left: "c", right: "c", leftLine: 2, rightLine: 3 });
});

test("AX对比忽略临时编号并保留文本变化与读取错误", () => {
  const node = (id: string, value: any) => ({
    id,
    path: "window/0",
    attributes: {
      AXIdentifier: { status: "ok", value: { text: "fixture-input" } },
      AXRole: { status: "ok", value: { text: "AXTextField" } },
      AXValue: value,
    },
  });
  const snapshot = (nodes: any[], pid = 1) => ({
    pid,
    bundleId: "fixture",
    nodes,
  });
  const before = snapshot([
    node("n1", { status: "ok", value: { text: "中文" } }),
  ]);
  expect(
    diffAX(
      before,
      snapshot([node("n99", { status: "ok", value: { text: "中文" } })]),
    ),
  ).toEqual([]);
  expect(
    diffAX(
      before,
      snapshot([node("n99", { status: "ok", value: { text: "中文输入" } })]),
    )[0].attribute,
  ).toBe("AXValue");
  expect(
    diffAX(
      before,
      snapshot([node("n99", { status: "error", code: -25204 })]),
    )[0].after.status,
  ).toBe("error");
  expect(diffAX(before, snapshot([], 2))).toEqual([]);
  expect(
    diffAX(
      before,
      snapshot([node("new", { value: { text: "中文" }, status: "ok" })]),
    ),
  ).toEqual([]);
  expect(diffAX(before, snapshot([]))[0].kind).toBe("仅左侧观察到（未匹配）");
});

test("路径移动和焦点编号变化不造成误配，重复无标识控件不按顺序匹配", () => {
  const n = (id: string, path: string, identifier: string, value: string) => ({
    id,
    path,
    attributes: {
      AXRole: { status: "ok", value: { text: "AXTextField" } },
      AXIdentifier: { status: "ok", value: { text: identifier } },
      AXValue: { status: "ok", value: { text: value } },
    },
  });
  const s = (nodes: any[], windowId = 1) => ({
    pid: 1,
    bundleId: "fixture",
    windowId,
    nodes,
  });
  const a = s([n("old", "focus", "a", "A"), n("old2", "window/1", "b", "B")]);
  const b = s([
    n("new2", "window/0", "b", "B"),
    n("new", "window/9", "a", "C"),
  ]);
  expect(diffAX(a, b)).toHaveLength(1);
  expect(diffAX(a, b)[0]).toMatchObject({
    attribute: "AXValue",
    beforeNode: "old",
    node: "new",
  });
  expect(diffAX(a, s(b.nodes, 2))).toEqual([]);
  const ambiguous = diffAX(
    s([n("1", "window/0", "", "A"), n("2", "window/1", "", "B")]),
    s([n("3", "window/0", "", "C"), n("4", "window/1", "", "D")]),
  );
  expect(ambiguous.every((row) => row.uncertain && !row.attribute)).toBe(true);
});
