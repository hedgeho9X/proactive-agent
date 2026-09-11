import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  UnderstandingService,
  actionHint,
} from "../src/model/understanding.ts";
import { defaultPrompts, PromptStore } from "../src/model/prompts.ts";
import { trajectoryLine } from "../src/model/trajectory.ts";
import { evidenceAnnotations } from "../src/observation/annotations.ts";

test("理解追踪保留真实中文输入、图片、输出；改 Prompt 不复用旧结果，失败可查", async () => {
  const root = await mkdtemp(join(tmpdir(), "understanding-trace-"));
  const requests: any[] = [];
  let invalid = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.json());
      return Response.json({
        choices: [
          {
            message: {
              content: invalid
                ? '{"wrong":"field"}'
                : JSON.stringify({
                    action_title: "在论文页面按下空格",
                    action_detail:
                      "页面显示论文名称；当前证据不能确认输入或提交。",
                  }),
            },
          },
        ],
      });
    },
  });
  const events: any[] = [];
  const service = new UnderstandingService(root, (event) => events.push(event));
  const config = {
    protocol: "openai-compatible" as const,
    model: "fixture",
    baseUrl: `http://127.0.0.1:${server.port}`,
    apiKey: "fixture-secret",
  };
  const image = Buffer.from("fixture-image-bytes").toString("base64");
  const input = {
    action: { action_id: "a", kind: "key_down", input: { key_name: "Space" } },
    revision: 1,
    evidence: [],
    view: "raw" as const,
    artifacts: {
      screenshot: { bytes: image, payload: { content: { annotated: true } } },
      ax: { payload: { content: { nodes: [{ title: "论文" }] } } },
    },
  };
  try {
    const result: any = await service.summarize(input, config);
    const trace = await service.trace("a");
    expect(result.result.action_title).toBe("在论文页面按下空格");
    expect(trace.systemPrompt).toBe(requests[0].messages[0].content);
    expect(trace.userPrompt).toBe(requests[0].messages[1].content[0].text);
    expect(trace.userPrompt).toContain("## 当前 AX 树");
    expect(trace.promptInput.axTree.nodes[0].title).toBe("论文");
    expect(result.manifest.userPrompt).toBe(trace.userPrompt);
    expect(trace.image).toBe(image);
    expect(requests[0].messages[1].content[1].image_url.url).toEndWith(image);
    expect(JSON.stringify(trace)).not.toContain("fixture-secret");
    const completed = events.find(
      (event) => event.kind === "understanding.completed",
    );
    expect(completed.result).toEqual(result.result);
    expect(completed.manifest).toBeUndefined();
    expect(completed.debug).toBeUndefined();
    expect(JSON.stringify(completed)).not.toContain(image);
    expect(JSON.stringify(completed).length).toBeLessThan(2048);
    await service.summarize(input, config);
    expect(requests.length).toBe(1);
    await service.summarize(
      input,
      config,
      defaultPrompts.understanding + "\n更简洁。",
    );
    expect(requests.length).toBe(2);
    invalid = true;
    await expect(
      service.summarize({ ...input, revision: 2 }, config),
    ).rejects.toThrow();
    const failed = await service.trace("a");
    expect(failed.status).toBe("failed");
    expect(failed.rawOutput).toContain("wrong");
    expect(failed.image).toBe(image);
  } finally {
    await service.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("动作提示区分右键，轨迹只含摘要和 ID；标注忽略不可靠范围", () => {
  expect(
    actionHint({ kind: "click", input: { button: 1, x: 12, y: 14 } }),
  ).toContain("鼠标右键");
  const line = trajectoryLine(
    "ax-test",
    { occurred_at: "2026-09-08T04:12:13.456Z" },
    { action_title: "查看论文", action_detail: "论文 A\nURL：example.com" },
  );
  expect(line).toContain("26-09-08");
  expect(line).toContain(".456]");
  expect(line).toEndWith("/ ax-test");
  expect(line).not.toContain("\n");
  const annotations = evidenceAnnotations(
    {
      coordinateSpace: "screen_top_left_points",
      shadowsExcluded: true,
      frame: { x: 100, y: 100, width: 200, height: 200 },
      regions: {
        focus: {
          status: "unavailable",
          rect: { x: 120, y: 120, width: 50, height: 50 },
        },
      },
    },
    { kind: "click", x: 200, y: 200 },
  );
  expect(annotations.layers).toHaveLength(0);
  expect(annotations.point).toEqual({ left: 50, top: 50 });
});

test("三角色 Prompt 独立保存且默认中文", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompts-"));
  try {
    const store = new PromptStore(join(root, "prompts.json"));
    await store.update("understanding", "仅描述当前动作。");
    const restored = new PromptStore(join(root, "prompts.json"));
    await restored.load();
    expect(restored.snapshot().understanding).toBe("仅描述当前动作。");
    expect(restored.snapshot().main).toBe(defaultPrompts.main);
    await expect(store.update("main", " ")).rejects.toThrow();
    await expect(
      store.update("constructor" as any, "错误角色"),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
