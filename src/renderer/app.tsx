import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { projectEvents, type StreamRow } from "./projection.ts";
import "./style.css";
declare global {
  interface Window {
    proactive: {
      invoke: (method: string, p?: unknown) => Promise<any>;
      subscribe: (listener: () => void) => () => void;
    };
  }
}
const api = window.proactive;
function JSONView({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
function AXTree({ nodes }: { nodes: any[] }) {
  const ids = new Set(nodes.map((n) => n.node_id));
  const children = new Map<string | null, any[]>();
  for (const node of nodes) {
    const parent = ids.has(node.parent_id) ? node.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const render = (node: any, ancestors: Set<string>): React.ReactNode => {
    if (ancestors.has(node.node_id))
      return <p key={node.node_id}>循环节点 {node.node_id}</p>;
    const next = new Set([...ancestors, node.node_id]);
    return (
      <details
        key={node.node_id}
        open={node.clicked || node.focused ? true : undefined}
        className={node.clicked || node.focused ? "ax-target" : ""}
      >
        <summary>
          <b>{node.role ?? "Node"}</b>{" "}
          <span>{node.title || node.value || node.node_id}</span>
          {node.clicked ? " · clicked" : node.focused ? " · focus" : ""}
        </summary>
        <small>
          {node.node_id}
          {node.protected ? " · protected" : ""}
        </small>
        {node.value && <p>{node.value}</p>}
        {next.size < 40 &&
          (children.get(node.node_id) ?? []).map((child) =>
            render(child, next),
          )}
      </details>
    );
  };
  return (
    <div className="tree">
      {(children.get(null) ?? []).map((node) => render(node, new Set()))}
    </div>
  );
}
function App() {
  const [state, setState] = useState<any>({
    actions: [],
    activities: [],
    events: [],
    collector: { state: "stopped" },
    mode: "unavailable",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [observation, setObservation] = useState<any>(null);
  const [tab, setTab] = useState("overview");
  const [axView, setAXView] = useState<"raw" | "context">("context");
  const [settings, setSettings] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gemini-3.8-flash");
  const [bundleIds, setBundleIds] = useState("");
  const [prompt, setPrompt] = useState("");
  const [follow, setFollow] = useState(true);
  const [revision, setRevision] = useState("Friday");
  const feed = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  async function refresh() {
    try {
      setState(await api.invoke("snapshot"));
    } catch (e) {
      setError(String(e));
    }
  }
  async function act(name: string, p: unknown = {}) {
    setBusy(name);
    setError("");
    try {
      const result = await api.invoke(name, p);
      await refresh();
      return result;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    void refresh();
    return api.subscribe(() => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void refresh();
      }, 80);
    });
  }, []);
  useEffect(() => {
    if (follow && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [state.events.length, state.actions.length, follow]);
  useEffect(() => {
    if (selected?.actionId)
      void api
        .invoke("observation", { actionId: selected.actionId })
        .then(setObservation)
        .catch((e) => setError(String(e)));
  }, [
    selected?.actionId,
    state.actions.find((a: any) => a.action.action_id === selected?.actionId)
      ?.revision,
  ]);
  const agentRows = projectEvents(state.events);
  const actionRows: StreamRow[] = state.actions
    .slice()
    .reverse()
    .map((o: any) => ({
      id: o.action.action_id,
      time: new Date(o.action.occurred_at).toLocaleTimeString(),
      timestamp: Date.parse(o.action.occurred_at),
      label: o.action.app?.name ?? o.action.app?.bundle_id ?? "Desktop",
      kind: "action",
      text:
        o.action.kind +
        " · " +
        (o.action.target_hint?.role ??
          o.action.input?.key_category ??
          o.action.policy_status),
      detail: o,
    }));
  const rows: StreamRow[] =
    filter === "agent"
      ? agentRows
      : filter === "raw"
        ? actionRows
        : filter === "activity"
          ? state.activities
              .slice()
              .reverse()
              .map((a: any) => ({
                id: a.id,
                time: new Date(a.started).toLocaleTimeString(),
                timestamp: a.started,
                label: "Activity · " + a.count + " actions",
                kind: "activity",
                text: a.kind,
                detail: a,
              }))
          : [...actionRows, ...agentRows].sort(
              (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
            );
  const tasks = new Map<string, any>();
  for (const e of state.events) {
    if (e.kind?.startsWith("task."))
      tasks.set(e.taskId, { ...tasks.get(e.taskId), ...e });
    if (e.kind === "agent.status")
      for (const task of tasks.values())
        if (
          task.childId === e.sessionId &&
          !["stopped", "interrupted"].includes(task.status)
        )
          task.status = e.status;
  }
  const usage = state.events
    .filter(
      (e: any) =>
        e.kind === "model.usage" || e.kind === "understanding.completed",
    )
    .reduce(
      (v: any, e: any) => ({
        input: v.input + (e.usage?.inputTokens ?? e.inputTokens ?? 0),
        output: v.output + (e.usage?.outputTokens ?? e.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    );
  const ax = observation?.artifacts?.ax?.payload?.content;
  const nodes =
    axView === "raw" ? ax?.nodes : (ax?.context?.context ?? ax?.nodes);
  const screenshot = observation?.artifacts?.screenshot;
  const beforeScreenshot = observation?.artifacts?.screenshot_before;
  const ocr = observation?.artifacts?.ocr;
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          ◈
          <span>
            Proactive
            <br />
            <b>LAB</b>
          </span>
        </div>
        <div className="section-label">WORKSPACE</div>
        <button className="rail-active">◉ 观察工作台</button>
        <button onClick={() => setSettings(true)}>⚙ 模型与采集</button>
        <div className="rail-bottom">
          <span className="dot" />
          LOCAL FIRST
          <br />
          <small>独立实验应用 · v0.1</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">OBSERVE · UNDERSTAND · ACT</div>
            <h1>观察工作台</h1>
            <p>追踪每一次观察，以及它如何成为 Agent 的行动。</p>
          </div>
          <div className="header-controls">
            <span
              className={"pill " + (state.mode === "gemini" ? "green" : "")}
            >
              {state.mode === "unavailable"
                ? "模型未配置"
                : state.mode === "gemini"
                  ? "GEMINI · " + state.connection
                  : "FIXTURE · 合成演示"}
            </span>
            <button onClick={() => setSettings(true)}>设置</button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                state.collector.state === "running"
                  ? void act("capture.stop")
                  : setSettings(true)
              }
            >
              {state.collector.state === "running" ? "停止采集" : "开始采集"}
            </button>
          </div>
        </header>
        <div className="metrics">
          <div>
            <span>采集状态</span>
            <strong>
              <i
                className={
                  state.collector.state === "running" ? "dot" : "dot idle"
                }
              />
              {state.collector.state}
            </strong>
          </div>
          <div>
            <span>本地 Action</span>
            <strong>
              {state.actions.length}
              <small> 最近 200 条</small>
            </strong>
          </div>
          <div>
            <span>Agent / Sub-agent</span>
            <strong>
              {state.mode === "unavailable" ? 0 : 1} / {tasks.size}
              <small>
                {" "}
                {state.mode === "unavailable" ? "尚未启动" : "当前运行时"}
              </small>
            </strong>
          </div>
          <div>
            <span>模型用量 · 本次运行</span>
            <strong>
              {usage.input + usage.output}
              <small> tokens · 费用未配置</small>
            </strong>
          </div>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        <div className="workspace">
          <section className="stream">
            <div className="stream-toolbar">
              <div className="tabs">
                {[
                  ["all", "实时流"],
                  ["raw", "Raw"],
                  ["activity", "活动"],
                  ["agent", "Agent"],
                ].map(([id, title]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <button className="quiet" onClick={() => setFollow(!follow)}>
                {follow ? "↓ 自动跟随" : "恢复跟随"}
              </button>
            </div>
            <div
              className="feed"
              ref={feed}
              onScroll={() => {
                if (
                  feed.current &&
                  feed.current.scrollHeight -
                    feed.current.scrollTop -
                    feed.current.clientHeight >
                    80
                )
                  setFollow(false);
              }}
            >
              {rows.length ? (
                rows.map((row) => (
                  <button
                    className={
                      "feed-row " + (selected?.id === row.id ? "selected" : "")
                    }
                    key={row.id}
                    onClick={() => {
                      setSelected({
                        ...row,
                        actionId:
                          row.kind === "action"
                            ? row.id
                            : row.kind === "activity"
                              ? state.actions.find(
                                  (o: any) => o.activity_id === row.id,
                                )?.action.action_id
                              : undefined,
                      });
                      if (!["action", "activity"].includes(row.kind))
                        setObservation(null);
                    }}
                  >
                    <div className={"icon " + row.kind}>
                      {row.kind === "action"
                        ? "↗"
                        : row.kind === "tool"
                          ? "⌘"
                          : row.kind === "assistant"
                            ? "✧"
                            : "·"}
                    </div>
                    <div className="row-content">
                      <div className="row-top">
                        <b>{row.label}</b>
                        <time>{row.time}</time>
                        {row.live && <small>处理中</small>}
                      </div>
                      <p>{row.text}</p>
                      <small>{row.id}</small>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty">
                  <div className="empty-symbol">◎</div>
                  <h2>从一次观察开始</h2>
                  <p>
                    选择允许观察的应用，然后开启采集。
                    <br />
                    也可以先体验主代理与子代理的合成演示。
                  </p>
                  <button onClick={() => void act("fixture")} disabled={!!busy}>
                    运行 Fixture 演示 →
                  </button>
                  <small>无屏幕采集 · 无真实模型调用</small>
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) {
                  void act("prompt", { text: prompt });
                  setPrompt("");
                }
              }}
            >
              <input
                aria-label="用户 Prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  state.mode === "unavailable"
                    ? "配置模型或启动 Fixture 后发送 Prompt"
                    : "给主动式 Agent 一条消息…"
                }
              />
              <button disabled={state.mode === "unavailable" || !prompt.trim()}>
                发送 ↗
              </button>
            </form>
          </section>
          <aside className="inspector">
            <div className="inspector-title">
              <b>观察检查器</b>
              <span>{selected ? "DETAIL" : "等待选择"}</span>
            </div>
            {selected ? (
              <>
                <div className="selected-heading">
                  <small>
                    {selected.kind === "action" ? "ACTION" : "AGENT EVENT"}
                  </small>
                  <h3>{selected.label}</h3>
                  <code>{selected.id}</code>
                </div>
                <div className="inspector-tabs">
                  {[
                    ["overview", "概览"],
                    ["screenshot", "截图"],
                    ["ax", "AX 树"],
                    ["ocr", "OCR"],
                    ["understanding", "理解"],
                    ["details", "详情"],
                  ].map(([id, title]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={tab === id ? "active" : ""}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <div className="inspector-body">
                  {tab === "overview" && (
                    <>
                      {observation ? (
                        <>
                          <h4>动作与时序</h4>
                          <JSONView
                            value={{
                              action: observation.action,
                              revision: observation.revision,
                            }}
                          />
                          <h4>证据关联</h4>
                          {observation.evidence.map((e: any) => (
                            <div className="evidence" key={e.slot ?? e.kind}>
                              <b>{e.slot ?? e.kind}</b>
                              <span>{e.status}</span>
                              <small>
                                {e.delta_ms ?? "—"} ms ·{" "}
                                {e.reason ?? e.artifact_id ?? "无关联"}
                              </small>
                            </div>
                          ))}
                        </>
                      ) : (
                        <JSONView value={selected.detail} />
                      )}
                    </>
                  )}
                  {tab === "screenshot" &&
                    (screenshot?.bytes ? (
                      <>
                        <small>After · {screenshot.id}</small>
                        <img
                          className="screenshot"
                          src={"data:image/png;base64," + screenshot.bytes}
                        />
                        {beforeScreenshot?.bytes && (
                          <>
                            <small>Before · {beforeScreenshot.id}</small>
                            <img
                              className="screenshot"
                              src={
                                "data:image/png;base64," +
                                beforeScreenshot.bytes
                              }
                            />
                          </>
                        )}
                      </>
                    ) : (
                      <p className="muted">
                        截图尚未采集或不可用。请在概览查看原因。
                      </p>
                    ))}
                  {tab === "ax" && (
                    <>
                      <div className="tabs">
                        <button
                          className={axView === "context" ? "active" : ""}
                          onClick={() => setAXView("context")}
                        >
                          Context
                        </button>
                        <button
                          className={axView === "raw" ? "active" : ""}
                          onClick={() => setAXView("raw")}
                        >
                          Raw
                        </button>
                      </div>
                      <small>
                        {nodes?.length ?? 0} nodes · 点击节点可折叠展开
                      </small>
                      {nodes?.length ? (
                        <AXTree nodes={nodes} />
                      ) : (
                        <p className="muted">AX 不可用，未构造替代树。</p>
                      )}
                      <details>
                        <summary>Coverage / 过滤原因</summary>
                        <JSONView
                          value={{
                            coverage: ax?.coverage,
                            policy: ax?.context?.policy_version,
                            reasons: ax?.context?.reasons,
                          }}
                        />
                      </details>
                    </>
                  )}
                  {tab === "ocr" &&
                    (ocr ? (
                      <JSONView value={ocr.payload} />
                    ) : (
                      <p className="muted">OCR 不可用，必须关联实际截图。</p>
                    ))}
                  {tab === "understanding" && (
                    <>
                      <p className="muted">
                        根据当前 {axView === "raw" ? "Raw AX" : "Context AX"} +
                        Screenshot 生成事实短句；推测单独标记。
                      </p>
                      <button
                        disabled={!observation || !state.hasKey || !!busy}
                        onClick={async () => {
                          await act("summarize", {
                            actionId: selected.actionId,
                            view: axView,
                          });
                          setObservation(
                            await api.invoke("observation", {
                              actionId: selected.actionId,
                            }),
                          );
                        }}
                      >
                        理解这次动作
                      </button>
                      {!state.hasKey && <p>unavailable · 请先配置本应用模型</p>}
                      {observation?.understanding ? (
                        <JSONView value={observation.understanding} />
                      ) : (
                        <p className="muted">尚无理解结果。</p>
                      )}
                    </>
                  )}
                  {tab === "details" && (
                    <JSONView value={observation ?? selected.detail} />
                  )}
                </div>
              </>
            ) : (
              <div className="inspector-empty">
                选择一条 Action 查看
                <br />
                截图、AX、OCR 与事实理解。
                <br />
                <br />
                选择 Agent 消息查看
                <br />
                输入、输出与工具意图。
              </div>
            )}
            <div className="tasks">
              <h4>
                子任务 <span>{tasks.size}</span>
              </h4>
              <p className="muted">历史会话可回放；旧任务不会自动继续。</p>
              {[...tasks.values()].map((task) => (
                <div className="task-card" key={task.taskId}>
                  <b>{task.taskId}</b>
                  <small>
                    {task.status} · revision {task.revision} · {task.target}
                  </small>
                  <input
                    aria-label={"修正目标 " + task.taskId}
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                  />
                  <div>
                    <button
                      disabled={["stopped", "interrupted"].includes(
                        task.status,
                      )}
                      onClick={() =>
                        void act("revise", {
                          taskId: task.taskId,
                          target: revision,
                        })
                      }
                    >
                      发送修正
                    </button>
                    <button
                      disabled={["stopped", "interrupted"].includes(
                        task.status,
                      )}
                      onClick={() =>
                        void act("cancel", { taskId: task.taskId })
                      }
                    >
                      取消任务
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
        <footer>
          <span>
            ● {state.collector.state === "running" ? "正在采集" : "采集已关闭"}{" "}
            · {state.collector.reason ?? "只观察允许列表中的应用"}
          </span>
          <span>
            {busy ? "处理中：" + busy : "本地证据与 DSH 会话独立持久化"}
          </span>
        </footer>
      </main>
      {settings && (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-heading">
              <h2>模型与采集</h2>
              <button onClick={() => setSettings(false)}>关闭</button>
            </div>
            <h4>Gemini · 独立配置</h4>
            <p>Key 只存在本次进程内存；不会读取旧应用配置。</p>
            <label>
              模型
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="仅本次运行有效"
              />
            </label>
            <button
              disabled={!key || !!busy}
              onClick={async () => {
                const result = await act("config", { apiKey: key, model });
                if (result) setKey("");
              }}
            >
              应用模型配置
            </button>
            <button onClick={() => void act("fixture")} disabled={!!busy}>
              切换 Fixture 演示
            </button>
            <h4>允许观察的应用</h4>
            <label>
              Bundle IDs
              <textarea
                value={bundleIds}
                onChange={(e) => setBundleIds(e.target.value)}
                placeholder="例如 com.apple.TextEdit；多个以逗号分隔"
              />
            </label>
            <div className="button-row">
              <button onClick={() => void act("permissions")}>检查权限</button>
              <button
                className="primary"
                disabled={!bundleIds.trim() || !!busy}
                onClick={async () => {
                  const result = await act("capture.start", { bundleIds });
                  if (result) setSettings(false);
                }}
              >
                开始捕获
              </button>
              <button onClick={() => void act("capture.stop")}>停止</button>
            </div>
            <JSONView value={state.collector} />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.autoUnderstand}
                onChange={(e) =>
                  void act("auto", { enabled: e.target.checked })
                }
              />
              自动理解非逐键动作（最多 6 次/分钟）
            </label>
            <button onClick={() => void act("readRoot")}>
              选择文件只读测试目录
            </button>
            <small>{state.allowedReadRoot ?? "尚未授权文件读取目录"}</small>
            <small>数据目录：{state.dataDir}</small>
            {error && <p className="error">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
