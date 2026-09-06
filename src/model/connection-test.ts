import { GoogleGenAI } from "@google/genai";
import { completion } from "./openai.ts";
import type { RoleModelConfig } from "./config.ts";

// 仅发送固定短文本，验证鉴权、模型路由和非空生成，不上传观察内容。
export async function testModelConnection(config?: RoleModelConfig) {
  const started = performance.now();
  if (!config?.apiKey || !config.model?.trim())
    return { ok: false, elapsedMs: 0, error: "请先保存 Model ID 和 API Key" };
  try {
    let text: string | undefined;
    if (config.protocol === "openai-compatible") {
      const response = await completion(config, {
        messages: [{ role: "user", content: "Reply with OK only." }],
        stream: false,
        max_completion_tokens: 256,
      });
      const body = await response.json();
      text = body.choices?.[0]?.message?.content;
    } else {
      const client = new GoogleGenAI({
        apiKey: config.apiKey,
        httpOptions: { baseUrl: config.baseUrl, timeout: 30000 },
      });
      const response = await client.models.generateContent({
        model: config.model,
        contents: "Reply with OK only.",
        config: { maxOutputTokens: 256 },
      });
      text = response.text;
    }
    if (typeof text !== "string" || !text.trim())
      throw new Error("empty_model_response");
    return { ok: true, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    // 不返回上游正文或原始错误，避免供应商响应暴露请求凭证。
    const value = error as { name?: string; message?: string; status?: number };
    const status =
      /^openai_http_(\d+)$/.exec(value.message ?? "")?.[1] ??
      (typeof value.status === "number" ? String(value.status) : undefined);
    const message = status
      ? `请求失败（HTTP ${status}），请检查密钥、模型权限和接口地址`
      : value.message === "empty_model_response"
        ? "接口未返回有效文本，请检查模型或输出额度"
        : value.name === "TimeoutError" || value.name === "AbortError"
          ? "请求超时，请重试"
          : "请求失败，请检查网络及协议配置";
    return {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: message,
    };
  }
}
