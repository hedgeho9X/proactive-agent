import { expect, test } from "bun:test";
import {
  concise,
  hierarchy,
  preciseTime,
  projectEvents,
  toolOutcome,
} from "../src/renderer/projection.ts";
const event = (
  type: string,
  data: unknown,
  seq: number,
  sessionId = "proactive-main",
) => ({
  kind: "session.event",
  sessionId,
  event: { type, data, seq, time: 1700000000000 + seq },
});
test("工具意图和结果独立，target不会遮盖not_executed，错误保持失败", () => {
  const rows = projectEvents([
    event(
      "tool/call",
      {
        callId: "one",
        name: "calendar_update",
        arguments: '{"target":"Friday"}',
      },
      1,
    ),
    event(
      "tool/result",
      {
        message: {
          source: { callId: "one" },
          content: [
            {
              type: "tool-result",
              content: [
                {
                  type: "text",
                  text: '{"target":"Friday","status":"not_executed"}',
                },
              ],
            },
          ],
        },
      },
      2,
    ),
    event("tool/call", { callId: "two", name: "read", arguments: "{}" }, 3),
    event(
      "tool/result",
      { message: { source: { callId: "two" }, isError: true, content: [] } },
      4,
    ),
  ]);
  expect(rows.map((row) => row.kind)).toEqual([
    "tool-call",
    "tool-result",
    "tool-call",
    "tool-result",
  ]);
  expect(rows[1]?.label).toBe("提案 · 未执行");
  expect(rows[3]?.status).toBe("failed");
  expect(
    toolOutcome({
      content: [{ type: "tool-result", isError: true, content: [] }],
    }),
  ).toBe("failed");
});
test("子代理轨迹归父行且默认主列表不平铺children", () => {
  const events = [
    event(
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: { content: [{ type: "text", text: "主代理" }] },
      },
      1,
    ),
    event(
      "user/message",
      {
        id: "child-input",
        source: { kind: "user" },
        content: [
          {
            type: "text",
            text: '{"instruction":"核实会议安排","target":"Friday"}',
          },
        ],
      },
      2,
      "child-1",
    ),
    event(
      "tool/call",
      { callId: "read", name: "read", arguments: "{}" },
      3,
      "child-1",
    ),
    {
      kind: "task.started",
      taskId: "schedule",
      childId: "child-1",
      target: "会议改期",
      status: "running",
    },
  ];
  const rows = hierarchy(projectEvents(events), events);
  expect(rows).toHaveLength(2);
  expect(rows[1]?.kind).toBe("subagent");
  expect(rows[1]?.text).toBe("会议改期");
  expect(rows[1]?.children).toHaveLength(2);
});
test("时间保留月日和毫秒，JSON观察只呈现statement", () => {
  expect(preciseTime(new Date(2026, 8, 6, 12, 34, 56, 123).getTime())).toBe(
    "09-06 12:34:56.123",
  );
  expect(
    concise(
      '{"observation":{"kind":"click"},"understanding":{"result":{"statement":"评审改到周一"}},"large":{"tree":[1,2]}}',
    ),
  ).toBe("评审改到周一");
  expect(concise("line one\nline two")).toBe("line one line two");
});
test("同一步live和final只有一行，结果不因迟到chunk退回生成中", () => {
  const chunk = event(
    "assistant/chunk",
    { turn: 1, step: 1, chunk: { type: "text-delta", text: "A" } },
    1,
  );
  const final = event(
    "assistant/message",
    { turn: 1, step: 1, message: { content: [{ type: "text", text: "AB" }] } },
    2,
  );
  const rows = projectEvents([chunk, final, chunk, final]);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).toBe("AB");
  expect(rows[0]?.live).toBe(false);
});

test("系统提示按准确来源压缩列表文案，原始内容和其他消息保持不变", () => {
  const content = [
    {
      type: "text",
      text: "Original runtime instructions remain available in the inspector.",
    },
  ];
  const sources = [
    { kind: "subagent-settled" },
    { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" },
    { kind: "user", plugin: "@deepseek-ai/dsh-system-prompt" },
    { kind: "plugin", plugin: "another-plugin" },
  ];
  const input = sources.map((source, index) =>
    event("user/message", { id: String(index), source, content }, index + 1),
  );
  const before = JSON.stringify(input);
  const rows = projectEvents(input);
  expect(rows.map((row) => row.text)).toEqual([
    "子代理本轮已结束",
    "运行时上下文已更新",
    content[0]!.text,
    content[0]!.text,
  ]);
  expect(rows[0]!.detail.event.data.content).toEqual(content);
  expect(rows[1]!.detail.event.data.content).toEqual(content);
  expect(JSON.stringify(input)).toBe(before);
});
