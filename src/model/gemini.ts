import { GoogleGenAI, type Content, type Part } from "@google/genai";
import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
  type Message,
  type ToolCallBlock,
} from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";

export interface ModelConfig {
  baseUrl?: string;
  protocol?: "gemini" | "openai-compatible";
  apiKey: string;
  model: string;
  maxCalls?: number;
}
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: null;
}
export function usageOf(usage: any): ModelUsage {
  return {
    inputTokens: Math.max(
      0,
      (usage?.promptTokenCount ?? 0) - (usage?.cachedContentTokenCount ?? 0),
    ),
    outputTokens:
      (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
    costUSD: null,
  };
}
export function publicModelError(error: unknown) {
  const value = error as { status?: number; name?: string; message?: string };
  if (/^openai_http_\d+$/.test(value.message ?? "")) return value.message!;
  if (
    [
      "invalid_understanding",
      "empty_model_response",
      "model_call_budget_exhausted",
    ].includes(value.message ?? "")
  )
    return value.message!;
  return value.name === "AbortError"
    ? "model_cancelled"
    : `gemini_request_failed${value.status ? ":" + value.status : ""}`;
}

// Gemini 的原生 thoughtSignature 放在 DSH opaque replay 中，不能丢弃后重造工具历史。
export class GeminiAdapter extends LlmAdapter {
  private client: GoogleGenAI;
  private calls = 0;
  constructor(
    private config: ModelConfig,
    private ctx: Context,
    private emit: (event: Record<string, unknown>) => void,
  ) {
    super();
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: config.baseUrl ? { baseUrl: config.baseUrl } : undefined,
    });
  }
  async contents(messages: Message[]): Promise<Content[]> {
    const calls = new Map<string, ToolCallBlock>();
    const nativeIds = new Map<string, string | undefined>();
    for (const m of messages) {
      for (const b of m.content) if (b.type === "tool-call") calls.set(b.id, b);
      if (m.source.kind === "model") {
        const replay = m.source.replayState as any;
        for (const [key, value] of Object.entries(
          replay?.response?.callIds ?? {},
        ))
          nativeIds.set(key, typeof value === "string" ? value : undefined);
      }
    }
    const contents: Content[] = [];
    for (const message of messages) {
      const parts: Part[] = [];
      const replay =
        message.source.kind === "model"
          ? (message.source.replayState as
              | { response?: { parts?: Part[] } }
              | undefined)
          : undefined;
      if (message.role === "assistant" && replay?.response?.parts)
        parts.push(...replay.response.parts);
      else
        for (const block of message.content) {
          if (block.type === "text") parts.push({ text: block.text });
          if (block.type === "image") {
            const image = await this.ctx.attachments.readImage(
              block.attachment,
            );
            parts.push({
              inlineData: {
                mimeType: image.ref.mediaType,
                data: Buffer.from(image.data).toString("base64"),
              },
            });
          }
          if (block.type === "tool-call")
            parts.push({
              functionCall: {
                id: block.id,
                name: block.name,
                args: JSON.parse(block.arguments),
              },
            });
          if (block.type === "tool-result") {
            const call = calls.get(block.toolCallId);
            if (!call) throw new Error("missing_tool_call");
            parts.push({
              functionResponse: {
                id: nativeIds.get(block.toolCallId),
                name: call.name,
                response: {
                  content: block.content.filter(
                    (part) => part.type !== "image",
                  ),
                  isError: block.isError ?? false,
                },
              },
            });
            for (const part of block.content)
              if (part.type === "image") {
                const image = await this.ctx.attachments.readImage(
                  part.attachment,
                );
                parts.push({
                  inlineData: {
                    mimeType: image.ref.mediaType,
                    data: Buffer.from(image.data).toString("base64"),
                  },
                });
              }
          }
        }
      if (parts.length)
        contents.push({
          role: message.role === "assistant" ? "model" : "user",
          parts,
        });
    }
    return contents;
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (++this.calls > (this.config.maxCalls ?? 30))
      throw new Error("model_call_budget_exhausted");
    this.emit({
      kind: "model.request",
      provider: "gemini",
      model: options.model,
      call: this.calls,
      budget: this.config.maxCalls ?? 30,
    });
    const replayParts: Part[] = [];
    const callIds: Record<string, string | null> = {};
    let index = 0;
    let toolCalls = false;
    let usage: any;
    let stop = "STOP";
    try {
      const stream = await this.client.models.generateContentStream({
        model: options.model,
        contents: await this.contents(options.messages),
        config: {
          systemInstruction: options.system,
          tools: options.tools?.length
            ? [
                {
                  functionDeclarations: options.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ]
            : undefined,
          maxOutputTokens: Math.min(options.maxTokens ?? 2048, 4096),
          abortSignal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        },
      });
      for await (const response of stream) {
        if (options.signal?.aborted)
          throw new DOMException("cancelled", "AbortError");
        usage = response.usageMetadata ?? usage;
        stop = response.candidates?.[0]?.finishReason ?? stop;
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          replayParts.push(part);
          if (part.text && !part.thought) {
            yield { type: "block-start", index, blockType: "text" };
            yield { type: "text-delta", index, text: part.text };
            yield {
              type: "block-end",
              index,
              block: { type: "text", text: part.text },
            };
            index++;
          }
          if (part.functionCall?.name) {
            toolCalls = true;
            const call = part.functionCall;
            const block: ToolCallBlock = {
              type: "tool-call",
              id: ToolCallId(call.id ?? crypto.randomUUID()),
              name: call.name!,
              arguments: JSON.stringify(call.args ?? {}),
            };
            // 原生Part和thoughtSignature原样保留；DSH生成ID只通过旁路映射关联。
            callIds[block.id] = call.id ?? null;
            yield { type: "block-start", index, blockType: "tool-call" };
            yield {
              type: "tool-call-delta",
              index,
              id: block.id,
              name: block.name,
              argumentsDelta: block.arguments,
            };
            yield { type: "block-end", index, block };
            index++;
          }
        }
      }
      if (!index) throw new Error("empty_model_response");
      this.emit({ kind: "model.completed" });
      const counts = usageOf(usage);
      this.emit({
        kind: "model.usage",
        provider: "gemini",
        model: options.model,
        ...counts,
      });
      yield { type: "usage", usage: counts };
      yield {
        type: "finish",
        reason: {
          kind: toolCalls
            ? "tool-calls"
            : stop === "MAX_TOKENS"
              ? "max-tokens"
              : "stop",
        },
        replayState: { response: { parts: replayParts, callIds } },
      };
    } catch (error) {
      this.emit({ kind: "model.error", message: publicModelError(error) });
      throw new Error(publicModelError(error));
    }
  }
}
