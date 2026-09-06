import React, { useEffect, useMemo, useRef, useState } from "react";
import { AXLab } from "./ax-lab.tsx";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Settings2,
  MousePointer2,
  Sparkles,
  Wrench,
  GitBranch,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  concise,
  hierarchy,
  preciseTime,
  projectEvents,
  type StreamRow,
} from "./projection.ts";

declare global {
  interface Window {
    proactive: {
      invoke: (method: string, p?: unknown) => Promise<any>;
      subscribe: (listener: () => void) => () => void;
    };
  }
}
const api = window.proactive;
type Role = "understanding" | "main" | "subagent";
type Config = {
  protocol: "gemini" | "openai-compatible";
  baseUrl: string;
  model: string;
  hasKey?: boolean;
  status?: string;
  maxCalls?: number;
};
const roleNames: Record<Role, string> = {
  understanding: "屏幕理解",
  main: "主 Agent",
  subagent: "Sub-agent",
};
const statusNames: Record<string, string> = {
  queued: "待处理",
  understanding: "理解中",
  ready: "待投递",
  delivered: "已投递",
  failed: "失败",
  filtered: "已过滤",
  unavailable: "不可用",
  configured_unverified: "待验证",
  connected: "已连接",
  allowed: "已记录",
  configured: "已配置",
  running: "运行中",
  idle: "待命",
  cancelled: "已取消",
  stopped: "已停止",
  starting: "启动中",
  stopping: "停止中",
  pending: "待采集",
  captured: "已采集",
  shared: "共享",
  excluded: "已排除",
  expired: "已过期",
  skipped_by_policy: "策略跳过",
  dropped_by_backpressure: "采集繁忙",
  timed_out: "超时",
  interrupted: "已中断",
  completed: "完成",
};
const statusText = (status?: string) =>
  status ? (statusNames[status] ?? status) : "—";
function JSONView({ value }: { value: unknown }) {
  return (
    <pre className="rounded-md bg-muted p-3">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
function RawSection({
  value,
  label = "原始 JSON",
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost">
          <ChevronRight data-icon="inline-start" />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <JSONView value={value} />
      </CollapsibleContent>
    </Collapsible>
  );
}
function AXTree({ nodes }: { nodes: any[] }) {
  const ids = new Set(nodes.map((n) => n.node_id));
  const children = new Map<string | null, any[]>();
  for (const node of nodes) {
    const parent = ids.has(node.parent_id) ? node.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const render = (node: any, path: Set<string>): React.ReactNode => {
    if (path.has(node.node_id))
      return <span key={node.node_id}>循环节点 {node.node_id}</span>;
    const next = new Set([...path, node.node_id]);
    const branches = children.get(node.node_id) ?? [];
    return (
      <Collapsible
        key={node.node_id}
        defaultOpen={!!node.clicked || !!node.focused}
      >
        <CollapsibleTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="max-w-full justify-start"
          >
            <ChevronRight data-icon="inline-start" />
            <span className="truncate">
              {node.role} · {node.title || node.value || node.node_id}
              {node.clicked ? " · 目标" : node.focused ? " · 焦点" : ""}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ax-branch">
          <p className="detail-text text-xs text-muted-foreground">
            {node.value || node.title || node.node_id}
          </p>
          {next.size < 40 && branches.map((child) => render(child, next))}
          <RawSection value={node} label="节点属性" />
        </CollapsibleContent>
      </Collapsible>
    );
  };
  return (
    <div>
      {(children.get(null) ?? []).map((node) => render(node, new Set()))}
    </div>
  );
}
function ModelForm({
  role,
  config,
  busy,
  onSave,
}: {
  role: Role;
  config?: Config;
  busy: boolean;
  onSave: (role: Role, config: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState({
    protocol: config?.protocol ?? "openai-compatible",
    baseUrl: config?.baseUrl ?? "https://example.com/v1/",
    model:
      config?.model ?? (role === "understanding" ? "gemini-3.8-flash" : ""),
    apiKey: "",
  });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const changed =
    draft.protocol !== config?.protocol ||
    draft.baseUrl.replace(/\/$/, "") !== config?.baseUrl.replace(/\/$/, "") ||
    draft.model !== config?.model ||
    !!draft.apiKey;
  const update = (name: string, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setSaved(false);
    setTestResult("");
  };
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await onSave(role, {
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
          model: draft.model,
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        });
        if (result) {
          setDraft((current) => ({ ...current, apiKey: "" }));
          setSaved(true);
          setTestResult("");
        }
      }}
    >
      <fieldset disabled={testing}>
        <FieldGroup className="gap-4">
          <Field className="gap-2">
            <FieldLabel htmlFor={role + "-protocol"}>协议</FieldLabel>
            <Select
              value={draft.protocol}
              onValueChange={(value) => update("protocol", value)}
            >
              <SelectTrigger id={role + "-protocol"} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="openai-compatible">
                    OpenAI compatible
                  </SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor={role + "-url"}>Base URL</FieldLabel>
            <Input
              id={role + "-url"}
              value={draft.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
            />
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor={role + "-model"}>Model ID</FieldLabel>
            <Input
              id={role + "-model"}
              value={draft.model}
              onChange={(e) => update("model", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor={role + "-key"}>API Key</FieldLabel>
            <Input
              id={role + "-key"}
              type="password"
              value={draft.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={config?.hasKey ? "已配置 · 留空保留" : "未配置"}
              autoComplete="off"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {saved
                ? "已保存"
                : config?.hasKey
                  ? statusText(config.status)
                  : "未配置"}
            </Badge>
            <span className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || testing || changed || !config?.hasKey}
              onClick={async () => {
                setTesting(true);
                setTestResult("");
                try {
                  const result = await window.proactive.invoke("model.test", {
                    role,
                  });
                  setTestResult(
                    result.ok
                      ? `连接成功 · ${result.elapsedMs} ms`
                      : `${result.error} · ${result.elapsedMs} ms`,
                  );
                } catch {
                  setTestResult("测试失败，请重试");
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? "测试中…" : "测试连接"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!config?.hasKey || busy || testing}
              onClick={() => void onSave(role, { ...draft, apiKey: "" })}
            >
              清除 Key
            </Button>
            <Button
              size="sm"
              disabled={
                busy || testing || !draft.model.trim() || !draft.baseUrl.trim()
              }
            >
              保存
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {testResult ||
              "保存配置后可测试连接：发送一条短文本请求，可能产生少量费用；不验证视觉或工具调用能力。"}
          </p>
        </FieldGroup>
      </fieldset>
    </form>
  );
}
function TraceDetail({ row }: { row: StreamRow }) {
  const detail = row.detail;
  const message = detail?.event?.data?.message;
  const event = detail?.event;
  const body = (message?.content ?? event?.data?.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");
  const call =
    detail?.call?.event?.data ??
    (event?.type === "tool/call" ? event.data : null);
  const result = detail?.result?.event?.data?.message;
  return (
    <div className="flex flex-col gap-4">
      {call && (
        <section>
          <h3 className="mb-2 text-xs text-muted-foreground">
            输入 · {call.name}
          </h3>
          <JSONView
            value={
              typeof call.arguments === "string"
                ? parseText(call.arguments)
                : call.arguments
            }
          />
        </section>
      )}
      {result && (
        <section>
          <h3 className="mb-2 text-xs text-muted-foreground">输出</h3>
          <div className="detail-text">{concise(result.content)}</div>
          <RawSection value={result.content} label="完整工具结果" />
        </section>
      )}
      {body && (
        <section>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {row.kind === "user" ? "输入" : "输出"}
          </h3>
          <div className="detail-text">
            {typeof parseText(body) === "object" ? concise(body) : body}
          </div>
          {typeof parseText(body) === "object" && (
            <RawSection value={parseText(body)} label="完整输入" />
          )}
        </section>
      )}
      {!body && !call && !result && <p className="detail-text">{row.text}</p>}
      <RawSection value={detail} label="Runtime event" />
    </div>
  );
}
function parseText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function App() {
  const [state, setState] = useState<any>({
    actions: [],
    events: [],
    activities: [],
    queue: [],
    collector: { state: "stopped" },
    mode: "unavailable",
    modelRoles: {},
  });
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState("feed");
  const [selected, setSelected] = useState<StreamRow | null>(null);
  const [observation, setObservation] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [bundleIds, setBundleIds] = useState("");
  const [allApps, setAllApps] = useState(true);
  const [follow, setFollow] = useState(true);
  const [axView, setAXView] = useState("context");
  const [revision, setRevision] = useState("");
  const [detailTab, setDetailTab] = useState("formatted");
  const feed = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const selectedRef = useRef<StreamRow | null>(null);
  selectedRef.current = selected;
  async function refresh() {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    try {
      const next = await api.invoke("snapshot");
      setState(next);
    } catch (e) {
      setError(String(e));
    } finally {
      refreshing.current = false;
      if (refreshAgain.current) {
        refreshAgain.current = false;
        void refresh();
      }
    }
  }
  async function act(method: string, params: unknown = {}): Promise<boolean> {
    setBusy(method);
    setError("");
    try {
      await api.invoke(method, params);
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    void refresh();
    const unsubscribe = api.subscribe(() => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        void refresh();
      }, 80);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);
  const projected = useMemo(
    () => hierarchy(projectEvents(state.events), state.events),
    [state.events],
  );
  const queue = new Map<string, any>(
    (state.queue ?? []).map((item: any) => [item.actionId, item]),
  );
  const actions: StreamRow[] = state.actions.map((item: any) => {
    const action = item.action;
    const queued = queue.get(action.action_id);
    return {
      id: action.action_id,
      actionId: action.action_id,
      time: preciseTime(action.occurred_at),
      timestamp: Date.parse(action.occurred_at),
      kind: "action",
      fixture: action.actor === "fixture" || action.origin === "fixture",
      label: action.app?.name ?? "Action",
      text:
        concise(
          item.understanding?.result ??
            item.understanding ??
            queued?.understanding?.result ??
            queued?.understanding ??
            queued?.result,
        ) ||
        [action.kind, action.input?.key_name ?? action.input?.key_category]
          .filter(Boolean)
          .join(" · "),
      detail: item,
      status:
        queued?.status ??
        (item.evidence.some((e: any) => e.status === "pending")
          ? "pending"
          : action.policy_status),
    };
  });
  const rows = [...actions, ...projected].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
  );
  const rowIdentity = rows
    .flatMap((row) => [
      row.id,
      ...(row.children ?? []).map((child) => child.id),
    ])
    .join("|");
  useEffect(() => {
    if (follow && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [rowIdentity, follow]);
  const selectedAction = state.actions.find(
    (item: any) => item.action.action_id === selected?.actionId,
  );
  const selectedQueue = queue.get(selected?.actionId ?? "");
  useEffect(() => {
    if (!selected?.actionId) {
      setObservation(null);
      return;
    }
    let cancelled = false;
    const id = selected.actionId;
    void api
      .invoke("observation", { actionId: id })
      .then((value) => {
        if (!cancelled && selectedRef.current?.actionId === id)
          setObservation(value);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.actionId, selectedAction?.revision, selectedQueue?.status]);
  const currentRow = selected
    ? (rows
        .flatMap((row) => [row, ...(row.children ?? [])])
        .find((row) => row.id === selected.id) ?? selected)
    : null;
  const ax = observation?.artifacts?.ax?.payload?.content;
  const nodes =
    axView === "raw" ? ax?.nodes : (ax?.context?.context ?? ax?.nodes);
  function select(row: StreamRow) {
    setSelected(row);
    setObservation(null);
    setDetailTab("formatted");
    setRevision(row.detail?.target ?? "");
  }
  function renderRow(row: StreamRow, child = false): React.ReactNode {
    const Icon =
      row.kind === "action"
        ? MousePointer2
        : row.kind === "subagent"
          ? GitBranch
          : row.kind.startsWith("tool")
            ? Wrench
            : row.kind === "user"
              ? MessageSquare
              : Sparkles;
    const content = (
      <>
        <time className="event-time">{row.time}</time>
        <span className="event-kind">
          <Icon />
          <span className="truncate">{row.label}</span>
        </span>
        <span className="event-summary truncate">{row.text || "—"}</span>
        {row.fixture && <Badge variant="outline">合成</Badge>}
        <Badge variant={row.status === "failed" ? "destructive" : "ghost"}>
          {statusText(row.status)}
        </Badge>
      </>
    );
    if (row.kind === "subagent")
      return (
        <Collapsible key={row.id}>
          <div
            className="event-row"
            data-tone="agent"
            data-selected={selected?.id === row.id}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={"展开子代理 " + row.text}
              >
                <ChevronRight data-icon="inline-start" />
              </Button>
            </CollapsibleTrigger>
            <button
              className="flex h-full min-w-0 flex-1 items-center gap-2"
              onClick={() => select(row)}
            >
              {content}
            </button>
          </div>
          <CollapsibleContent className="child-events">
            {row.children?.map((item) => renderRow(item, true))}
          </CollapsibleContent>
        </Collapsible>
      );
    return (
      <button
        key={row.id}
        className="event-row w-full"
        data-tone={row.kind === "action" ? "observation" : "agent"}
        data-selected={selected?.id === row.id}
        data-child={child}
        onClick={() => select(row)}
      >
        {content}
      </button>
    );
  }
  return (
    <main className="flex h-full">
      <nav
        aria-label="功能导航"
        className="flex w-36 shrink-0 flex-col gap-2 border-r p-3"
      >
        <span className="mb-3 text-sm font-semibold">Proactive Lab</span>
        <Button
          variant={page === "feed" ? "secondary" : "ghost"}
          onClick={() => setPage("feed")}
        >
          观察与 Agent
        </Button>
        <Button
          variant={page === "ax" ? "secondary" : "ghost"}
          onClick={() => setPage("ax")}
        >
          AX 观测台
        </Button>
      </nav>
      <div className={page === "ax" ? "min-w-0 flex-1" : "hidden"}>
        <AXLab />
      </div>
      <div
        className={page === "feed" ? "flex min-w-0 flex-1 flex-col" : "hidden"}
      >
        <div className="flex h-10 shrink-0 items-center gap-3 px-4">
          <span className="text-xs font-medium">Proactive</span>
          <span className="text-xs text-muted-foreground">
            {state.collector.state === "running" ? "观察中" : "观察已暂停"}
          </span>
          <span className="flex-1" />
          {state.mode === "deterministic_fixture" && (
            <Badge variant="outline">合成运行</Badge>
          )}
          <Button size="xs" variant="ghost" onClick={() => setFollow(!follow)}>
            <ArrowDown data-icon="inline-start" />
            {follow ? "跟随" : "恢复跟随"}
          </Button>
        </div>
        <Separator />
        {error && (
          <Alert variant="destructive" className="rounded-none py-2">
            <AlertDescription>
              <div className="flex w-full items-center gap-2">
                <span className="truncate">{error}</span>
                <Button variant="ghost" size="xs" onClick={() => setError("")}>
                  关闭
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div
          ref={feed}
          className="min-h-0 flex-1 overflow-y-auto"
          aria-label="事件流"
          onScroll={() => {
            const element = feed.current;
            if (
              element &&
              element.scrollHeight - element.scrollTop - element.clientHeight >
                60
            )
              setFollow(false);
          }}
        >
          {rows.length ? (
            rows.map((row) => renderRow(row))
          ) : (
            <Empty className="h-12 flex-none p-2 md:p-2">
              <EmptyDescription>暂无事件</EmptyDescription>
            </Empty>
          )}
        </div>
        <Separator />
        <div className="flex shrink-0 items-center gap-3 p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="设置"
            onClick={() => setSettings(true)}
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              state.collector.state === "running" ? "停止观察" : "开始观察"
            }
            disabled={!!busy}
            onClick={() =>
              state.collector.state === "running"
                ? void act("capture.stop")
                : setSettings(true)
            }
          >
            {state.collector.state === "running" ? <Pause /> : <Play />}
          </Button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (prompt.trim() && (await act("prompt", { text: prompt })))
                setPrompt("");
            }}
          >
            <FieldGroup className="flex-row items-center gap-2">
              <Field className="min-w-0 flex-1 gap-0">
                <FieldLabel htmlFor="user-prompt" className="sr-only">
                  用户 Prompt
                </FieldLabel>
                <Input
                  id="user-prompt"
                  aria-label="用户 Prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="发给主 Agent…"
                />
              </Field>
              <Button
                size="icon-sm"
                aria-label="发送"
                disabled={
                  !!busy || !prompt.trim() || state.mode === "unavailable"
                }
              >
                <ArrowUp />
              </Button>
            </FieldGroup>
          </form>
        </div>
        <Sheet
          modal={false}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <SheetContent
            className="w-full gap-0 sm:max-w-xl"
            // 详情保持展开，背景行可以继续切换；Esc 与关闭按钮仍沿用 Radix 行为。
            onInteractOutside={(event) => event.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle>{currentRow?.label ?? "事件详情"}</SheetTitle>
              <SheetDescription>
                {currentRow?.time} · {statusText(currentRow?.status)}
              </SheetDescription>
            </SheetHeader>
            <Separator />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Tabs value={detailTab} onValueChange={setDetailTab}>
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="formatted">详情</TabsTrigger>
                  {selected?.actionId && (
                    <>
                      <TabsTrigger value="ax">AX</TabsTrigger>
                      <TabsTrigger value="image">图像 / OCR</TabsTrigger>
                      <TabsTrigger value="understanding">理解</TabsTrigger>
                    </>
                  )}
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
                <TabsContent value="formatted" className="pt-4">
                  {currentRow &&
                    (observation ? (
                      <div className="flex flex-col gap-4">
                        <p className="detail-text">{currentRow.text}</p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                          <dt>Action</dt>
                          <dd className="break-all">
                            {observation.action.action_id}
                          </dd>
                          <dt>应用</dt>
                          <dd>{observation.action.app?.bundle_id}</dd>
                          <dt>时间</dt>
                          <dd>{observation.action.occurred_at}</dd>
                          <dt>Revision</dt>
                          <dd>{observation.revision}</dd>
                        </dl>
                        <Separator />
                        {observation.evidence.map((link: any) => (
                          <div key={link.slot} className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs">{link.slot}</span>
                              <Badge variant="outline">
                                {statusText(link.status)}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {link.delta_ms ?? "—"} ms
                              </span>
                            </div>
                            {link.reason && (
                              <p className="text-xs text-muted-foreground">
                                {link.reason}
                              </p>
                            )}
                          </div>
                        ))}
                        {selectedQueue && (
                          <RawSection value={selectedQueue} label="队列记录" />
                        )}
                      </div>
                    ) : (
                      <TraceDetail row={currentRow} />
                    ))}
                  {currentRow?.kind === "subagent" &&
                    currentRow.detail?.taskId && (
                      <FieldGroup className="mt-4 gap-3">
                        <Field>
                          <FieldLabel htmlFor="task-revision">
                            修正任务
                          </FieldLabel>
                          <Input
                            id="task-revision"
                            value={revision}
                            onChange={(e) => setRevision(e.target.value)}
                          />
                        </Field>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!!busy || !revision.trim()}
                            onClick={() =>
                              void act("revise", {
                                taskId: currentRow.detail.taskId,
                                target: revision,
                              })
                            }
                          >
                            发送修正
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!busy}
                            onClick={() =>
                              void act("cancel", {
                                taskId: currentRow.detail.taskId,
                              })
                            }
                          >
                            取消任务
                          </Button>
                        </div>
                      </FieldGroup>
                    )}
                </TabsContent>
                <TabsContent value="ax" className="pt-4">
                  <Tabs value={axView} onValueChange={setAXView}>
                    <TabsList>
                      <TabsTrigger value="context">Context</TabsTrigger>
                      <TabsTrigger value="raw">Raw</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className="my-3 text-xs text-muted-foreground">
                    {nodes?.length ?? 0} nodes
                  </p>
                  {nodes?.length ? (
                    <AXTree nodes={nodes} />
                  ) : (
                    <p className="text-sm text-muted-foreground">AX 不可用</p>
                  )}
                  <RawSection
                    value={{
                      coverage: ax?.coverage,
                      policy: ax?.context?.policy_version,
                      reasons: ax?.context?.reasons,
                    }}
                    label="Coverage / 过滤"
                  />
                </TabsContent>
                <TabsContent value="image" className="pt-4">
                  <div className="flex flex-col gap-4">
                    {["screenshot", "screenshot_before"].map((slot) => {
                      const artifact = observation?.artifacts?.[slot];
                      const link = observation?.evidence?.find(
                        (item: any) => item.slot === slot,
                      );
                      return (
                        <section key={slot}>
                          <h3 className="mb-2 text-xs text-muted-foreground">
                            {slot === "screenshot" ? "After" : "Before"} ·{" "}
                            {statusText(link?.status)} · {link?.delta_ms ?? "—"}{" "}
                            ms
                          </h3>
                          {artifact?.bytes ? (
                            <img
                              className="w-full rounded-md border"
                              src={"data:image/png;base64," + artifact.bytes}
                              alt={
                                slot === "screenshot"
                                  ? "动作后截图"
                                  : "动作前缓存截图"
                              }
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {link?.reason ?? "不可用"}
                            </p>
                          )}
                        </section>
                      );
                    })}
                    <Separator />
                    <h3 className="text-xs text-muted-foreground">OCR</h3>
                    <p className="detail-text">
                      {observation?.artifacts?.ocr?.payload?.content?.blocks
                        ?.map((block: any) => block.text)
                        .join("\n") ?? "不可用"}
                    </p>
                    <RawSection
                      value={observation?.artifacts?.ocr?.payload}
                      label="OCR 位置与置信度"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="understanding" className="pt-4">
                  <div className="flex flex-col gap-4">
                    <Badge variant="outline">
                      {statusText(selectedQueue?.status ?? "queued")}
                    </Badge>
                    <p className="detail-text">
                      {concise(
                        observation?.understanding?.result ??
                          observation?.understanding,
                      ) || "待处理"}
                    </p>
                    {observation?.understanding?.result?.uncertainty && (
                      <p className="detail-text text-muted-foreground">
                        {observation.understanding.result.uncertainty}
                      </p>
                    )}
                    {selectedQueue?.reason && (
                      <p className="text-xs text-muted-foreground">
                        {selectedQueue.reason}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={
                          !!busy ||
                          !state.modelRoles?.understanding?.hasKey ||
                          !observation
                        }
                        onClick={() =>
                          void act("summarize", {
                            actionId: selected?.actionId,
                            view: axView,
                          })
                        }
                      >
                        重新理解
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy || !selectedQueue}
                        onClick={() =>
                          void act("retry", { actionId: selected?.actionId })
                        }
                      >
                        <RotateCcw data-icon="inline-start" />
                        重试队列
                      </Button>
                    </div>
                    <RawSection
                      value={observation?.understanding}
                      label="证据 / 模型 / 用量"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="json" className="pt-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mb-2"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          JSON.stringify(
                            observation ?? currentRow?.detail,
                            null,
                            2,
                          ),
                        )
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <Copy data-icon="inline-start" />
                    复制
                  </Button>
                  <JSONView value={observation ?? currentRow?.detail} />
                </TabsContent>
              </Tabs>
            </div>
          </SheetContent>
        </Sheet>
        <Dialog open={settings} onOpenChange={setSettings}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>设置</DialogTitle>
              <DialogDescription className="sr-only">
                独立模型角色与允许观察的应用
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="understanding">
              <TabsList className="w-full">
                {(Object.keys(roleNames) as Role[]).map((role) => (
                  <TabsTrigger key={role} value={role}>
                    {roleNames[role]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {(Object.keys(roleNames) as Role[]).map((role) => (
                <TabsContent key={role} value={role} className="pt-3">
                  <ModelForm
                    role={role}
                    config={state.modelRoles?.[role]}
                    busy={!!busy}
                    onSave={(role, config) => act("config", { role, config })}
                  />
                </TabsContent>
              ))}
            </Tabs>
            <Separator />
            <FieldGroup className="gap-3">
              <Field className="gap-2">
                <FieldLabel htmlFor="capture-scope">观察范围</FieldLabel>
                <Select
                  value={allApps ? "all" : "selected"}
                  onValueChange={(value) => setAllApps(value === "all")}
                  disabled={state.collector.state === "running"}
                >
                  <SelectTrigger id="capture-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      所有应用（跟随前台窗口）
                    </SelectItem>
                    <SelectItem value="selected">指定应用</SelectItem>
                  </SelectContent>
                </Select>
                {!allApps && (
                  <>
                    <FieldLabel htmlFor="capture-apps">
                      应用 Bundle ID（逗号或空格分隔）
                    </FieldLabel>
                    <Input
                      id="capture-apps"
                      value={bundleIds}
                      onChange={(e) => setBundleIds(e.target.value)}
                      placeholder="com.apple.TextEdit"
                      disabled={state.collector.state === "running"}
                    />
                  </>
                )}
              </Field>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void act("permissions")}
                >
                  检测权限
                </Button>
                <span className="flex-1" />
                <Badge variant="outline">
                  {statusText(state.collector.state)}
                </Badge>
                <Button
                  size="sm"
                  disabled={
                    !!busy ||
                    (!allApps &&
                      !bundleIds.trim() &&
                      state.collector.state !== "running")
                  }
                  onClick={() =>
                    void act(
                      state.collector.state === "running"
                        ? "capture.stop"
                        : "capture.start",
                      { bundleIds, allApps },
                    )
                  }
                >
                  {state.collector.state === "running" ? "停止" : "开始观察"}
                </Button>
              </div>
              {state.collector.reason && (
                <p className="text-xs text-muted-foreground">
                  {state.collector.reason}
                </p>
              )}
              {Object.entries({
                accessibility: "辅助功能",
                screenRecording: "屏幕录制",
                inputMonitoring: "输入监控",
              }).map(([permission, label]) => (
                <div
                  key={permission}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {label} ·{" "}
                    {state.collector.permissions?.[permission] === true
                      ? "采集进程可用"
                      : state.collector.permissions?.[permission] === false
                        ? "未授权"
                        : "未检测"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void act("permission.request", { permission })
                    }
                  >
                    去授权
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                请在系统设置中确认授权应用身份，返回应用后会自动检测，也可点击“检测权限”。若系统要求，请退出并重新打开应用。开发版可能显示为
                Electron。
              </p>
            </FieldGroup>
            <Separator />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="xs"
                disabled={!!busy}
                onClick={() => void act("fixture")}
              >
                合成演示
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={!!busy}
                onClick={() => void act("readRoot")}
              >
                只读目录
              </Button>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
