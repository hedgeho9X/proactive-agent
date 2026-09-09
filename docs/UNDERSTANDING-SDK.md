# 屏幕理解：Vercel AI SDK

## 调用边界

屏幕理解是独立的一次多模态结构化调用，不是 Agent loop。入口为 `UnderstandingService.summarize`，实际请求采用 AI SDK 的 `generateText` 与 `Output.object`；结果仍为 `action_title`、`action_detail`。

本次锁定版本：`ai@7.0.94`、`@ai-sdk/openai-compatible@3.0.45`、`@ai-sdk/google@4.0.65`。依赖解析结果保存在 `bun.lock`。

- OpenAI-compatible：根地址补 `/v1`，显式版本或代理路径保持不变；使用 chat-completions provider，并开启结构化输出支持。
- Gemini：根地址补 `/v1beta`，显式路径保持不变；使用 Google provider。
- 中文规则放在 `system`，动作、AX、OCR 放在 `user` 文本，实际 PNG 字节使用 AI SDK 7 的 `file` 内容块与 `image/png` 媒体类型。provider 将图片转换为目标 API 的多模态格式。
- 输出上限 1024 tokens，总请求取消信号包含 30 秒超时。`maxRetries: 0`，不在队列之外暗中重试。
- JSON Schema 校验后继续检查非空字符串和原有 80／1200 字符长度上限。

## 不改变的部分

主 Agent／Sub-agent 的 DSH 会话、工具、消息投递与 provider 不变。`@google/genai` 仍用于主子 Agent 的原生 Gemini adapter 及现有连接测试，因此不移除该依赖。

设置里的「测试连接」仍为原有短文本连通性检查，不代表 AI SDK 屏幕理解的图片／结构化输出验收。

模型配置、凭证、Prompt、采集行为和截图要求不变。Dock 归属问题、主 Agent 请求级 DevTools 不在本切片范围。

## 追踪与缓存

继续保存实际 System Prompt、User 文本、图片哈希、输入图片及原始模型文本；增加 `sdk`、`requestSettings`、`finishReason`。结构化输出失败时保留 SDK 提供的模型文本，不记录 HTTP 错误正文、请求头或 API Key。

完成事件只发布轻量摘要，不把 SDK response、完整请求体或证据塞入常驻事件数组。缓存清单版本为 `understanding-v3-ai-sdk`，新请求不会把旧调用层的缓存误当成新 SDK 的请求结果；历史记录不会删除或自动重跑。

## 验证与使用

本机合成 HTTP 服务测试覆盖两种真实 AI SDK provider 的路径、鉴权、图片字节、中文 Prompt、JSON Schema、token／缓存用量，以及 503 不重试、错误脱敏、取消和失败追踪。全量测试同时验证原 DSH 会话与工具链未受影响。

运行 `bun run test`、`bun run typecheck`、`bun run build`。构建成功后退出旧应用，再运行 `bun run desktop` 生效。本次没有自动重启正在运行的采集应用，也没有调用线上付费模型；本地 HTTP 集成测试不等于线上模型验收。

API 依据：[AI SDK 结构化输出](https://ai-sdk.dev/docs/reference/ai-sdk-core/output)。
