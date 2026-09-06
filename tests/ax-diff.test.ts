import { test, expect } from "bun:test";
import { diffAX } from "../src/renderer/ax-diff.ts";

test("AX对比忽略临时编号并保留文本变化与读取错误", () => {
  const node = (id: string, value: any) => ({
    id,
    path: "window/0",
    attributes: {
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
  expect(diffAX(before, snapshot([]))[0].kind).toBe("消失或未采到");
});
