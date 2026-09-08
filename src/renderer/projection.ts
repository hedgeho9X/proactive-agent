export interface StreamRow {
  id: string;
  time: string;
  timestamp?: number;
  label: string;
  text: string;
  kind: string;
  detail: any;
  live?: boolean;
  sessionId?: string;
  parentSessionId?: string;
  children?: StreamRow[];
  status?: string;
  actionId?: string;
  fixture?: boolean;
}
export function preciseTime(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return (
    [date.getMonth() + 1, date.getDate()]
      .map((x) => String(x).padStart(2, "0"))
      .join("-") +
    " " +
    [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((x) => String(x).padStart(2, "0"))
      .join(":") +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}
// 列表只取可读事实；原始嵌套结构留给右侧检查器。
export function concise(value: unknown): string {
  if (typeof value === "string") {
    try {
      return concise(JSON.parse(value));
    } catch {
      return value.replace(/\s+/g, " ").trim().slice(0, 240);
    }
  }
  if (Array.isArray(value))
    return value.map(concise).filter(Boolean).join(" · ").slice(0, 240);
  if (!value || typeof value !== "object")
    return value == null ? "" : String(value);
  const item = value as Record<string, any>;
  for (const key of [
    "action_title",
    "statement",
    "understanding",
    "result",
    "text",
    "instruction",
    "message",
    "target",
    "status",
  ])
    if (item[key] != null) {
      const text = concise(item[key]);
      if (text) return text;
    }
  if (item.content) return concise(item.content);
  if (item.observation) return concise(item.observation);
  if (item.kind) return String(item.kind);
  return "结构化数据";
}
// 工具状态从协议字段判定，不能依赖用于展示的摘要文字。
export function toolOutcome(
  message: any,
): "not_executed" | "failed" | "completed" {
  if (message?.isError || message?.error) return "failed";
  let proposal = false;
  let failure = false;
  const inspect = (value: any): void => {
    if (typeof value === "string") {
      try {
        inspect(JSON.parse(value));
      } catch {}
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (
      value.isError === true ||
      ["failed", "unavailable", "error"].includes(value.status) ||
      value.execution_status === "failed"
    )
      failure = true;
    if (
      value.status === "not_executed" ||
      value.execution_status === "not_executed"
    )
      proposal = true;
    if (value.content) inspect(value.content);
    if (value.text) inspect(value.text);
    if (value.result) inspect(value.result);
  };
  inspect(message?.content);
  return failure ? "failed" : proposal ? "not_executed" : "completed";
}
// 同一 session/turn/step 的流式文本和最终消息稳定占一行。
export function projectEvents(events: any[]): StreamRow[] {
  const rows = new Map<string, StreamRow>();
  const seen = new Set<string>();
  for (const item of events) {
    const e = item.event;
    if (item.kind !== "session.event" || !e) continue;
    const session =
      (item.runtimeMode ? item.runtimeMode + ":" : "") + item.sessionId;
    if (Number.isInteger(e.seq)) {
      const key = session + ":" + e.seq;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const d = e.data ?? {};
    const timestamp =
      typeof e.time === "number" ? e.time : Date.parse(e.time ?? item.at);
    const base = {
      time: preciseTime(timestamp),
      timestamp,
      sessionId: item.sessionId,
      detail: item,
      fixture: item.runtimeMode === "deterministic_fixture",
    };
    if (e.type === "assistant/chunk" && d.chunk?.type === "text-delta") {
      const id = `${session}:${d.turn}:${d.step}:assistant`;
      const old = rows.get(id);
      if (!old || old.live)
        rows.set(id, {
          ...base,
          id,
          label: item.sessionId === "proactive-main" ? "主 Agent" : "Sub-agent",
          kind: "assistant",
          text: (old?.text ?? "") + d.chunk.text,
          live: true,
          status: "生成中",
        });
    }
    if (e.type === "assistant/message") {
      const id = `${session}:${d.turn}:${d.step}:assistant`;
      const text = (d.message?.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      if (text)
        rows.set(id, {
          ...base,
          id,
          label: item.sessionId === "proactive-main" ? "主 Agent" : "Sub-agent",
          kind: "assistant",
          text: concise(text),
          live: false,
          status: "完成",
        });
    }
    if (e.type === "user/message") {
      const source = d.source ?? {};
      const label =
        source.kind === "user"
          ? item.sessionId === "proactive-main"
            ? "用户输入"
            : "子任务输入"
          : source.kind === "agent-message"
            ? "代理消息"
            : source.kind === "subagent-settled"
              ? "子任务状态"
              : source.plugin === "@deepseek-ai/dsh-system-prompt"
                ? "运行时上下文"
                : source.plugin === "proactive-bridge"
                  ? base.fixture
                    ? "合成观察"
                    : "桌面观察"
                  : "插件上下文";
      const id = `${session}:${d.id}`;
      rows.set(id, {
        ...base,
        id,
        label,
        kind: "user",
        // 仅压缩明确来源的系统提示；详情仍通过 base.detail 保留原始事件。
        text:
          source.kind === "subagent-settled"
            ? "子代理本轮已结束"
            : source.kind === "plugin" &&
                source.plugin === "@deepseek-ai/dsh-system-prompt"
              ? "运行时上下文已更新"
              : concise(d.content),
        status: "已接收",
      });
    }
    if (e.type === "tool/call") {
      const id = `${session}:tool:${d.callId}`;
      rows.set(id, {
        ...base,
        id,
        label: "工具意图 · " + d.name,
        kind: "tool-call",
        text: concise(d.arguments),
        live: true,
        status: "调用中",
      });
    }
    if (e.type === "tool/result") {
      const callId = `${session}:tool:${d.message?.source?.callId}`;
      const call = rows.get(callId);
      const text = concise(d.message?.content);
      const outcome = toolOutcome({
        ...d.message,
        isError: d.isError ?? d.message?.isError,
        error: d.error ?? d.message?.error,
      });
      const proposal = outcome === "not_executed";
      const name = call?.label.replace(/^工具意图 · /, "");
      if (call) rows.set(callId, { ...call, live: false, status: "已返回" });
      const id = callId + ":result";
      rows.set(id, {
        ...base,
        id,
        label: proposal
          ? "提案 · 未执行"
          : name
            ? "工具结果 · " + name
            : "工具结果",
        kind: "tool-result",
        text,
        detail: { call: call?.detail, result: item },
        status: outcome === "failed" ? "failed" : proposal ? "未执行" : "完成",
      });
    }
  }
  return [...rows.values()];
}
// 子会话归入一条可展开父任务，折叠时不在主流重复平铺。
export function hierarchy(rows: StreamRow[], events: any[]): StreamRow[] {
  const tasks = new Map<string, any>();
  for (const event of events) {
    if (event.kind?.startsWith("task.") && event.taskId)
      tasks.set(event.taskId, { ...tasks.get(event.taskId), ...event });
    if (event.kind === "agent.status")
      for (const task of tasks.values())
        if (
          task.childId === event.sessionId &&
          !["stopped", "interrupted", "cancelled"].includes(task.status)
        )
          task.status = event.status;
  }
  const children = new Map<string, StreamRow[]>();
  const roots: StreamRow[] = [];
  for (const row of rows) {
    if (row.sessionId && row.sessionId !== "proactive-main")
      children.set(row.sessionId, [
        ...(children.get(row.sessionId) ?? []),
        row,
      ]);
    else roots.push(row);
  }
  for (const [sessionId, items] of children) {
    const task = [...tasks.values()].find((task) => task.childId === sessionId);
    const first = items[0]!;
    roots.push({
      id: "subagent:" + sessionId,
      time: first.time,
      timestamp: first.timestamp,
      label: "Sub-agent",
      kind: "subagent",
      text: concise(task?.target ?? first.text),
      sessionId,
      children: items,
      detail: task ?? { sessionId },
      status: task?.status ?? (items.some((i) => i.live) ? "运行中" : "已记录"),
      fixture: first.fixture,
    });
  }
  for (const task of tasks.values())
    if (task.childId && !children.has(task.childId))
      roots.push({
        id: "subagent:" + task.childId,
        time: preciseTime(task.at),
        timestamp: Date.parse(task.at),
        label: "Sub-agent",
        kind: "subagent",
        text: concise(task.target),
        sessionId: task.childId,
        children: [],
        detail: task,
        status: task.status,
      });
  return roots.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
