/** 将持久化理解追踪投影为父子 Span；不合成未观测的模型阶段或计时。 */
export interface TraceSpan {
  id: string;
  parentId?: string;
  name: string;
  kind: "run" | "turn" | "tool";
  status: string;
  startedAt?: string;
  elapsedMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata: Record<string, unknown>;
}

/** 根据显式轮次或调用 ID 归属工具，缺少关联的旧工具保留在 run 下。 */
export function traceSpans(trace: any): TraceSpan[] {
  const spans: TraceSpan[] = [
    {
      id: "run",
      name: "understanding.run",
      kind: "run",
      status: trace.status ?? "unknown",
      startedAt: trace.startedAt,
      elapsedMs: trace.elapsedMs,
      error: trace.error,
      input: {
        system: trace.systemPrompt,
        user: trace.userPrompt,
        image: trace.imageHash
          ? { sha256: trace.imageHash, tab: "截图" }
          : undefined,
      },
      output: trace.output ?? trace.rawOutput,
      metadata: {
        actionId: trace.actionId,
        usage: trace.usage,
        model: trace.model,
        sdk: trace.sdk,
        settings: trace.requestSettings,
        tools: trace.tools,
      },
    },
  ];
  const linked = new Set<number>();
  const tools: any[] = trace.toolCalls ?? [];
  for (const step of trace.steps ?? []) {
    const id = `turn-${step.step}`;
    spans.push({
      id,
      parentId: "run",
      name: `agent.turn ${step.step}`,
      kind: "turn",
      status: step.status ?? "unknown",
      startedAt: step.startedAt,
      elapsedMs: step.elapsedMs,
      error: step.status === "failed" ? trace.error : undefined,
      input: { system: trace.systemPrompt, messages: step.messages },
      output: {
        text: step.text,
        toolCalls: step.toolCalls,
        toolResults: step.toolResults,
      },
      metadata: {
        model: trace.model,
        usage: step.usage,
        finishReason: step.finishReason,
        timing: "本轮总耗时，包含工具执行；不是纯模型延迟",
      },
    });
    for (const [index, call] of tools.entries()) {
      if (
        call.step !== step.step &&
        !(step.toolCalls ?? []).some(
          (item: any) => item.toolCallId && item.toolCallId === call.toolCallId,
        )
      )
        continue;
      linked.add(index);
      spans.push(toolSpan(call, index, id));
    }
    for (const [index, call] of (step.toolCalls ?? []).entries()) {
      if (
        tools.some(
          (item) => item.toolCallId && item.toolCallId === call.toolCallId,
        )
      )
        continue;
      const result = (step.toolResults ?? []).find(
        (item: any) => item.toolCallId && item.toolCallId === call.toolCallId,
      );
      spans.push({
        id: `${id}-call-${index}`,
        parentId: id,
        name: call.toolName,
        kind: "tool",
        status: result ? "completed" : "unknown",
        input: call.input,
        output: result?.output,
        metadata: {
          toolCallId: call.toolCallId,
          timing: "旧追踪未记录执行耗时",
        },
      });
    }
  }
  tools.forEach((call, index) => {
    if (!linked.has(index)) spans.push(toolSpan(call, index, "run"));
  });
  return spans;
}

/** 保留工具开始时刻、结果和失败原因，缺失状态不推断为成功。 */
function toolSpan(call: any, index: number, parentId: string): TraceSpan {
  return {
    id: `tool-${index}`,
    parentId,
    name: call.name,
    kind: "tool",
    status: call.status ?? (call.error ? "failed" : "unknown"),
    startedAt: call.startedAt,
    elapsedMs: call.status === "running" ? undefined : call.elapsedMs,
    input: call.input,
    output: call.result,
    error: call.error,
    metadata: {
      toolCallId: call.toolCallId,
      association: parentId === "run" ? "旧追踪未记录所属轮次" : undefined,
    },
  };
}
