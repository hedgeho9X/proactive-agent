import { test, expect } from "bun:test";
import { GeminiAdapter, usageOf } from "../src/model/gemini.ts";
import {
  inputManifest,
  projectUnderstanding,
  type UnderstandingInput,
} from "../src/model/understanding.ts";
import { projectEvents } from "../src/renderer/projection.ts";
import { readConfinedFile } from "../src/model/tools.ts";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Raw/Context实际选择不同节点，manifest覆盖动作/时间/缺失/模型", () => {
  const input: UnderstandingInput = {
    action: { action_id: "a", occurred_at: "2026-09-06", kind: "click" },
    revision: 1,
    evidence: [{ kind: "ax", status: "captured" }],
    view: "raw",
    artifacts: {
      ax: {
        id: "x",
        hash: "h",
        payload: {
          content: {
            nodes: [{ node_id: "1" }, { node_id: "2" }],
            context: {
              context: [{ node_id: "2" }],
              normalized: [{ node_id: "1" }, { node_id: "2" }],
            },
          },
        },
      },
    },
  };
  const raw = projectUnderstanding(input);
  const filtered = projectUnderstanding({ ...input, view: "context" });
  expect(raw.artifacts.ax.payload.content.nodes).toHaveLength(2);
  expect(filtered.artifacts.ax.payload.content.nodes).toHaveLength(1);
  expect(filtered.artifacts.ax.payload.content.context).toBeUndefined();
  const hash = inputManifest(raw, "gemini-x").hash;
  expect(inputManifest(filtered, "gemini-x").hash).not.toBe(hash);
  expect(
    inputManifest(
      { ...raw, action: { ...raw.action, occurred_at: "later" } },
      "gemini-x",
    ).hash,
  ).not.toBe(hash);
  expect(
    inputManifest(
      { ...raw, evidence: [{ kind: "ax", status: "expired" }] },
      "gemini-x",
    ).hash,
  ).not.toBe(hash);
  expect(inputManifest(raw, "gemini-y").hash).not.toBe(hash);
});

test("Gemini mock SDK工具多轮保留原始Part和thoughtSignature，不增加原生id", async () => {
  const original = {
    functionCall: { name: "calendar_create", args: { target: "test" } },
    thoughtSignature: "opaque-signature",
  };
  const adapter = new GeminiAdapter(
    { apiKey: "fixture-only", model: "gemini-test" },
    { attachments: {} } as any,
    () => {},
  );
  let request: any;
  (adapter as any).client = {
    models: {
      generateContentStream: async (input: any) => {
        request = input;
        return (async function* () {
          yield {
            candidates: [
              { content: { parts: [original] }, finishReason: "STOP" },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 3,
              cachedContentTokenCount: 2,
              totalTokenCount: 13,
            },
          };
        })();
      },
    },
  };
  const chunks: any[] = [];
  for await (const chunk of adapter.stream({
    provider: "gemini",
    model: "gemini-test",
    messages: [
      {
        id: "u",
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text: "test" }],
      },
    ] as any,
  }))
    chunks.push(chunk);
  const block = chunks.find((c) => c.type === "block-end").block;
  const replay = chunks.at(-1).replayState;
  expect(original.functionCall).not.toHaveProperty("id");
  expect(replay.response.parts[0]).toEqual(original);
  const contents = await adapter.contents([
    {
      id: "a",
      role: "assistant",
      source: {
        kind: "model",
        provider: "gemini",
        model: "gemini-test",
        replayState: replay,
      },
      content: [block],
    },
    {
      id: "t",
      role: "user",
      source: { kind: "tool", callId: block.id },
      content: [
        {
          type: "tool-result",
          toolCallId: block.id,
          content: [{ type: "text", text: "not_executed" }],
        },
      ],
    },
  ] as any);
  expect(contents[0]?.parts?.[0]).toEqual(original);
  expect(contents[1]?.parts?.[0].functionResponse?.id).toBeUndefined();
  expect(contents[1]?.parts?.[0].functionResponse?.name).toBe(
    "calendar_create",
  );
  expect(request.model).toBe("gemini-test");
  expect(
    usageOf({ promptTokenCount: 10, cachedContentTokenCount: 2 }),
  ).toMatchObject({ inputTokens: 8, cacheReadTokens: 2, costUSD: null });
});

test("live/final与重复回补只有一个assistant行", () => {
  const chunk = {
    kind: "session.event",
    sessionId: "main",
    event: {
      type: "assistant/chunk",
      time: 1,
      data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "A" } },
    },
  };
  const final = {
    kind: "session.event",
    sessionId: "main",
    event: {
      type: "assistant/message",
      time: 2,
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: "text", text: "AB" }] },
      },
    },
  };
  const rows = projectEvents([chunk, final, chunk, final]);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).toBe("AB");
  expect(rows[0]?.live).toBe(false);
});

test("只读目录拒绝符号链接越界", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-read-"));
  const outside = await mkdtemp(join(tmpdir(), "proactive-outside-"));
  try {
    await writeFile(join(root, "ok.txt"), "test");
    await writeFile(join(outside, "secret.txt"), "fixture");
    await symlink(join(outside, "secret.txt"), join(root, "link"));
    expect(await readConfinedFile(root, "ok.txt")).toMatchObject({
      content: "test",
    });
    await expect(readConfinedFile(root, "link")).rejects.toThrow(
      "path_outside_allowed_root",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
