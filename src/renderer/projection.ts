export interface StreamRow {
  id: string;
  time: string;
  timestamp?: number;
  label: string;
  text: string;
  kind: string;
  detail: any;
  live?: boolean;
}
// 同一session/turn/step的live文本与durable final占一行，最终结果覆盖增量。
export function projectEvents(events: any[]): StreamRow[] {
  const rows = new Map<string, StreamRow>();
  const seen = new Set<string>();
  for (const item of events) {
    const e = item.event;
    const session =
      (item.runtimeMode ? item.runtimeMode + ":" : "") + item.sessionId;
    if (item.kind !== "session.event") continue;
    if (Number.isInteger(e.seq)) {
      const key = session + ":" + e.seq;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const d = e.data;
    const time = new Date(e.time).toLocaleTimeString();
    if (e.type === "assistant/chunk" && d.chunk.type === "text-delta") {
      const id = `${session}:${d.turn}:${d.step}:assistant`;
      const old = rows.get(id);
      if (!old || old.live)
        rows.set(id, {
          id,
          time,
          timestamp: e.time,
          label: item.sessionId === "proactive-main" ? "主 Agent" : "Sub-agent",
          kind: "assistant",
          text: (old?.text ?? "") + d.chunk.text,
          detail: item,
          live: true,
        });
    }
    if (e.type === "assistant/message") {
      const id = `${session}:${d.turn}:${d.step}:assistant`;
      rows.set(id, {
        id,
        time,
        timestamp: e.time,
        label: item.sessionId === "proactive-main" ? "主 Agent" : "Sub-agent",
        kind: "assistant",
        text: d.message.content
          .map((b: any) =>
            b.type === "text"
              ? b.text
              : b.type === "tool-call"
                ? `调用 ${b.name}`
                : "",
          )
          .filter(Boolean)
          .join("\n"),
        detail: item,
        live: false,
      });
    }
    if (e.type === "user/message")
      rows.set(`${session}:${d.id}`, {
        id: `${session}:${d.id}`,
        time,
        timestamp: e.time,
        label:
          d.source.kind === "user"
            ? item.sessionId === "proactive-main"
              ? "用户输入"
              : "子任务输入"
            : d.source.kind === "agent-message"
              ? "代理消息"
              : d.source.kind === "subagent-settled"
                ? "子任务状态"
                : d.source.kind === "plugin" &&
                    d.source.plugin === "@deepseek-ai/dsh-system-prompt"
                  ? "运行时上下文"
                  : d.source.kind === "plugin" &&
                      d.source.plugin === "proactive-bridge"
                    ? item.runtimeMode === "deterministic_fixture"
                      ? "合成观察"
                      : "桌面观察"
                    : "插件上下文",
        kind: "user",
        text: d.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n"),
        detail: item,
      });
    if (e.type === "tool/call")
      rows.set(`${session}:tool:${d.callId}`, {
        id: `${session}:tool:${d.callId}`,
        time,
        timestamp: e.time,
        label: "工具意图 · " + d.name,
        kind: "tool",
        text: d.arguments,
        detail: item,
        live: true,
      });
    if (e.type === "tool/result") {
      const id = `${session}:tool:${d.message.source.callId}`;
      const old = rows.get(id);
      const isProposal = d.message.content.some(
        (block: any) =>
          block.type === "tool-result" &&
          block.content.some((part: any) => {
            if (part.type !== "text") return false;
            try {
              return JSON.parse(part.text).status === "not_executed";
            } catch {
              return false;
            }
          }),
      );
      const name = old?.label.replace(/^工具意图 · /, "");
      rows.set(id, {
        id,
        time,
        timestamp: e.time,
        label: isProposal
          ? "提案 · 未执行"
          : name
            ? "工具结果 · " + name
            : "工具结果",
        kind: "tool",
        text: JSON.stringify(d.message.content),
        detail: { call: old?.detail, result: item },
        live: false,
      });
    }
  }
  return [...rows.values()];
}
