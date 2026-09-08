import { completion } from "./openai.ts";
import type { RoleModelConfig } from "./config.ts";
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  validateJsonSchemaValue,
  type ToolDefinition,
} from "@deepseek-ai/dsh-tools";
import { publicModelError, usageOf, type ModelConfig } from "./gemini.ts";
import { defaultPrompts } from "./prompts.ts";

export interface UnderstandingInput {
  action: Record<string, unknown>;
  revision: number;
  evidence: unknown[];
  artifacts: Record<string, any>;
  view: "raw" | "context";
}
export const understandingSchema: ToolDefinition["output"]["schema"] = {
  type: "object",
  properties: {
    action_title: { type: "string" },
    action_detail: { type: "string" },
  },
  required: ["action_title", "action_detail"],
  additionalProperties: false,
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function projectUnderstanding(
  input: UnderstandingInput,
): UnderstandingInput {
  const artifacts = { ...input.artifacts };
  const ax = artifacts.ax;
  if (ax?.payload?.content) {
    const content = ax.payload.content;
    const nodes =
      input.view === "raw"
        ? (content.nodes ?? [])
        : (content.context?.context ?? content.nodes ?? []);
    artifacts.ax = {
      ...ax,
      payload: {
        ...ax.payload,
        content: {
          ...content,
          context: undefined,
          nodes,
          coverage: content.coverage,
          filter_version: content.context?.policy_version,
          filter_reasons: content.context?.reasons,
          selected_view: input.view,
        },
      },
    };
  }
  // Before截图保持manifest中的完整关联，但首版模型只发送After截图，避免未声明的双图含义。
  delete artifacts.screenshot_before;
  return { ...input, artifacts };
}
export function inputManifest(
  input: UnderstandingInput,
  model: string,
  prompt = defaultPrompts.understanding,
) {
  const artifacts = Object.fromEntries(
    Object.entries(input.artifacts).map(([kind, a]) => [
      kind,
      a
        ? {
            id: a.id,
            hash: a.hash,
            captured: a.captured,
            payload: a.payload,
            bytes_hash: createHash("sha256")
              .update(a.bytes ?? "")
              .digest("hex"),
          }
        : null,
    ]),
  );
  const manifest = {
    schema: "understanding-v2",
    prompt_version: 3,
    prompt,
    model,
    ...input,
    artifacts,
  };
  return {
    manifest,
    hash: createHash("sha256").update(canonical(manifest)).digest("hex"),
  };
}
// 缓存包含动作、证据状态、AX/OCR内容与图像hash，不能只用截图判断相同上下文。
export class UnderstandingService {
  private controller = new AbortController();
  abort() {
    this.controller.abort();
  }
  async close() {
    this.abort();
    await Promise.allSettled([...this.active.values()]);
  }
  private active = new Map<string, Promise<unknown>>();

  constructor(
    private cacheDir: string,
    private emit: (event: Record<string, unknown>) => void,
  ) {}
  async summarize(
    input: UnderstandingInput,
    config: ModelConfig,
    prompt = defaultPrompts.understanding,
  ) {
    if (!input.artifacts.screenshot?.bytes)
      throw new Error("screenshot_required");
    input = projectUnderstanding(input);
    const { manifest, hash } = inputManifest(
      input,
      JSON.stringify({
        protocol: config.protocol ?? "gemini",
        baseUrl: config.baseUrl ?? "https://generativelanguage.googleapis.com",
        model: config.model,
      }),
      prompt,
    );
    const cached = await readFile(join(this.cacheDir, hash + ".json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (cached) {
      await this.saveTrace(String(input.action.action_id), cached.debug);
      return { ...cached, cached: true };
    }
    if (this.active.has(hash)) return this.active.get(hash)!;
    const work = this.run(input, config, manifest, hash, prompt);
    this.active.set(hash, work);
    try {
      return await work;
    } finally {
      this.active.delete(hash);
    }
  }
  private async run(
    input: UnderstandingInput,
    config: ModelConfig,
    manifest: unknown,
    hash: string,
    prompt: string,
  ) {
    const safeArtifacts = Object.fromEntries(
      Object.entries(input.artifacts).map(([kind, a]) => [
        kind,
        a ? { ...a, bytes: undefined } : null,
      ]),
    );
    const parts: any[] = [
      {
        text: JSON.stringify({
          任务: "请描述用户在这一时刻做了什么，输出 action_title 和 action_detail。",
          动作提示: actionHint(input.action),
          action: input.action,
          evidence: input.evidence,
          artifacts: safeArtifacts,
          view: input.view,
        }),
      },
    ];
    const screenshot = input.artifacts.screenshot;
    if (screenshot?.bytes)
      parts.push({
        inlineData: { mimeType: "image/png", data: screenshot.bytes },
      });
    const began = Date.now();
    const debug: any = {
      status: "running",
      actionId: input.action.action_id,
      systemPrompt: prompt,
      userPrompt: parts[0].text,
      schema: understandingSchema,
      model: config.model,
      protocol: config.protocol ?? "gemini",
      startedAt: new Date(began).toISOString(),
      imageFile: screenshot?.bytes ? `${hash}.input.png` : null,
      imageHash: screenshot?.bytes
        ? createHash("sha256")
            .update(Buffer.from(screenshot.bytes, "base64"))
            .digest("hex")
        : null,
      imageKind: screenshot?.payload?.content?.annotated
        ? "annotated"
        : "original_or_unavailable",
    };
    await mkdir(this.cacheDir, { recursive: true });
    if (debug.imageFile)
      await writeFile(
        join(this.cacheDir, debug.imageFile),
        Buffer.from(screenshot.bytes, "base64"),
        { mode: 0o600 },
      );
    await this.saveTrace(String(input.action.action_id), debug);
    this.emit({
      kind: "understanding.started",
      actionId: input.action.action_id,
      input_manifest_hash: hash,
    });
    try {
      let response: any;
      if (config.protocol === "openai-compatible") {
        const content: any[] = [{ type: "text", text: parts[0].text }];
        if (screenshot?.bytes)
          content.push({
            type: "image_url",
            image_url: { url: "data:image/png;base64," + screenshot.bytes },
          });
        const raw = await (
          await completion(
            config as RoleModelConfig,
            {
              messages: [
                { role: "system", content: prompt },
                { role: "user", content },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "screen_understanding",
                  strict: true,
                  schema: understandingSchema,
                },
              },
              max_tokens: 1024,
            },
            AbortSignal.any([
              this.controller.signal,
              AbortSignal.timeout(30000),
            ]),
          )
        ).json();
        response = {
          text: raw.choices?.[0]?.message?.content,
          usageMetadata: {
            promptTokenCount: raw.usage?.prompt_tokens,
            candidatesTokenCount: raw.usage?.completion_tokens,
            totalTokenCount: raw.usage?.total_tokens,
          },
        };
      } else
        response = await new GoogleGenAI({
          apiKey: config.apiKey,
          httpOptions: config.baseUrl ? { baseUrl: config.baseUrl } : undefined,
        }).models.generateContent({
          model: config.model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: prompt,
            responseMimeType: "application/json",
            responseJsonSchema: understandingSchema,
            maxOutputTokens: 1024,
            abortSignal: AbortSignal.any([
              this.controller.signal,
              AbortSignal.timeout(30_000),
            ]),
          },
        });
      debug.rawOutput = String(response.text ?? "").slice(0, 64000);
      const result = JSON.parse(response.text ?? "");
      if (
        validateJsonSchemaValue(understandingSchema, result).length ||
        !result.action_title.trim() ||
        !result.action_detail.trim() ||
        result.action_title.length > 80 ||
        result.action_detail.length > 1200
      )
        throw new Error("invalid_understanding");
      const record = {
        result,
        model_role: "understanding",
        model_config: {
          protocol: config.protocol ?? "gemini",
          baseUrl: config.baseUrl,
          model: config.model,
        },
        input_manifest_hash: hash,
        manifest,
        model: config.model,
        created_at: new Date().toISOString(),
        usage: usageOf(response.usageMetadata),
        cached: false,
        debug: {
          ...debug,
          status: "completed",
          elapsedMs: Date.now() - began,
          output: result,
        },
      };
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(
        join(this.cacheDir, hash + ".json"),
        JSON.stringify(record),
      );
      await this.saveTrace(String(input.action.action_id), record.debug);
      this.emit({
        kind: "understanding.completed",
        actionId: input.action.action_id,
        ...record,
      });
      return record;
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "invalid_understanding_json"
          : error instanceof Error && error.message === "invalid_understanding"
            ? error.message
            : publicModelError(error);
      await this.saveTrace(String(input.action.action_id), {
        ...debug,
        status: "failed",
        elapsedMs: Date.now() - began,
        error: message,
      });
      this.emit({
        kind: "understanding.failed",
        actionId: input.action.action_id,
        message,
      });
      throw new Error(message);
    }
  }
  private traceFile(id: string) {
    return join(
      this.cacheDir,
      "trace-" + createHash("sha256").update(id).digest("hex") + ".json",
    );
  }
  private async saveTrace(id: string, debug: unknown) {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.traceFile(id), JSON.stringify(debug), { mode: 0o600 });
  }
  async trace(id: string) {
    const trace = await readFile(this.traceFile(id), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (!trace) return null;
    const image = /^[0-9a-f]{64}\.input\.png$/.test(trace.imageFile ?? "")
      ? await readFile(join(this.cacheDir, trace.imageFile))
          .then((bytes) => bytes.toString("base64"))
          .catch(() => null)
      : null;
    return { ...trace, image };
  }
}

export function actionHint(action: any) {
  const input = action.input ?? {};
  const operation = ["click", "mouse_down"].includes(action.kind)
    ? `用户点击${input.button === 1 ? "鼠标右键" : input.button === 2 ? "鼠标中键" : "鼠标左键"}，坐标 (${input.x ?? "未知"}, ${input.y ?? "未知"})`
    : `用户按下 ${(input.modifiers ?? []).join("+")}${input.modifiers?.length ? "+" : ""}${input.key_name ?? action.kind}`;
  return `${operation}。当前应用：${action.app?.name ?? "未知"}。只依据当前证据描述，不自动认定提交成功。`;
}
