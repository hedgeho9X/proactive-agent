/** 验证供应商截断与格式错误分开归因，应用不设置输出 Token 上限。 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnderstandingService } from "../src/model/understanding.ts";

test("供应商 length 结束记录为截断，追踪保留实际输出", async () => {
  const root = await mkdtemp(join(tmpdir(), "understanding-truncated-"));
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as any;
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBeUndefined();
      return Response.json({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"description":"未写完' },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });
    },
  });
  const service = new UnderstandingService(root, () => {});
  try {
    await expect(
      service.summarize(
        {
          action: { action_id: "truncated" },
          revision: 1,
          evidence: [],
          artifacts: {
            screenshot: { bytes: Buffer.from("fixture").toString("base64") },
          },
          view: "raw",
        },
        {
          protocol: "openai-compatible",
          model: "fixture",
          apiKey: "fixture",
          baseUrl: `http://127.0.0.1:${server.port}`,
        },
      ),
    ).rejects.toThrow("understanding_output_truncated");
    const trace = await service.trace("truncated");
    expect(trace.finishReason).toBe("length");
    expect(trace.rawOutput).toContain("未写完");
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
