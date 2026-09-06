import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
export interface RuntimeCapabilities {
  readObservation?: (actionId: string) => Promise<unknown>;
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
