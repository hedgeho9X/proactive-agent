import { test, expect } from "bun:test";
import { ModelRoles } from "../src/model/config.ts";
import { OpenAIAdapter, completion } from "../src/model/openai.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("三组配置独立、任意model id、snapshot与文件无key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roles-"));
  try {
    const file = join(dir, "roles.json");
    const roles = new ModelRoles(file);
    const defaults = roles.snapshot();
    expect(defaults.understanding.protocol).toBe("openai-compatible");
    expect(defaults.understanding.baseUrl).toBe(
      "https://example.com/v1/",
    );
    expect(defaults.understanding.model).toBe("gemini-3.8-flash");
    expect(defaults.main.model).toBe("");
    expect(defaults.subagent.model).toBe("");
    await roles.update("main", {
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      model: "custom/model:123",
      apiKey: "main-secret",
    });
    await roles.update("subagent", {
      model: "another",
      apiKey: "child-secret",
    });
    await roles.update("understanding", {
      model: "vision",
      apiKey: "vision-secret",
    });
    expect(roles.get("main")?.model).toBe("custom/model:123");
    expect(roles.get("subagent")?.model).toBe("another");
    expect(JSON.stringify(roles.snapshot())).not.toContain("secret");
    expect(await readFile(file, "utf8")).not.toContain("secret");
    const reloaded = new ModelRoles(file);
    await reloaded.load();
    expect((reloaded.snapshot() as any).main.model).toBe("custom/model:123");
    expect(reloaded.get("main")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenAI根地址补齐v1，同时保留已有版本和代理路径", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = (async (url: any) => {
      urls.push(String(url));
      return new Response("{}");
    }) as any;
    for (const baseUrl of [
      "https://example.com/",
      "https://example.com/v1/",
      "https://example.com/proxy/v2",
    ])
      await completion(
        {
          protocol: "openai-compatible",
          baseUrl,
          apiKey: "fixture",
          model: "fixture",
        },
        {},
      );
    expect(urls).toEqual([
      "https://example.com/v1/chat/completions",
      "https://example.com/v1/chat/completions",
      "https://example.com/proxy/v2/chat/completions",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("OpenAI兼容stream处理拆分SSE、图像、工具、abort与HTTP错误", async () => {
  const original = globalThis.fetch;
  let request: any;
  try {
    globalThis.fetch = (async (url: any, options: any) => {
      request = { url, body: JSON.parse(options.body), signal: options.signal };
      return new Response(
        new ReadableStream({
          start(c) {
            const source =
              "data: " +
              JSON.stringify({ choices: [{ delta: { content: "hello" } }] }) +
              "\n\ndata: " +
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call",
                          function: {
                            name: "read_file",
                            arguments: '{"path":"x"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              }) +
              "\n\ndata: [DONE]\n";
            c.enqueue(new TextEncoder().encode(source.slice(0, 17)));
            c.enqueue(new TextEncoder().encode(source.slice(17)));
            c.close();
          },
        }),
      );
    }) as any;
    const adapter = new OpenAIAdapter(
      {
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        model: "custom",
        apiKey: "secret",
      },
      {
        attachments: {
          readImage: async () => ({
            ref: { mediaType: "image/png" },
            data: new Uint8Array([1]),
          }),
        },
      } as any,
      () => {},
    );
    const signal = new AbortController().signal;
    const chunks: any[] = [];
    for await (const c of adapter.stream({
      provider: "role",
      model: "custom",
      signal,
      messages: [
        {
          id: "a",
          role: "user",
          source: { kind: "user" },
          content: [
            { type: "image", attachment: {} },
            { type: "text", text: "test" },
          ],
        },
      ] as any,
    }))
      chunks.push(c);
    expect(request.url).toBe("https://example.com/v1/chat/completions");
    expect(request.body.messages[0].content[0].image_url.url).toStartWith(
      "data:image/png;base64,",
    );
    expect(chunks.at(-1).reason.kind).toBe("tool-calls");
    expect(
      chunks.some((c) => c.type === "text-delta" && c.text === "hello"),
    ).toBe(true);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    globalThis.fetch = (async () => new Response("", { status: 401 })) as any;
    await expect(
      (async () => {
        for await (const c of adapter.stream({
          provider: "role",
          model: "custom",
          messages: [],
        }))
          void c;
      })(),
    ).rejects.toThrow("openai_http_401");
  } finally {
    globalThis.fetch = original;
  }
});

test("SQLite队列保留忙碌期间全部action、失败gap、retry、重启ready与配置等待", () => {
  const url = new URL("../src/model/queue.ts", import.meta.url).href;
  const result = spawnSync(
    "node",
    [
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      `
    import {ActionQueue} from ${JSON.stringify(url)};import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';
    const root=await mkdtemp('/private/tmp/queue-test-');const path=root+'/q.sqlite';const calls=[];let enabled=false;let fail=true;
    const handlers={read:id=>({action:{action_id:id},evidence:[]}),canUnderstand:()=>enabled,canDeliver:()=>enabled,understand:async item=>{await new Promise(r=>setTimeout(r,3));if(item.action.action_id==='a2'&&fail)throw new Error('fixture_failed');return {id:item.action.action_id};},deliver:async(id)=>calls.push(id),change:()=>{}};
    let q=new ActionQueue(path,handlers);for(let i=1;i<=25;i++)q.enqueue('a'+i);q.enqueue('a1');assert.equal(q.list().length,25);enabled=true;await q.drain();
    assert.equal(calls.length,24);assert.equal(q.list().find(r=>r.actionId==='a2').status,'failed');assert.equal(q.list().at(-1).status,'delivered');fail=false;q.retry('a2');await new Promise(r=>setTimeout(r,20));assert.equal(q.list().find(r=>r.actionId==='a2').status,'delivered');
    await q.close();q=new ActionQueue(path,{...handlers,canDeliver:()=>false});assert.equal(q.list().length,25);q.enqueue('ready-wait');await new Promise(r=>setTimeout(r,20));assert.equal(q.list().at(-1).status,'ready');await q.close();q=new ActionQueue(path,handlers);await q.drain();assert.equal(q.list().at(-1).status,'delivered');q.enqueue('filtered','ordinary_typing_filtered');assert.equal(q.list().at(-1).status,'filtered');await q.close();const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);db.prepare("INSERT INTO queue(actionId,status,createdAt) VALUES('early-queued','queued',?)").run(Date.now());db.prepare("INSERT INTO queue(actionId,status,result,createdAt) VALUES('later-ready','ready','{}',?)").run(Date.now());db.close();q=new ActionQueue(path,{...handlers,canUnderstand:()=>false});await q.drain();assert.equal(q.list().find(r=>r.actionId==='later-ready').status,'delivered');assert.equal(q.list().find(r=>r.actionId==='early-queued').status,'queued');await q.close();await rm(root,{recursive:true,force:true});console.log('passed');
  `,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("passed");
});

test("真实DSH子代理使用独立baseURL/model/key而非继承main", async () => {
  const { RuntimeHost } = await import("../src/host.ts");
  const root = await mkdtemp(join(tmpdir(), "role-routing-"));
  const seen: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as any;
      seen.push({
        path: new URL(request.url).pathname,
        model: body.model,
        key: request.headers.get("authorization"),
      });
      const hasTool = body.messages.some((m: any) => m.role === "tool");
      const delta =
        body.model === "main-custom" && !hasTool
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "delegate-call",
                  type: "function",
                  function: {
                    name: "delegate",
                    arguments: JSON.stringify({
                      taskId: "routed-task",
                      target: "verify",
                      prompt: "reply once",
                    }),
                  },
                },
              ],
            }
          : { content: "done" };
      return new Response(
        "data: " +
          JSON.stringify({ choices: [{ delta }] }) +
          "\n\ndata: [DONE]\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const host = new RuntimeHost(root, {
    modelConfig: {
      protocol: "openai-compatible",
      baseUrl: `http://127.0.0.1:${server.port}/main`,
      model: "main-custom",
      apiKey: "main-only",
    },
    subagentConfig: {
      protocol: "openai-compatible",
      baseUrl: `http://127.0.0.1:${server.port}/child`,
      model: "child-custom",
      apiKey: "child-only",
    },
  });
  try {
    await host.ready;
    await host.request("observe", {
      actionId: "routing",
      value: { user_prompt: "delegate" },
    });
    const deadline = Date.now() + 5000;
    while (!seen.some((e) => e.model === "child-custom")) {
      if (Date.now() > deadline) throw new Error("child_route_not_called");
      await Bun.sleep(20);
    }
    expect(seen.find((e) => e.model === "main-custom")).toMatchObject({
      path: "/main/chat/completions",
      key: "Bearer main-only",
    });
    expect(seen.find((e) => e.model === "child-custom")).toMatchObject({
      path: "/child/chat/completions",
      key: "Bearer child-only",
    });
  } finally {
    await host.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenAI断流不可当成功，length保留max-tokens语义", async () => {
  const original = globalThis.fetch;
  const adapter = new OpenAIAdapter(
    {
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      model: "any",
    },
    {} as any,
    () => {},
  );
  try {
    globalThis.fetch = (async () =>
      new Response(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: "partial" } }] }) +
          "\n\n",
      )) as any;
    await expect(
      (async () => {
        for await (const chunk of adapter.stream({
          provider: "x",
          model: "any",
          messages: [],
        }))
          void chunk;
      })(),
    ).rejects.toThrow("openai_stream_incomplete");
    globalThis.fetch = (async () =>
      new Response(
        "data: " +
          JSON.stringify({
            choices: [
              { delta: { content: "partial" }, finish_reason: "length" },
            ],
          }) +
          "\n\n",
      )) as any;
    const chunks: any[] = [];
    for await (const chunk of adapter.stream({
      provider: "x",
      model: "any",
      messages: [],
    }))
      chunks.push(chunk);
    expect(chunks.at(-1).reason.kind).toBe("max-tokens");
  } finally {
    globalThis.fetch = original;
  }
});
