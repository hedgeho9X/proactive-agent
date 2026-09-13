/** 用本机 HTTP 模型替身验证多轮取证、最终结构化输出和真实步骤追踪。 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnderstandingService } from "../src/model/understanding.ts";
import {
  EvidenceSession,
  type EvidenceRow,
} from "../src/understanding/evidence-session.ts";

test("理解 Agent 先读历史详情再生成信息充分的标题，工具结果进入下一次请求", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-understanding-"));
  const requests: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as any;
      requests.push(body);
      const content =
        requests.length === 1
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-detail",
                  type: "function",
                  function: {
                    name: "get_action_detail",
                    arguments: '{"action_id":"prior"}',
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: JSON.stringify({
                action_title: "查看论文A的记忆检索方法",
                action_detail: "当前页面讨论按任务检索交互历史。",
              }),
            };
      return Response.json({
        choices: [
          {
            index: 0,
            message: content,
            finish_reason: requests.length === 1 ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });
    },
  });
  const anchor: EvidenceRow = {
    id: "current",
    time: new Date(2000).toISOString(),
    app: { bundle_id: "com.brave.Browser" },
  };
  const source = {
    list: async () => [
      {
        ...anchor,
        id: "prior",
        time: new Date(1000).toISOString(),
        title: "打开论文A",
      },
    ],
    read: async () => ({ action: {}, evidence: [], artifacts: {} }),
    result: () => ({ result: { action_detail: "论文A：基于任务的记忆检索" } }),
  };
  const service = new UnderstandingService(root, () => {}, {
    createSession: () => EvidenceSession.create(source, anchor),
  });
  try {
    const result: any = await service.summarize(
      {
        action: { action_id: "current", occurred_at: anchor.time },
        revision: 1,
        evidence: [],
        artifacts: {
          screenshot: {
            bytes: Buffer.from("fixture-image").toString("base64"),
          },
        },
        view: "raw",
      },
      {
        protocol: "openai-compatible",
        model: "fixture",
        apiKey: "fixture-secret",
        baseUrl: `http://127.0.0.1:${server.port}`,
      },
    );
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0].content).toContain("500–600");
    expect(requests[0].messages[1].content[0].text).toContain("打开论文A");
    expect(
      requests[0].tools.some((t: any) => t.function.name === "web_search"),
    ).toBe(false);
    expect(JSON.stringify(requests[1].messages)).toContain(
      "基于任务的记忆检索",
    );
    expect(result.result.action_title).toBe("查看论文A的记忆检索方法");
    expect(result.usage.totalTokens).toBe(60);
    const trace = await service.trace("current");
    expect(trace.steps).toHaveLength(2);
    expect(trace.toolCalls[0].name).toBe("get_action_detail");
    expect(trace.userPrompt).toBe(result.manifest.userPrompt);
    expect(JSON.stringify(trace.steps)).not.toContain("fixture-secret");
  } finally {
    await service.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
