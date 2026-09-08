import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { parseDanmaku, type DanmakuInput } from "./danmaku.ts";
export interface RuntimeCapabilities {
  readObservation?: (actionId: string) => Promise<unknown>;
  sendDanmaku?: (input: DanmakuInput) => Promise<unknown>;
  allowedReadRoot?: string;
}
// 以真实路径检查阻断 ../ 与符号链接逃逸；只读用户明确选定的小文件。
export async function readConfinedFile(root: string, path: string) {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("path_outside_allowed_root");
  const info = await stat(target);
  if (!info.isFile() || info.size > 128_000)
    throw new Error("file_size_or_type_rejected");
  return {
    path: rel,
    content: await readFile(target, "utf8"),
    bytes: info.size,
  };
}
export function registerCapabilities(
  ctx: Context,
  capabilities: RuntimeCapabilities,
  emit: (event: Record<string, unknown>) => void,
  validateProposal?: (agentId: string | undefined, args: any) => void,
) {
  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    execute: ToolDefinition["execute"],
    outputSchema: ToolDefinition["output"]["schema"] = {
      type: "object",
      additionalProperties: true,
    },
  ) =>
    ctx.tools.register({
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
      output: {
        schema: outputSchema,
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      execute,
    });
  tool(
    "read_observation",
    "读取已捕获action的AX/OCR/截图元数据；不是操作桌面",
    { action_id: { type: "string" } },
    ["action_id"],
    async (args) => {
      if (!capabilities.readObservation)
        throw new Error("observation_store_unavailable");
      return capabilities.readObservation((args as any).action_id);
    },
  );
  tool(
    "send_danmaku",
    "在用户桌面显示一条从右向左飘过的短提醒，不抢焦点。仅在确有价值时调用，不要复述每个操作；限频或禁用时不要立即重试。只有返回 shown 才代表已展示。",
    {
      text: { type: "string", minLength: 1, maxLength: 80 },
      duration_seconds: { type: "number", minimum: 4, maximum: 12 },
    },
    ["text"],
    async (args) => {
      const input = parseDanmaku(args);
      if (!capabilities.sendDanmaku)
        return { status: "unavailable", reason: "desktop_not_connected" };
      const result = await capabilities.sendDanmaku(input);
      emit({ kind: "danmaku.result", result });
      return result;
    },
  );
  tool(
    "read_file",
    "读取用户选择的测试目录内文件，最多128KB",
    { path: { type: "string" } },
    ["path"],
    async (args) => {
      if (!capabilities.allowedReadRoot)
        throw new Error("read_root_unavailable");
      return readConfinedFile(capabilities.allowedReadRoot, (args as any).path);
    },
  );
  for (const operation of [
    "calendar_create",
    "calendar_update",
    "calendar_delete",
    "file_write",
    "file_edit",
    "memory_write",
  ]) {
    tool(
      operation,
      "仅生成操作提案，不执行外部写入",
      {
        target: { type: "string" },
        content: { type: "string" },
        evidence_action_ids: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
        taskId: { type: "string" },
        revision: { type: "integer" },
      },
      ["target", "content", "evidence_action_ids", "reason"],
      async (args, exec) => {
        validateProposal?.(exec.agent?.id, args);
        const proposal = {
          proposalId: crypto.randomUUID(),
          operation,
          ...(args as object),
          status: "not_executed",
        };
        emit({ kind: "proposal", proposal });
        return proposal;
      },
      {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          operation: { type: "string", enum: [operation] },
          target: { type: "string" },
          content: { type: "string" },
          evidence_action_ids: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          taskId: { type: "string" },
          revision: { type: "integer" },
          status: { type: "string", enum: ["not_executed"] },
        },
        required: [
          "proposalId",
          "operation",
          "target",
          "content",
          "evidence_action_ids",
          "reason",
          "status",
        ],
        additionalProperties: false,
      },
    );
  }
  for (const name of [
    "calendar_list",
    "calendar_get",
    "web_search",
    "web_fetch",
  ])
    tool(
      name,
      "外部provider尚未配置，返回unavailable，不伪造结果",
      { query: { type: "string" } },
      ["query"],
      async () => ({
        status: "unavailable",
        reason: "provider_not_configured",
      }),
    );
}
