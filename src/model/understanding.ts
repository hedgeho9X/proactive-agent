/** 屏幕事实理解与有限只读取证循环；不维护主 Agent 会话或执行业务工具。 */
import {
  generateText,
  Output,
  jsonSchema,
  NoObjectGeneratedError,
  APICallError,
  isStepCount,
} from "ai";
import {
  EvidenceSession,
  type EvidenceRow,
} from "../understanding/evidence-session.ts";
import { WebResearch } from "../understanding/web-research.ts";
import {
  createUnderstandingTools,
  type UnderstandingToolTrace,
} from "../understanding/tools.ts";
import { traceValue } from "../understanding/trace-value.ts";
import { agenticInstructions } from "../../prompts/agentic-understanding.ts";
import { xmlData } from "../../prompts/xml.ts";
import { understandingModel } from "./understanding-provider.ts";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  validateJsonSchemaValue,
  type ToolDefinition,
} from "@deepseek-ai/dsh-tools";
import { usageOf, type ModelConfig } from "./gemini.ts";
import { defaultPrompts } from "./prompts.ts";
import { resolveAppInfo } from "./app-info.ts";
import { buildUserPrompt } from "../../prompts/understanding.ts";
export { actionHint } from "../../prompts/understanding.ts";

/** 提取模板变量，不包含图片字节；同一组变量用于请求、缓存及追踪。 */
function promptVariables(input: UnderstandingInput) {
  return {
    action: input.action,
    app_info: resolveAppInfo(
      input.action.app as { bundle_id?: unknown; name?: unknown } | undefined,
    ),
    evidence: input.evidence,
    axTree: input.artifacts.ax?.payload?.content ?? null,
    focusTitle: input.artifacts.ax?.payload?.content?.focus_title ?? null,
    ocr: input.artifacts.ocr?.payload?.content ?? null,
    screenshot: input.artifacts.screenshot?.payload?.content ?? null,
    view: input.view,
  };
}
/** 将实际历史快照附加到请求正文，缓存与追踪使用相同渲染结果。 */
function understandingPrompt(input: UnderstandingInput): string {
  return (
    buildUserPrompt(promptVariables(input)) +
    (input.history
      ? `\n<history_titles>\n${xmlData(input.history)}\n</history_titles>`
      : "")
  );
}
/** 单次动作及其关联证据；view 决定传入模型的 AX 视图。 */
export interface UnderstandingInput {
  action: Record<string, unknown>;
  revision: number;
  evidence: unknown[];
  artifacts: Record<string, any>;
  view: "raw" | "context";
  history?: EvidenceRow[];
}
/** 供 provider 请求和本地校验共用的动作描述输出契约。 */
export const understandingSchema: ToolDefinition["output"]["schema"] = {
  type: "object",
  properties: {
    action_title: { type: "string" },
    action_detail: { type: "string" },
  },
  required: ["action_title", "action_detail"],
  additionalProperties: false,
};
/** 对键顺序归一化，生成稳定的缓存哈希输入。 */
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
/** 选择当前证据视图，不把未声明的前置截图发送给模型。 */
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
  // 模型只接收当前截图，防止将两帧误解为同一时刻。
  delete artifacts.screenshot_before;
  return { ...input, artifacts };
}
/** 构建包含模型、Prompt 和证据哈希的缓存清单，不保存凭证。 */
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
    schema: "understanding-v4-role-template",
    prompt_version: 3,
    prompt,
    userPrompt: understandingPrompt(input),
    model,
    ...input,
    artifacts,
  };
  return {
    manifest,
    hash: createHash("sha256").update(canonical(manifest)).digest("hex"),
  };
}
/** 管理独立理解请求及落盘追踪，相同上下文并发调用共享同一请求。 */
export class UnderstandingService {
  private controller = new AbortController();
  /** 取消本服务内所有在途请求。 */
  abort() {
    this.controller.abort();
  }
  /** 取消请求并等待其退出，避免关闭后继续写缓存。 */
  async close() {
    this.abort();
    await Promise.allSettled([...this.active.values()]);
  }
  private active = new Map<string, Promise<unknown>>();
  private traceWrites = new Map<string, Promise<void>>();

  /** cacheDir 为本应用私有目录；emit 只发布轻量状态。 */
  constructor(
    private cacheDir: string,
    private emit: (event: Record<string, unknown>) => void,
    private capabilities?: {
      createSession: (input: UnderstandingInput) => Promise<EvidenceSession>;
      web?: WebResearch;
    },
  ) {}
  /** 从缓存或 AI SDK 获取结构化描述，必须存在截图。 */
  async summarize(
    input: UnderstandingInput,
    config: ModelConfig,
    prompt = defaultPrompts.understanding,
  ) {
    if (!input.artifacts.screenshot?.bytes)
      throw new Error("screenshot_required");
    input = projectUnderstanding(input);
    const context = await this.capabilities?.createSession(input);
    if (context) input = { ...input, history: context.initial() };
    if (context) prompt = `${prompt}\n\n${agenticInstructions}`;
    const { manifest, hash } = inputManifest(
      input,
      JSON.stringify({
        protocol: config.protocol ?? "gemini",
        baseUrl: config.baseUrl ?? "https://generativelanguage.googleapis.com",
        model: config.model,
      }),
      prompt,
    );
    const cached = context
      ? null
      : await readFile(join(this.cacheDir, hash + ".json"), "utf8")
          .then(JSON.parse)
          .catch(() => null);
    if (cached) {
      await this.saveTrace(String(input.action.action_id), cached.debug);
      return { ...cached, cached: true };
    }
    if (this.active.has(hash)) return this.active.get(hash)!;
    const work = this.run(input, config, manifest, hash, prompt, context);
    this.active.set(hash, work);
    try {
      return await work;
    } finally {
      this.active.delete(hash);
    }
  }
  /** 运行单次理解，可按需补证，并保存按 Action ID 查询的模型步骤。 */
  private async run(
    input: UnderstandingInput,
    config: ModelConfig,
    manifest: unknown,
    hash: string,
    prompt: string,
    context?: EvidenceSession,
  ) {
    const promptInput = promptVariables(input);
    const userPrompt = understandingPrompt(input);
    const screenshot = input.artifacts.screenshot;
    const began = Date.now();
    const debug: any = {
      status: "running",
      actionId: input.action.action_id,
      systemPrompt: prompt,
      userPrompt,
      promptInput,
      schema: understandingSchema,
      model: config.model,
      protocol: config.protocol ?? "gemini",
      sdk: "vercel-ai-sdk",
      requestSettings: { outputTokenLimit: "provider_default", maxRetries: 0 },
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
    const toolTraces: UnderstandingToolTrace[] = [];
    const tools = context
      ? createUnderstandingTools(
          context,
          this.capabilities?.web,
          toolTraces,
          () => this.saveTrace(String(input.action.action_id), debug),
          () => debug.steps.at(-1)?.step,
        )
      : undefined;
    debug.tools = tools ? Object.keys(tools) : [];
    debug.toolCalls = toolTraces;
    debug.steps = [];
    if (context)
      Object.assign(debug.requestSettings, {
        maxSteps: 4,
        maxToolCalls: 8,
        maxImages: 2,
        timeoutMs: 60000,
      });
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
      const response = await generateText({
        model: understandingModel(config),
        system: prompt,
        tools,
        stopWhen: isStepCount(context ? 4 : 1),
        prepareStep: context
          ? async ({ stepNumber, messages }) => {
              debug.steps.push({
                step: stepNumber + 1,
                startedAt: new Date().toISOString(),
                status: "running",
                messages: traceValue(messages),
              });
              await this.saveTrace(String(input.action.action_id), debug);
              return {
                toolChoice:
                  stepNumber >= 3 ? ("none" as const) : ("auto" as const),
              };
            }
          : undefined,
        onStepEnd: context
          ? async (step) => {
              const current = debug.steps.at(-1);
              Object.assign(current, {
                status: step.finishReason === "length" ? "failed" : "completed",
                elapsedMs: Date.now() - Date.parse(current.startedAt),
                text: step.text,
                finishReason: step.finishReason,
                usage: step.usage,
                toolCalls: traceValue(step.toolCalls),
                toolResults: traceValue(step.toolResults),
              });
              await this.saveTrace(String(input.action.action_id), debug);
            }
          : undefined,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "file",
                data: Buffer.from(screenshot.bytes, "base64"),
                mediaType: "image/png",
              },
            ],
          },
        ],
        output: Output.object({
          name: "screen_understanding",
          schema: jsonSchema<{ action_title: string; action_detail: string }>(
            understandingSchema,
            {
              validate: (value) =>
                validateJsonSchemaValue(understandingSchema, value).length
                  ? {
                      success: false,
                      error: new Error("invalid_understanding"),
                    }
                  : {
                      success: true,
                      value: value as {
                        action_title: string;
                        action_detail: string;
                      },
                    },
            },
          ),
        }),
        // 队列负责显式重试；SDK 不得隐式增加计费请求次数。
        maxRetries: 0,
        abortSignal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(context ? 60000 : 30000),
        ]),
      });
      debug.rawOutput = response.text.slice(0, 64000);
      debug.finishReason = response.finishReason;
      debug.usage = response.totalUsage;
      if (response.finishReason === "length")
        throw new Error("understanding_output_truncated");
      const result = response.output;
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
        app_info: promptInput.app_info,
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
        usage: usageOf({
          promptTokenCount: response.totalUsage.inputTokens,
          cachedContentTokenCount:
            response.totalUsage.inputTokenDetails?.cacheReadTokens,
          candidatesTokenCount: response.totalUsage.outputTokens,
          totalTokenCount: response.totalUsage.totalTokens,
        }),
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
        // 高频事件总线只发布轻量摘要；完整输入留在 trace/SQLite 按 ID 读取。
        result,
        model: record.model,
        model_role: record.model_role,
        created_at: record.created_at,
        usage: record.usage,
        input_manifest_hash: hash,
        elapsedMs: record.debug.elapsedMs,
      });
      return record;
    } catch (error) {
      const pendingStep = debug.steps.at(-1);
      if (pendingStep?.status === "running")
        Object.assign(pendingStep, {
          status: "failed",
          elapsedMs: Date.now() - Date.parse(pendingStep.startedAt),
        });
      if (NoObjectGeneratedError.isInstance(error)) {
        debug.rawOutput = error.text?.slice(0, 64000);
        debug.finishReason = error.finishReason;
      }
      const message = this.controller.signal.aborted
        ? "model_cancelled"
        : debug.finishReason === "length"
          ? "understanding_output_truncated"
          : APICallError.isInstance(error)
            ? `understanding_http_${error.statusCode ?? "unknown"}`
            : NoObjectGeneratedError.isInstance(error)
              ? "invalid_understanding"
              : error instanceof SyntaxError
                ? "invalid_understanding_json"
                : error instanceof Error &&
                    error.message === "invalid_understanding"
                  ? error.message
                  : error instanceof Error && error.name === "TimeoutError"
                    ? "understanding_request_timeout"
                    : "understanding_request_failed";
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
  /** 将动作 ID 映射为固定格式文件名，避免路径注入。 */
  private traceFile(id: string) {
    return join(
      this.cacheDir,
      "trace-" + createHash("sha256").update(id).digest("hex") + ".json",
    );
  }
  /** 保存私有追踪文件，不通过状态事件传输完整输入。 */
  private async saveTrace(id: string, debug: unknown) {
    const data = JSON.stringify(debug);
    const work = (this.traceWrites.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(this.cacheDir, { recursive: true });
        const file = this.traceFile(id);
        await writeFile(file + ".tmp", data, { mode: 0o600 });
        await rename(file + ".tmp", file);
      });
    this.traceWrites.set(id, work);
    try {
      await work;
    } finally {
      if (this.traceWrites.get(id) === work) this.traceWrites.delete(id);
    }
  }
  /** 按需读取一次理解的完整追踪与图片，图片过期时返回空值。 */
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
