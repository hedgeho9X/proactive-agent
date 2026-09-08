import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDanmaku } from "../src/model/danmaku.ts";
import { registerCapabilities } from "../src/model/tools.ts";
import { RuntimeHost } from "../src/host.ts";

test("弹幕校验长度、时长、空值，保留纯文本而非解释 HTML", () => {
  expect(parseDanmaku({ text: " 提醒\n一下 " })).toEqual({
    text: "提醒 一下",
    duration_seconds: 8,
  });
  expect(parseDanmaku({ text: "<img src=x>" }).text).toBe("<img src=x>");
  expect(
    parseDanmaku({ text: "😀".repeat(80), duration_seconds: 4 })
      .duration_seconds,
  ).toBe(4);
  for (const value of [
    null,
    {},
    { text: " " },
    { text: "a".repeat(81) },
    { text: "a", duration_seconds: 13 },
    { text: "a", duration_seconds: NaN },
    { text: "a", duration_seconds: "8" },
  ])
    expect(() => parseDanmaku(value)).toThrow();
});

test("弹幕工具不伪造桌面成功，禁用与限频原样返回", async () => {
  const tools = new Map<string, any>();
  const ctx = {
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
  } as any;
  registerCapabilities(ctx, {}, () => {});
  expect(
    await tools.get("send_danmaku").execute({ text: "测试" }),
  ).toMatchObject({ status: "unavailable" });
  for (const status of ["disabled", "rate_limited", "shown"]) {
    registerCapabilities(
      ctx,
      { sendDanmaku: async () => ({ status }) },
      () => {},
    );
    expect(await tools.get("send_danmaku").execute({ text: "测试" })).toEqual({
      status,
    });
  }
});

test("模拟模型通过真实 DSH 与 sidecar IPC 调用桌面弹幕能力并读取结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "danmaku-runtime-"));
  const calls: unknown[] = [];
  let hasRegisteredTool = false;
  let toolResult = "";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as any;
      hasRegisteredTool ||= body.tools.some(
        (tool: any) => tool.function.name === "send_danmaku",
      );
      const result = body.messages.find(
        (message: any) => message.role === "tool",
      );
      if (result) toolResult = JSON.stringify(result.content);
      const delta = result
        ? { content: "测试结束" }
        : {
            tool_calls: [
              {
                index: 0,
                id: "danmaku-call",
                type: "function",
                function: {
                  name: "send_danmaku",
                  arguments: JSON.stringify({
                    text: "这是一条模拟模型的工具测试",
                    duration_seconds: 4,
                  }),
                },
              },
            ],
          };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const host = new RuntimeHost(root, {
    modelConfig: {
      protocol: "openai-compatible",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "fixture-danmaku",
      apiKey: "fixture-only",
    },
    sendDanmaku: async (input) => {
      calls.push(input);
      return { status: "shown", id: "mock-desktop" };
    },
  });
  try {
    await host.ready;
    await host.request("observe", {
      actionId: "fixture-danmaku",
      value: { user_prompt: "测试弹幕工具" },
    });
    const deadline = Date.now() + 5000;
    while (!toolResult) {
      if (Date.now() > deadline) throw new Error("danmaku_tool_result_missing");
      await Bun.sleep(20);
    }
    expect(hasRegisteredTool).toBe(true);
    expect(calls).toEqual([
      { text: "这是一条模拟模型的工具测试", duration_seconds: 4 },
    ]);
    expect(toolResult).toContain("shown");
    expect(toolResult).toContain("mock-desktop");
  } finally {
    await host.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
