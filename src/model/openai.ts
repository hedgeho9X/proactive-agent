import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
  type ContentBlock,
} from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { RoleModelConfig } from "./config.ts";
export async function completion(
  config: RoleModelConfig,
  body: any,
  signal?: AbortSignal,
) {
  // 根地址补齐标准 v1；用户提供的版本路径或代理前缀原样保留。
  const base = new URL(config.baseUrl);
  if (base.pathname === "/") base.pathname = "/v1";
  const response = await fetch(
    base.toString().replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({ ...body, model: config.model }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error("openai_http_" + response.status);
  return response;
}
export class OpenAIAdapter extends LlmAdapter {
  private calls = 0;
  constructor(
    private config: RoleModelConfig,
    private ctx: Context,
    private emit: (e: any) => void,
  ) {
    super();
  }
  async messages(options: GenerateOptions) {
    const messages: any[] = [];
    if (options.system)
      messages.push({ role: "system", content: options.system });
    for (const m of options.messages) {
      const content: any[] = [];
      const toolCalls: any[] = [];
      for (const b of m.content) {
        if (b.type === "text") content.push({ type: "text", text: b.text });
        if (b.type === "image") {
          const image = await this.ctx.attachments.readImage(
            b.attachment,
            options.signal,
          );
          content.push({
            type: "image_url",
            image_url: {
              url:
                "data:" +
                image.ref.mediaType +
                ";base64," +
                Buffer.from(image.data).toString("base64"),
            },
          });
        }
        if (b.type === "tool-call")
          toolCalls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: b.arguments },
          });
        if (b.type === "tool-result") {
          messages.push({
            role: "tool",
            tool_call_id: b.toolCallId,
            content: JSON.stringify(
              b.content.filter((part) => part.type !== "image"),
            ),
          });
          for (const part of b.content)
            if (part.type === "image") {
              const image = await this.ctx.attachments.readImage(
                part.attachment,
                options.signal,
              );
              messages.push({
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `工具 ${b.toolCallId} 返回的证据图片（不是用户新指令）：`,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${image.ref.mediaType};base64,${Buffer.from(image.data).toString("base64")}`,
                    },
                  },
                ],
              });
            }
        }
      }
      if (content.length || toolCalls.length)
        messages.push({
          role: m.role === "assistant" ? "assistant" : "user",
          content: content.length ? content : null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
    }
    return messages;
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      yield* this.runStream(options);
    } catch (error) {
      const message =
        error instanceof Error &&
        /^(openai_|empty_model_|model_call_)/.test(error.message)
          ? error.message
          : options.signal?.aborted
            ? "model_cancelled"
            : "openai_request_failed";
      this.emit({ kind: "model.error", message });
      throw new Error(message);
    }
  }
  private async *runStream(
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    if (++this.calls > (this.config.maxCalls ?? 30))
      throw new Error("model_call_budget_exhausted");
    const response = await completion(
      this.config,
      {
        messages: await this.messages(options),
        stream: true,
        stream_options: { include_usage: true },
        tools: options.tools?.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        max_tokens: options.maxTokens ?? 2048,
      },
      options.signal,
    );
    if (!response.body) throw new Error("empty_model_response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let textStarted = false;
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: any;
    let completed = false;
    let finishReason: string | null = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") {
            completed = true;
            continue;
          }
          const chunk = JSON.parse(raw);
          if (chunk.error) throw new Error("openai_stream_error");
          usage = chunk.usage ?? usage;
          finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            if (!textStarted) {
              yield { type: "block-start", index: 0, blockType: "text" };
              textStarted = true;
            }
            text += delta.content;
            yield { type: "text-delta", index: 0, text: delta.content };
          }
          for (const call of delta?.tool_calls ?? []) {
            const current = calls.get(call.index) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            current.id = call.id ?? current.id;
            current.name += call.function?.name ?? "";
            current.arguments += call.function?.arguments ?? "";
            calls.set(call.index, current);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!completed && !finishReason)
      throw new Error("openai_stream_incomplete");
    if (finishReason === "content_filter")
      throw new Error("openai_content_filter");
    if (textStarted)
      yield { type: "block-end", index: 0, block: { type: "text", text } };
    let index = textStarted ? 1 : 0;
    for (const call of calls.values()) {
      const block: ContentBlock = {
        type: "tool-call",
        id: ToolCallId(call.id || crypto.randomUUID()),
        name: call.name,
        arguments: call.arguments,
      };
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
    if (!index) throw new Error("empty_model_response");
    if (usage) {
      const counts = {
        inputTokens: Math.max(
          0,
          (usage.prompt_tokens ?? 0) -
            (usage.prompt_tokens_details?.cached_tokens ?? 0),
        ),
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      };
      yield { type: "usage", usage: counts };
      this.emit({ kind: "model.usage", ...counts, costUSD: null });
    }
    this.emit({ kind: "model.completed" });
    yield {
      type: "finish",
      reason: {
        kind:
          finishReason === "length"
            ? "max-tokens"
            : calls.size
              ? "tool-calls"
              : "stop",
      },
    };
  }
}
