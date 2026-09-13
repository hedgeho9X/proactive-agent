/** 调用树投影回归：重复工具依靠调用 ID 配对，失败和未归属节点不丢失。 */
import { test, expect } from "bun:test";
import { traceSpans } from "../src/renderer/trace-model.ts";

test("重复工具正确归属轮次并保留错误、输入和投递阻塞", () => {
  const nodes = traceSpans({
    steps: [
      {
        step: 1,
        toolCalls: [
          { toolCallId: "a", toolName: "list_actions", input: { limit: 10 } },
        ],
      },
      {
        step: 2,
        toolCalls: [
          { toolCallId: "b", toolName: "list_actions", input: { limit: 20 } },
        ],
      },
    ],
    toolCalls: [
      { toolCallId: "a", name: "list_actions", result: ["first"] },
      {
        toolCallId: "b",
        name: "list_actions",
        status: "failed",
        error: "action_missing",
      },
      { name: "legacy", result: "unknown parent" },
    ],
    delivery: { status: "ready", waitingFor: { actionId: "earlier" } },
  });
  expect(nodes.find((n) => n.id === "tool-0")?.output).toEqual(["first"]);
  expect(nodes.find((n) => n.id === "tool-1")?.error).toBe("action_missing");
  expect(nodes.find((n) => n.id === "tool-2")?.parentId).toBe("run");
  expect(nodes.find((n) => n.id === "tool-0")?.parentId).toBe("turn-1");
  expect(nodes.find((n) => n.id === "tool-1")?.parentId).toBe("turn-2");
  expect(nodes.some((n) => n.name.includes("context"))).toBe(false);
});

test("进行中的工具使用已记录轮次挂到 turn，不等待模型结束才归属", () => {
  const spans = traceSpans({
    status: "running",
    steps: [{ step: 1, status: "running" }],
    toolCalls: [
      { name: "get_action_ax", step: 1, status: "running", elapsedMs: 0 },
    ],
  });
  expect(spans.at(-1)?.parentId).toBe("turn-1");
  expect(spans.at(-1)?.elapsedMs).toBeUndefined();
});
