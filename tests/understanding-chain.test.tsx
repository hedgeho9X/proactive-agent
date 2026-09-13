/** 调用树投影回归：重复工具依靠调用 ID 配对，失败和未归属节点不丢失。 */
import { test, expect } from "bun:test";
import { understandingChain } from "../src/renderer/understanding-chain.tsx";

test("重复工具正确归属轮次并保留错误、输入和投递阻塞", () => {
  const nodes = understandingChain({
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
  expect(nodes.find((n) => n.id === "tool-a")?.output).toEqual(["first"]);
  expect(nodes.find((n) => n.id === "tool-b")?.meta.error).toBe(
    "action_missing",
  );
  expect(nodes.find((n) => n.id === "unlinked-2")?.depth).toBe(0);
  expect(nodes.at(-1)?.meta.waitingFor).toEqual({ actionId: "earlier" });
});
