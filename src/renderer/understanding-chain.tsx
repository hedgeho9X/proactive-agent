/** 单条理解的调用树与节点检查器；只投影实际追踪，不推测缺失轮次。 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** 统一模型和工具节点的展示字段，保留原始数据供检查。 */
export interface ChainNode {
  id: string;
  label: string;
  depth: number;
  input?: unknown;
  output?: unknown;
  meta: Record<string, unknown>;
}

/** 以 toolCallId 关联调用和结果；旧记录无法关联的工具单独列出，不猜测父轮次。 */
export function understandingChain(trace: any): ChainNode[] {
  const nodes: ChainNode[] = [
    {
      id: "context",
      label: "context · 上下文",
      depth: 0,
      input: {
        system: trace.systemPrompt,
        prompt: trace.userPrompt,
        imageHash: trace.imageHash,
      },
      output: trace.promptInput,
      meta: { startedAt: trace.startedAt, model: trace.model },
    },
  ];
  const used = new Set<string>();
  for (const step of trace.steps ?? []) {
    nodes.push({
      id: `step-${step.step}`,
      label: `agent.turn ${step.step} · 模型请求`,
      depth: 0,
      input: { system: trace.systemPrompt, messages: step.messages },
      output: {
        text: step.text,
        toolCalls: step.toolCalls,
        toolResults: step.toolResults,
      },
      meta: {
        status: step.status ?? "unknown",
        startedAt: step.startedAt,
        elapsedMs: step.elapsedMs,
        usage: step.usage,
        finishReason: step.finishReason,
      },
    });
    for (const call of step.toolCalls ?? []) {
      const detail = trace.toolCalls?.find(
        (entry: any) =>
          entry.toolCallId && entry.toolCallId === call.toolCallId,
      );
      const result = step.toolResults?.find(
        (entry: any) => entry.toolCallId === call.toolCallId,
      );
      used.add(call.toolCallId);
      nodes.push({
        id: `tool-${call.toolCallId}`,
        label: `tool · ${call.toolName}`,
        depth: 1,
        input: detail?.input ?? call.input,
        output: detail?.result ?? result?.output,
        meta: {
          toolCallId: call.toolCallId,
          status: detail?.status,
          elapsedMs: detail?.elapsedMs,
          error: detail?.error,
        },
      });
    }
  }
  for (const [index, call] of (trace.toolCalls ?? []).entries()) {
    if (call.toolCallId && used.has(call.toolCallId)) continue;
    nodes.push({
      id: `unlinked-${index}`,
      label: `tool · ${call.name}`,
      depth: 0,
      input: call.input,
      output: call.result,
      meta: {
        status: call.status,
        elapsedMs: call.elapsedMs,
        error: call.error,
        association: "所属模型轮次尚未记录",
      },
    });
  }
  nodes.push({
    id: "result",
    label: "understanding · 最终结果",
    depth: 0,
    output: trace.output ?? trace.rawOutput,
    meta: {
      status: trace.status,
      elapsedMs: trace.elapsedMs,
      error: trace.error,
    },
  });
  if (trace.delivery)
    nodes.push({
      id: "delivery",
      label: "delivery · 主 Agent 投递",
      depth: 0,
      input: { actionId: trace.actionId, sequence: trace.delivery.sequence },
      output: trace.delivery.receipt,
      meta: { ...trace.delivery, receipt: undefined },
    });
  return nodes;
}

/** 点击节点切换输入、输出和诊断；切换动作时由父组件重置选中状态。 */
export function UnderstandingChain({ trace }: { trace: any }) {
  const nodes = understandingChain(trace);
  const [selected, setSelected] = useState("context");
  const current = nodes.find((node) => node.id === selected) ?? nodes[0]!;
  return (
    <section
      aria-label="Understanding 调用链"
      className="grid gap-3 md:grid-cols-[230px_minmax(0,1fr)]"
    >
      <nav aria-label="调用节点" className="flex flex-col gap-1">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={node.depth ? "ml-4 border-l pl-2" : undefined}
          >
            <Button
              variant={node.id === current.id ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              aria-pressed={node.id === current.id}
              onClick={() => setSelected(node.id)}
            >
              <span className="truncate">{node.label}</span>
            </Button>
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex flex-col gap-2">
        <p className="font-medium">{current.label}</p>
        <p className="text-xs text-muted-foreground">
          {String(current.meta.status ?? "已记录")} ·{" "}
          {current.meta.elapsedMs == null
            ? "耗时未记录"
            : `${current.meta.elapsedMs} ms`}
        </p>
        {current.meta.error ? (
          <p role="alert" className="text-destructive">
            {String(current.meta.error)}
          </p>
        ) : null}
        <Tabs defaultValue="input">
          <TabsList>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="meta">诊断 / Token</TabsTrigger>
          </TabsList>
          {(["input", "output", "meta"] as const).map((key) => (
            <TabsContent key={key} value={key}>
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(current[key] ?? "尚未记录", null, 2)}
              </pre>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
