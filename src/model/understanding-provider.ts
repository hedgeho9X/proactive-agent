/** 屏幕理解的 AI SDK provider 选择与地址归一化；不管理 Agent 会话或持久化凭证。 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelConfig } from "./gemini.ts";

/** 将现有角色配置映射为 AI SDK 模型；凭证仅通过 provider 配置传递。 */
export function understandingModel(config: ModelConfig) {
  if (!config.apiKey || !config.model.trim())
    throw new Error("understanding_model_unavailable");
  const compatible = config.protocol === "openai-compatible";
  if (compatible && !config.baseUrl)
    throw new Error("understanding_base_url_required");
  const url = new URL(
    config.baseUrl || "https://generativelanguage.googleapis.com",
  );
  if (url.pathname === "/") url.pathname = compatible ? "/v1" : "/v1beta";
  const baseURL = url.toString().replace(/\/$/, "");
  return compatible
    ? createOpenAICompatible({
        name: "proactive-understanding",
        baseURL,
        apiKey: config.apiKey,
        supportsStructuredOutputs: true,
      }).chatModel(config.model)
    : createGoogleGenerativeAI({ baseURL, apiKey: config.apiKey })(
        config.model,
      );
}
