import { expect, test } from "bun:test";
import { testModelConnection } from "../src/model/connection-test.ts";

test("连接测试验证真实HTTP路径、角色模型、鉴权、空响应和错误脱敏", async () => {
  let mode = "success";
  let body: any;
  let path = "";
  let authorization = "";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      path = new URL(request.url).pathname;
      authorization = request.headers.get("authorization") ?? "";
      body = await request.json();
      if (mode === "error")
        return new Response("fixture-secret-private-error", { status: 401 });
      return Response.json({
        choices: [{ message: { content: mode === "empty" ? "" : "OK" } }],
      });
    },
  });
  try {
    const config = {
      protocol: "openai-compatible" as const,
      baseUrl: `http://localhost:${server.port}/`,
      apiKey: "fixture-key",
      model: "fixture-model",
    };
    expect((await testModelConnection()).ok).toBe(false);
    expect((await testModelConnection(config)).ok).toBe(true);
    expect(path).toBe("/v1/chat/completions");
    expect(authorization).toBe("Bearer fixture-key");
    expect(body.model).toBe("fixture-model");
    expect(body.messages).toEqual([
      { role: "user", content: "Reply with OK only." },
    ]);
    mode = "empty";
    expect((await testModelConnection(config)).ok).toBe(false);
    mode = "error";
    const failure = await testModelConnection(config);
    expect(failure.error).toContain("401");
    expect(JSON.stringify(failure)).not.toContain("fixture-secret");
  } finally {
    server.stop(true);
  }
});

test("Gemini连接测试使用原生协议并验证文本响应", async () => {
  let path = "";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      path = new URL(request.url).pathname;
      return Response.json({
        candidates: [{ content: { role: "model", parts: [{ text: "OK" }] } }],
      });
    },
  });
  try {
    expect(
      (
        await testModelConnection({
          protocol: "gemini",
          baseUrl: `http://localhost:${server.port}`,
          apiKey: "fixture",
          model: "fixture-model",
        })
      ).ok,
    ).toBe(true);
    expect(path).toContain("models/fixture-model:generateContent");
  } finally {
    server.stop(true);
  }
});
