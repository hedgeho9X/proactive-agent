/** 验证真实 AI SDK 的两种 HTTP 协议、结构化输出及取消边界；只使用本机合成服务。 */
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UnderstandingService } from "../src/model/understanding.ts";
import { understandingModel } from "../src/model/understanding-provider.ts";

test("兼容协议缺少地址时拒绝请求，不能将凭证发往默认 Google 地址", () => {
  expect(() =>
    understandingModel({
      protocol: "openai-compatible",
      model: "fixture",
      apiKey: "fixture",
    }),
  ).toThrow("understanding_base_url_required");
});

/** 生成不含用户信息的单像素图片与动作输入。 */
function fixtureInput(id = "sdk-test") {
  return {
    action: { action_id: id, kind: "click", input: { button: 0 } },
    revision: 1,
    evidence: [],
    view: "raw" as const,
    artifacts: {
      screenshot: {
        bytes:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      },
      ax: { payload: { content: { nodes: [{ title: "测试按钮" }] } } },
    },
  };
}

for (const protocol of ["openai-compatible", "gemini"] as const) {
  test(`AI SDK ${protocol} 发送真实图片和中文 Prompt，记录用量与结构化结果`, async () => {
    const root = await mkdtemp(join(tmpdir(), "understanding-sdk-"));
    const requests: any[] = [];
    const answer = {
      description: "在测试页面阅读多段说明后点击测试按钮。".repeat(5),
      detail: "合成段落第一行。\n合成段落第二行。\n".repeat(100),
    };
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
          headers: request.headers,
        });
        return Response.json(
          protocol === "openai-compatible"
            ? {
                choices: [
                  {
                    index: 0,
                    finish_reason: "stop",
                    message: {
                      role: "assistant",
                      content: JSON.stringify(answer),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 50,
                  completion_tokens: 12,
                  total_tokens: 62,
                  prompt_tokens_details: { cached_tokens: 10 },
                },
              }
            : {
                candidates: [
                  {
                    index: 0,
                    finishReason: "STOP",
                    content: {
                      role: "model",
                      parts: [{ text: JSON.stringify(answer) }],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 50,
                  candidatesTokenCount: 12,
                  totalTokenCount: 62,
                  cachedContentTokenCount: 10,
                },
              },
        );
      },
    });
    const service = new UnderstandingService(root, () => {});
    try {
      const input = fixtureInput();
      const reading = {
        status: "partial",
        selectedText: { text: "合成选区", source: "AXSelectedText" },
        context: {
          text: "合成回复原文。",
          source: "AXValue",
          scope: "related_subtree",
          truncated: true,
          reason: "node_budget",
        },
      };
      Object.assign(input.artifacts.ax.payload.content, {
        reading_context: reading,
      });
      const result: any = await service.summarize(
        input,
        {
          protocol,
          model: "fixture-model",
          apiKey: "fixture-secret",
          baseUrl: `http://127.0.0.1:${server.port}`,
        },
        "只描述当前动作，输出中文 JSON。",
      );
      expect(result.result).toEqual(answer);
      expect(result.result.description.length).toBeGreaterThan(80);
      expect(result.result.detail.length).toBeGreaterThan(1200);
      expect(result.usage).toMatchObject({
        inputTokens: 40,
        outputTokens: 12,
        cacheReadTokens: 10,
        totalTokens: 62,
      });
      expect(requests).toHaveLength(1);
      const { body, headers, path } = requests[0];
      const trace = await service.trace("sdk-test");
      expect(trace.sdk).toBe("vercel-ai-sdk");
      expect(trace.image).toBe(input.artifacts.screenshot.bytes);
      expect(result.contextEvidence).toMatchObject(reading);
      expect(trace.contextEvidence).toEqual(result.contextEvidence);
      expect(trace.userPrompt).toContain("合成回复原文。");
      expect(result.result.detail).not.toContain("合成回复原文。");
      expect(trace.requestSettings).toEqual({
        maxRetries: 0,
        outputTokenLimit: "provider_default",
      });
      expect(trace.finishReason).toBe("stop");
      expect(JSON.stringify(trace)).not.toContain("fixture-secret");
      if (protocol === "openai-compatible") {
        expect(path).toBe("/v1/chat/completions");
        expect(headers.get("authorization")).toBe("Bearer fixture-secret");
        expect(body.messages[0].content).toBe(trace.systemPrompt);
        expect(body.messages[1].content[0].text).toBe(trace.userPrompt);
        expect(body.messages[1].content[1].image_url.url).toBe(
          "data:image/png;base64," + trace.image,
        );
        expect(body.response_format.type).toBe("json_schema");
        expect(body.response_format.json_schema.schema.required).toEqual([
          "description",
          "detail",
        ]);
        expect(body.max_tokens).toBeUndefined();
      } else {
        expect(path).toBe("/v1beta/models/fixture-model:generateContent");
        expect(headers.get("x-goog-api-key")).toBe("fixture-secret");
        expect(body.systemInstruction.parts[0].text).toBe(trace.systemPrompt);
        expect(body.contents[0].parts[0].text).toBe(trace.userPrompt);
        expect(body.contents[0].parts[1].inlineData.data).toBe(trace.image);
        expect(body.generationConfig.responseMimeType).toBe("application/json");
        expect(body.generationConfig?.maxOutputTokens).toBeUndefined();
      }
    } finally {
      await service.close();
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("AI SDK HTTP 失败不自动重试、不泄露上游正文，保留显式失败追踪", async () => {
  const root = await mkdtemp(join(tmpdir(), "understanding-sdk-error-"));
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("fixture-secret-upstream-body", { status: 503 });
    },
  });
  const service = new UnderstandingService(root, () => {});
  try {
    await expect(
      service.summarize(fixtureInput(), {
        protocol: "openai-compatible",
        model: "fixture",
        apiKey: "fixture-secret",
        baseUrl: `http://127.0.0.1:${server.port}`,
      }),
    ).rejects.toThrow("understanding_http_503");
    expect(requests).toBe(1);
    const trace = await service.trace("sdk-test");
    expect(trace.status).toBe("failed");
    expect(JSON.stringify(trace)).not.toContain("fixture-secret");
  } finally {
    await service.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("关闭屏幕理解会取消在途 AI SDK 请求", async () => {
  const root = await mkdtemp(join(tmpdir(), "understanding-sdk-abort-"));
  let entered!: () => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      entered();
      return new Promise<Response>((resolve) => {
        request.signal.addEventListener(
          "abort",
          () => resolve(new Response("cancelled")),
          { once: true },
        );
      });
    },
  });
  const service = new UnderstandingService(root, () => {});
  try {
    const pending = service
      .summarize(fixtureInput(), {
        protocol: "openai-compatible",
        model: "fixture",
        apiKey: "fixture",
        baseUrl: `http://127.0.0.1:${server.port}`,
      })
      .catch((error) => error.message);
    await requested;
    await service.close();
    expect(await pending).toBe("model_cancelled");
    expect((await service.trace("sdk-test")).status).toBe("failed");
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
