/** 将只读取证服务适配为 AI SDK 工具；预算属于单次理解，不共享 Agent 会话。 */
import { tool, jsonSchema, type ToolSet } from "ai";
import { createHash } from "node:crypto";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { EvidenceSession } from "./evidence-session.ts";
import { WebResearch } from "./web-research.ts";
import { understandingToolDescriptions as descriptions } from "../../prompts/agentic-understanding.ts";

/** 每次工具调用的独立追踪，图片以原始动作和哈希索引，不重复存储大字符串。 */
export interface UnderstandingToolTrace {
  toolCallId?: string;
  startedAt?: string;
  status?: "running" | "completed" | "failed";
  name: string;
  input: unknown;
  result?: unknown;
  error?: string;
  elapsedMs: number;
}

/** 为一次理解注册允许的工具和固定预算；未配置搜索时不向模型声明 Web 工具。 */
export function createUnderstandingTools(
  session: EvidenceSession,
  web: WebResearch | undefined,
  traces: UnderstandingToolTrace[],
  changed?: () => Promise<void>,
): ToolSet {
  let calls = 0,
    images = 0;
  const tools: ToolSet = {};
  const add = (
    name: keyof typeof descriptions,
    properties: Record<string, any>,
    required: string[],
    execute: (args: any, signal?: AbortSignal) => Promise<any> | any,
  ) => {
    const schema = {
      type: "object" as const,
      properties,
      required,
      additionalProperties: false,
    };
    tools[name] = tool({
      description: descriptions[name],
      inputSchema: jsonSchema<Record<string, any>>(schema, {
        validate: (value) =>
          validateJsonSchemaValue(schema, value).length
            ? { success: false, error: new Error("invalid_tool_arguments") }
            : { success: true, value: value as Record<string, any> },
      }),
      execute: async (args, options) => {
        const start = Date.now();
        const trace: UnderstandingToolTrace = {
          name,
          input: args,
          toolCallId: options.toolCallId,
          startedAt: new Date(start).toISOString(),
          status: "running",
          elapsedMs: 0,
        };
        traces.push(trace);
        await changed?.();
        try {
          if (++calls > 8)
            throw new Error("understanding_tool_budget_exhausted");
          if (name === "get_action_image" && ++images > 2)
            throw new Error("understanding_image_budget_exhausted");
          options.abortSignal?.throwIfAborted();
          const result = await execute(args, options.abortSignal);
          Object.assign(trace, {
            status: "completed",
            name,
            input: args,
            result: result?.image
              ? {
                  ...result,
                  image: undefined,
                  image_hash: createHash("sha256")
                    .update(result.image)
                    .digest("hex"),
                }
              : result,
            elapsedMs: Date.now() - start,
          });
          return result;
        } catch (error) {
          const code =
            error instanceof Error &&
            /^(action_|web_|understanding_)/.test(error.message)
              ? error.message
              : "evidence_tool_failed";
          Object.assign(trace, {
            status: "failed",
            name,
            input: args,
            error: code,
            elapsedMs: Date.now() - start,
          });
          return { status: "error", reason: code };
        } finally {
          await changed?.();
        }
      },
      toModelOutput: ({ output }: any) =>
        output?.image
          ? {
              type: "content",
              value: [
                {
                  type: "text",
                  text: JSON.stringify({ ...output, image: undefined }),
                },
                {
                  type: "file",
                  data: { type: "data", data: output.image },
                  mediaType: "image/png",
                },
              ],
            }
          : { type: "json", value: output },
    });
  };
  add(
    "list_actions",
    {
      limit: { type: "integer", minimum: 1, maximum: 50 },
      offset: { type: "integer", minimum: 0 },
      app: { type: "string", maxLength: 200 },
      window_id: { type: "integer" },
      since: { type: "string", format: "date-time" },
      before: { type: "string", format: "date-time" },
    },
    [],
    (args) => session.list(args),
  );
  for (const [name, part] of [
    ["get_action_detail", "detail"],
    ["get_action_image", "image"],
    ["get_action_ax", "ax"],
    ["get_action_ocr", "ocr"],
  ] as const)
    add(
      name,
      { action_id: { type: "string", minLength: 1, maxLength: 100 } },
      ["action_id"],
      (args, signal) => session.get(args.action_id, part, signal),
    );
  add(
    "get_app_info",
    { bundle_id: { type: "string", maxLength: 200 } },
    ["bundle_id"],
    (args) => session.appInfo(args.bundle_id),
  );
  if (web?.available()) {
    add(
      "web_search",
      { query: { type: "string", minLength: 1, maxLength: 500 } },
      ["query"],
      (args, signal) => web.search(args.query, signal),
    );
    add(
      "web_fetch",
      {
        url: { type: "string", maxLength: 2000 },
        focus: { type: "string", maxLength: 500 },
      },
      ["url"],
      (args, signal) => web.extract(args.url, args.focus, signal),
    );
  }
  return tools;
}
