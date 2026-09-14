import { toolPrompts } from "./prompts.ts";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { parseDanmaku, type DanmakuInput } from "./danmaku.ts";
export interface RuntimeCapabilities {
  readObservation?: (actionId: string) => Promise<unknown>;
  sendDanmaku?: (input: DanmakuInput) => Promise<unknown>;
  allowedReadRoot?: string;
  prompts?: { main: string; subagent: string };
  readEvidence?: (id: string, part: "ax" | "ocr" | "image") => Promise<any>;
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
    toolPrompts.read_observation,
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
    toolPrompts.send_danmaku,
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
  for (const [name, part, description] of [
    ["get_ax_tree", "ax", toolPrompts.get_ax_tree],
  ] as const)
    tool(
      name,
      description,
      { action_id: { type: "string" } },
      ["action_id"],
      async (args) =>
        capabilities.readEvidence
          ? capabilities.readEvidence((args as any).action_id, part)
          : { status: "unavailable" },
    );
  ctx.tools.register({
    name: "get_annotated_image",
    description: toolPrompts.get_annotated_image,
    parameters: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const evidence = await capabilities.readEvidence?.(
        (args as any).action_id,
        "image",
      );
      if (!evidence?.imageBase64) return evidence ?? { status: "unavailable" };
      const attachment = await ctx.attachments.saveImage({
        data: Buffer.from(evidence.imageBase64, "base64"),
        mediaType: "image/png",
      });
      return {
        status: "available",
        action_id: (args as any).action_id,
        sourceImageHash: evidence.imageHash,
        attachment,
      };
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value: any) => [
        {
          type: "text",
          text: JSON.stringify({ ...value, attachment: undefined }),
        },
        ...(value.attachment
          ? [{ type: "image" as const, attachment: value.attachment }]
          : []),
      ],
    },
  });
  tool(
    "read_file",
    toolPrompts.read_file,
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
      toolPrompts.write_proposal,
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
      toolPrompts.unavailable_provider,
      { query: { type: "string" } },
      ["query"],
      async () => ({
        status: "unavailable",
        reason: "provider_not_configured",
      }),
    );
}
