import { Context } from "@deepseek-ai/cordis";
import Llm, {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  type ContentBlock,
  ToolCallId,
  MessageId,
} from "@deepseek-ai/dsh-llm";
import Sessions, { SessionId } from "@deepseek-ai/dsh-session";
import Agents, { type AgentHandle } from "@deepseek-ai/dsh-agent";
import Loop from "@deepseek-ai/dsh-agent-loop";
import Tools, {
  type ToolDefinition,
  validateJsonSchemaValue,
} from "@deepseek-ai/dsh-tools";
import Prompt from "@deepseek-ai/dsh-system-prompt";
import Projections from "@deepseek-ai/dsh-session-projection";
import Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import Attachments from "@deepseek-ai/dsh-attachment-local";
import Subagents from "@deepseek-ai/dsh-subagent";
import * as Spawn from "@deepseek-ai/dsh-subagent-spawn-in-process";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export type Emit = (event: Record<string, unknown>) => void;
export interface Task {
  taskId: string;
  childId?: string;
  revision: number;
  target: string;
  status: string;
}
export const proposalSchema: ToolDefinition["output"]["schema"] = {
  type: "object",
  properties: {
    proposalId: { type: "string" },
    taskId: { type: "string" },
    revision: { type: "integer" },
    operation: { type: "string", enum: ["calendar.update"] },
    target: { type: "string" },
    status: { type: "string", enum: ["not_executed"] },
  },
  required: [
    "proposalId",
    "taskId",
    "revision",
    "operation",
    "target",
    "status",
  ],
  additionalProperties: false,
};
const objectSchema = { type: "object", additionalProperties: true } as const;
const text = (value: unknown): ContentBlock[] => [
  { type: "text", text: JSON.stringify(value) },
];

// 合成模型仅用于验证真实 DSH 的编排语义；它不是视觉理解或线上模型。
class FixtureAdapter extends LlmAdapter {
  constructor(
    private emit: Emit,
    private ctx: Context,
  ) {
    super();
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.emit({
      kind: "fixture.request",
      messages: options.messages,
      tools: options.tools,
    });
    for (const message of options.messages)
      for (const block of message.content)
        if (block.type === "image") {
          const stored = await this.ctx.attachments.readImage(
            block.attachment,
            options.signal,
          );
          this.emit({
            kind: "fixture.image",
            messageId: message.id,
            attachment: block.attachment,
            verifiedBytes: stored.data.length,
          });
        }
    const last = options.messages
      .filter(
        (message) =>
          !(
            message.source.kind === "plugin" &&
            message.source.plugin === "@deepseek-ai/dsh-system-prompt"
          ),
      )
      .at(-1);
    let command: Record<string, unknown> = {};
    // DSH 的跨代理消息会增加来源说明，fixture 只解析独立 JSON 内容块。
    for (const block of [...(last?.content ?? [])].reverse()) {
      if (block.type !== "text") continue;
      try {
        command = JSON.parse(block.text);
        break;
      } catch {
        /* 保留来源说明。 */
      }
    }
    let name: string | undefined;
    let args: Record<string, unknown> = {};
    if (last?.source.kind !== "tool") {
      if (command.scenario === "dispatch") {
        name = "delegate";
        args = { taskId: command.taskId, target: command.target };
      }
      if (command.scenario === "work") {
        name = "controlled_delay";
        args = { taskId: command.taskId };
      }
      if (command.scenario === "revise") {
        name = "calendar_update_proposal";
        args = {
          taskId: command.taskId,
          revision: command.revision,
          target: command.target,
        };
      }
    }
    if (name) {
      const block = {
        type: "tool-call" as const,
        id: ToolCallId(crypto.randomUUID()),
        name,
        arguments: JSON.stringify(args),
      };
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield {
        type: "tool-call-delta",
        index: 0,
        id: block.id,
        name,
        argumentsDelta: block.arguments,
      };
      yield { type: "block-end", index: 0, block };
      yield { type: "finish", reason: { kind: "tool-calls" } };
    } else {
      const value =
        last?.source.kind === "tool"
          ? "[deterministic fixture] 工具结果已进入模型上下文"
          : command.scenario === "observation"
            ? "[deterministic fixture] 合成观察已读取"
            : "[deterministic fixture] 无匹配情景；未执行操作";
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: value };
      yield {
        type: "block-end",
        index: 0,
        block: { type: "text", text: value },
      };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
}

// 固定内置 bridge 只编排公开原子；所有模型循环由 DSH agent-loop 负责。
export class ProactiveRuntime {
  readonly ctx = new Context();
  readonly tasks = new Map<string, Task>();
  readonly proposals: unknown[] = [];
  private owner!: AgentHandle;
  private closed = false;
  private deliveries = new Map<
    string,
    Promise<{ messageId: string; status: string; sessionId?: string }>
  >();
  private readonly sessionId = SessionId("proactive-main");
  constructor(
    readonly root: string,
    private emit: Emit,
    readonly delayMs = 20_000,
  ) {}
  async start(resume = false) {
    await mkdir(this.root, { recursive: true });
    for (const plugin of [Llm, Sessions, Agents, Tools, Prompt, Projections])
      await this.ctx.plugin(plugin);
    await this.ctx.plugin(Persistence, {
      root: this.root + "/sessions",
      compression: "none",
      packChunks: false,
    });
    await this.ctx.plugin(Attachments, { dshHome: this.root });
    await this.ctx.plugin(Loop, { agents: [] });
    await this.ctx.plugin(Subagents);
    await this.ctx.plugin(Spawn);
    const bridge = this;
    await this.ctx.plugin({
      name: "proactive-bridge",
      inject: ["llm", "tools", "subagents", "attachments"],
      apply(ctx: Context) {
        ctx.llm.registerAdapter(
          ["fixture"],
          new FixtureAdapter(bridge.emit, ctx),
        );
        ctx.on("session/event", (session, event) =>
          bridge.emit({
            kind: "session.event",
            sessionId: session.id,
            event,
            durability: "pending_flush",
          }),
        );
        ctx.on("agent/status", ({ agent, status }) =>
          bridge.emit({ kind: "agent.status", sessionId: agent.id, status }),
        );
        bridge.registerTools(ctx);
      },
    });
    const agentOptions = { provider: "fixture", model: "deterministic-v1" };
    this.owner = resume
      ? await this.ctx.agents.resume({
          resumeSessionId: this.sessionId,
          agentOptions,
        })
      : await this.ctx.agents.create({
          sessionId: this.sessionId,
          meta: { cwd: process.cwd() },
          agentOptions,
        });
    return {
      sessionId: this.sessionId,
      mode: "deterministic_fixture",
      liveModel: "unavailable",
    };
  }
  private registerTools(ctx: Context) {
    const register = (
      name: string,
      parameters: ToolDefinition["parameters"],
      execute: ToolDefinition["execute"],
      schema: ToolDefinition["output"]["schema"] = objectSchema,
    ) =>
      ctx.tools.register({
        name,
        description: name,
        parameters,
        execute,
        output: { schema, render: (_args, value) => text(value) },
      });
    register(
      "delegate",
      {
        type: "object",
        properties: {
          scenario: { type: "string" },
          taskId: { type: "string" },
          target: { type: "string" },
        },
        required: ["taskId", "target"],
        additionalProperties: false,
      },
      async (raw, exec) => {
        const args = raw as { taskId: string; target: string };
        if (!exec.agent) throw new Error("missing_agent");
        if (this.tasks.has(args.taskId)) throw new Error("duplicate_task");
        const task: Task = {
          taskId: args.taskId,
          revision: 1,
          target: args.target,
          status: "starting",
        };
        this.tasks.set(task.taskId, task);
        const started = await ctx.subagents.startContinuable({
          provider: "spawn",
          label: args.taskId,
          request: {
            parent: exec.agent,
            prompt: text({
              scenario: "work",
              taskId: task.taskId,
              target: task.target,
            }),
            maxDepth: 1,
          },
          signal: exec.signal,
        });
        Object.assign(task, { childId: started.childId, status: "running" });
        this.emit({
          kind: "task.started",
          ...task,
          messageId: started.messageId,
        });
        return {
          kind: "continuable",
          subagentId: started.childId,
          messageId: started.messageId,
        };
      },
    );
    register(
      "controlled_delay",
      {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false,
      },
      async (raw, exec) => {
        const args = raw as { taskId: string };
        this.emit({
          kind: "tool.delay.started",
          taskId: args.taskId,
          delayMs: this.delayMs,
        });
        try {
          await delay(this.delayMs, undefined, { signal: exec.signal });
        } finally {
          this.emit({
            kind: "tool.delay.stopped",
            taskId: args.taskId,
            aborted: exec.signal.aborted,
          });
        }
        return { status: "completed", taskId: args.taskId };
      },
    );
    register(
      "calendar_update_proposal",
      {
        type: "object",
        properties: {
          taskId: { type: "string" },
          revision: { type: "integer" },
          target: { type: "string" },
        },
        required: ["taskId", "revision", "target"],
        additionalProperties: false,
      },
      async (raw) => {
        const args = raw as {
          taskId: string;
          revision: number;
          target: string;
        };
        const task = this.tasks.get(args.taskId);
        if (
          !task ||
          task.revision !== args.revision ||
          task.target !== args.target ||
          task.status === "cancelling" ||
          task.status === "stopped"
        )
          throw new Error("superseded_task");
        const proposal = {
          proposalId: crypto.randomUUID(),
          ...args,
          operation: "calendar.update",
          status: "not_executed",
        };
        if (validateJsonSchemaValue(proposalSchema, proposal).length)
          throw new Error("invalid_proposal");
        this.proposals.push(proposal);
        this.emit({ kind: "proposal", proposal });
        return proposal;
      },
      proposalSchema,
    );
  }
  // 同一 action 的并发重试共享首次持久入队，失败后允许重试。
  async observe(
    actionId: string,
    value: Record<string, unknown>,
    imageBase64?: string,
  ) {
    const existing = this.deliveries.get(actionId);
    if (existing) {
      const receipt = await existing;
      return { ...receipt, status: "duplicate" };
    }
    const delivery = this.deliver(actionId, value, imageBase64);
    this.deliveries.set(actionId, delivery);
    try {
      return await delivery;
    } finally {
      this.deliveries.delete(actionId);
    }
  }
  private async deliver(
    actionId: string,
    value: Record<string, unknown>,
    imageBase64?: string,
  ) {
    if (this.closed) throw new Error("runtime_closed");
    const id = MessageId("action:" + actionId);
    // DSH 原生日志包含 inbox 入队与领取记录，恢复后仍使用同一去重键。
    if (
      this.owner.agent.session
        .snapshotEvents()
        .some(
          (e) =>
            (e.type === "user/message" && e.data.id === id) ||
            (e.type === "agent/inbox/spliced" &&
              e.data.inserted.some((message) => message.id === id)),
        )
    )
      return { messageId: id, status: "duplicate" };
    const content = text({ ...value, actionId });
    if (imageBase64)
      content.push({
        type: "image",
        attachment: await this.ctx.attachments.saveImage({
          data: Buffer.from(imageBase64, "base64"),
          mediaType: "image/png",
        }),
      });
    this.owner.agent.followup({
      id,
      role: "user",
      source: { kind: "plugin", plugin: "proactive-bridge" },
      content,
    });
    await this.flush();
    return { messageId: id, status: "persisted", sessionId: this.sessionId };
  }
  async revise(taskId: string, target: string) {
    const task = this.tasks.get(taskId);
    if (
      !task?.childId ||
      task.status === "stopped" ||
      task.status === "cancelling"
    )
      throw new Error("task_unavailable");
    task.revision++;
    task.target = target;
    const messageId = await this.ctx.subagents.sendMessage(
      this.owner.agent,
      SessionId(task.childId),
      text({ scenario: "revise", taskId, revision: task.revision, target }),
      { signal: new AbortController().signal },
    );
    return { messageId, ...task };
  }
  async cancel(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task?.childId) throw new Error("task_unavailable");
    task.status = "cancelling";
    this.emit({ kind: "task.cancelling", ...task });
    const child = this.ctx.agents.get(SessionId(task.childId));
    this.ctx.subagents.interrupt(SessionId(task.childId), {
      kind: "ancestor",
      agent: this.owner.agent,
    });
    await child?.whenIdle();
    task.status = "stopped";
    this.emit({ kind: "task.stopped", ...task });
    return { ...task };
  }
  async idle(sessionId = this.sessionId) {
    await this.ctx.agents.get(SessionId(sessionId))?.whenIdle();
    await this.flush();
  }
  async flush() {
    for (const agent of this.ctx.agents.list()) {
      const throughSeq = agent.session.snapshotEvents().at(-1)?.seq ?? -1;
      if (!(await this.ctx.sessions.flush(agent.session)))
        throw new Error("persistence_unavailable");
      this.emit({ kind: "session.flushed", sessionId: agent.id, throughSeq });
    }
  }
  events(cursors: Record<string, number> = {}) {
    return [...this.ctx.agents.list()].flatMap((agent) =>
      agent.session
        .snapshotEvents()
        .filter((e) => e.seq > (cursors[agent.id] ?? -1))
        .map((event) => ({ sessionId: agent.id, event })),
    );
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.owner?.dispose();
    await this.ctx.fiber.dispose();
  }
}
