/** 理解运行的 Trace 检查器：左侧调用树，右侧展示选中 Span，不加载其他动作。 */
import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Circle,
  LoaderCircle,
  Workflow,
  Wrench,
  Cpu,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { traceSpans, type TraceSpan } from "./trace-model.ts";

/** 展示已记录的数值，未知不显示成零。 */
function duration(ms?: number) {
  return ms == null
    ? "—"
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(2)} s`;
}

/** 格式化证据字段；嵌套结构默认折叠，字符串不重复 JSON 转义。 */
function Value({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === undefined || value === null)
    return <span className="text-muted-foreground">未记录</span>;
  if (typeof value !== "object")
    return (
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {String(value)}
      </p>
    );
  return (
    <div className="flex flex-col divide-y divide-border">
      {Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => {
          const complex = item !== null && typeof item === "object";
          return (
            <div key={key} className="py-2">
              {complex ? (
                <details open={depth < 1}>
                  <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                    {key}
                    {Array.isArray(item) ? ` [${item.length}]` : ""}
                  </summary>
                  <div className="ml-2 border-l pl-3">
                    <Value value={item} depth={depth + 1} />
                  </div>
                </details>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-xs text-muted-foreground">
                    {key}
                  </p>
                  <Value value={item} depth={depth + 1} />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

/** 展开和选中分别控制；每层由 parentId 决定，不通过工具名猜父子关系。 */
export function UnderstandingChain({ trace }: { trace: any }) {
  const spans = traceSpans(trace);
  const [selected, setSelected] = useState("run");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copyStatus, setCopyStatus] = useState("");
  const span = spans.find((item) => item.id === selected) ?? spans[0]!;
  const usage = span.metadata.usage as any;
  const statusName =
    (
      { completed: "成功", failed: "失败", running: "运行中" } as Record<
        string,
        string
      >
    )[span.status] ?? "未记录状态";
  /** 复制仅当前节点，失败状态明确反馈。 */
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(span, null, 2));
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败");
    }
  }
  /** 递归展示当前运行中的真实 Span。 */
  function branch(item: TraceSpan): React.ReactNode {
    const children = spans.filter((child) => child.parentId === item.id);
    const closed = collapsed.has(item.id);
    const Icon =
      item.kind === "run" ? Workflow : item.kind === "tool" ? Wrench : Cpu;
    const Status =
      item.status === "failed"
        ? CircleX
        : item.status === "completed"
          ? CircleCheck
          : item.status === "running"
            ? LoaderCircle
            : Circle;
    return (
      <li key={item.id}>
        <div className="flex items-center gap-1 py-1">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!children.length}
            aria-label={`${closed ? "展开" : "折叠"} ${item.name}`}
            aria-expanded={children.length ? !closed : undefined}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                closed ? next.delete(item.id) : next.add(item.id);
                return next;
              })
            }
          >
            {closed ? <ChevronRight /> : <ChevronDown />}
          </Button>
          <Button
            variant={selected === item.id ? "secondary" : "ghost"}
            className="min-w-0 flex-1 justify-start"
            aria-pressed={selected === item.id}
            onClick={() => {
              setSelected(item.id);
              setCopyStatus("");
            }}
          >
            <Icon data-icon="inline-start" />
            <span
              className="min-w-0 flex-1 truncate text-left"
              title={item.name}
            >
              {item.name}
            </span>
            <Status
              data-icon="inline-end"
              className={item.status === "running" ? "animate-spin" : undefined}
            />
          </Button>
        </div>
        <div className="mb-1 ml-9 font-mono text-xs text-muted-foreground">
          {duration(item.elapsedMs)}
        </div>
        {children.length > 0 && !closed && (
          <ul className="ml-3 border-l border-border pl-2">
            {children.map(branch)}
          </ul>
        )}
      </li>
    );
  }
  return (
    <section
      aria-label="Agent Trace"
      className="overflow-hidden rounded-lg border border-border"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="size-4" />
          <span className="text-sm font-medium">Trace</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {trace.actionId ?? "历史运行"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {spans.length} spans · {duration(trace.elapsedMs)}
        </span>
      </header>
      <div className="grid min-h-[420px] grid-cols-1 lg:grid-cols-[minmax(210px,30%)_minmax(0,1fr)]">
        <nav
          aria-label="调用树"
          className="max-h-[65vh] overflow-auto border-b p-2 lg:border-b-0 lg:border-r"
        >
          <ul>{branch(spans[0]!)}</ul>
        </nav>
        <article aria-label="Span 详情" className="min-w-0">
          <header className="flex flex-col gap-3 border-b px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-mono text-sm font-semibold">{span.name}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {span.startedAt
                    ? new Date(span.startedAt).toLocaleString()
                    : "开始时刻未记录"}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="复制当前 Span"
                onClick={() => void copy()}
              >
                <Copy />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span
                className={
                  span.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              >
                {statusName}
              </span>
              <span>{duration(span.elapsedMs)}</span>
              <span className="text-muted-foreground">
                {String(
                  span.metadata.model ??
                    (span.kind === "tool" ? "工具执行" : (trace.model ?? "—")),
                )}
              </span>
              {usage && (
                <span className="font-mono">
                  {usage.inputTokens ?? "—"} in → {usage.outputTokens ?? "—"}{" "}
                  out
                </span>
              )}
            </div>
            {span.error && (
              <p role="alert" className="break-all text-sm text-destructive">
                {span.error}
              </p>
            )}
            {copyStatus && (
              <p role="status" className="text-xs">
                {copyStatus}
              </p>
            )}
          </header>
          <Tabs defaultValue="preview" className="gap-0">
            <TabsList variant="line" className="mx-4">
              <TabsTrigger value="preview">Input / Output</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent
              value="preview"
              className="max-h-[55vh] overflow-auto px-4 pb-4"
            >
              <section className="py-4">
                <h5 className="mb-2 text-sm font-semibold">Input</h5>
                <div className="rounded-md border p-3 text-sm">
                  <Value value={span.input} />
                </div>
              </section>
              <section>
                <h5 className="mb-2 text-sm font-semibold">Output</h5>
                <div className="rounded-md border p-3 text-sm">
                  <Value value={span.output} />
                </div>
              </section>
              {span.kind === "turn" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  本轮耗时包含工具执行；完整 usage 见 JSON。
                </p>
              )}
            </TabsContent>
            <TabsContent
              value="json"
              className="max-h-[55vh] overflow-auto p-4"
            >
              <pre className="whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(span, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
        </article>
      </div>
      {trace.delivery && (
        <footer className="border-t px-4 py-3 text-xs text-muted-foreground">
          关联投递 · {trace.delivery.status} · 序位{" "}
          {trace.delivery.sequence ?? "—"}
          {trace.delivery.waitingFor
            ? ` · 等待 ${trace.delivery.waitingFor.actionId}`
            : ""}
          <details className="mt-1">
            <summary className="cursor-pointer">批次与回执</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">
              {JSON.stringify(trace.delivery, null, 2)}
            </pre>
          </details>
        </footer>
      )}
    </section>
  );
}
