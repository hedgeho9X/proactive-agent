import React, { useState, useEffect } from "react";
import { attributeText, diffAX } from "./ax-diff.ts";
import { Button } from "@/components/ui/button";

// 历史快照由主进程持久化；面板仅加载当前快照和对比基线。
export function AXLab() {
  const [apps, setApps] = useState<any[]>([]);
  const [pid, setPid] = useState("");
  const [snapshot, setSnapshot] = useState<any>(null);
  const [before, setBefore] = useState<any>(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("attributes");
  const [countdown, setCountdown] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [notice, setNotice] = useState("");
  const refreshHistory = async () =>
    setHistory(await window.proactive.invoke("ax.history"));
  useEffect(() => {
    void refreshHistory().catch(() => setError("无法读取快照历史"));
  }, []);
  const manage = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refreshHistory();
    } catch {
      setError("快照操作失败，记录可能已删除或存储不可用，请刷新历史重试。");
    } finally {
      setBusy(false);
    }
  };
  const load = async (id: string, baseline = false) => {
    const value = await window.proactive.invoke("ax.load", { id });
    if (baseline) setBefore(value);
    else {
      setSnapshot(value);
      setSelected(value.focusId ?? value.nodes[0]?.id ?? "");
    }
  };
  const capture = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // 留出三秒让用户切回目标应用并操作输入框。
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setCountdown(0);
      const result = await window.proactive.invoke("ax.inspect", {
        pid: Number(pid),
      });
      if (result.error) throw new Error(result.error);
      setBefore(snapshot);
      setSnapshot(result);
      setSelected(result.focusId ?? result.nodes[0]?.id ?? "");
      await refreshHistory();
      setNotice("快照已保存到本地");
    } catch {
      setError(
        "采集失败：请确认目标仍在运行、权限已开启，或稍后重试（最长等待 15 秒）。",
      );
    } finally {
      setBusy(false);
      setCountdown(0);
    }
  };
  const node = snapshot?.nodes.find((item: any) => item.id === selected);
  const differences = diffAX(before, snapshot);
  return (
    <section
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="AX 观测台"
    >
      <header className="border-b p-4">
        <h1 className="text-lg font-semibold">AX 观测台</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          快照自动保存到本地，不自动上传模型。复制 ID 后可发给 Codex 一起分析。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setError("");
              try {
                const result = await window.proactive.invoke("ax.apps");
                setApps(result.apps);
              } catch {
                setError("无法枚举应用，请检查采集器构建。");
              }
            }}
          >
            刷新应用
          </Button>
          <select
            aria-label="目标应用"
            className="max-w-80 rounded border bg-background p-2 text-sm"
            value={pid}
            disabled={busy}
            onChange={(event) => {
              setPid(event.target.value);
              setSnapshot(null);
              setBefore(null);
            }}
          >
            <option value="">选择目标应用</option>
            {apps.map((app) => (
              <option key={app.pid} value={app.pid}>
                {app.name} · {app.pid}
              </option>
            ))}
          </select>
          <Button disabled={!pid || busy} onClick={() => void capture()}>
            {busy
              ? countdown
                ? `${countdown} 秒后采集，请切回目标应用`
                : "处理中…"
              : "采集快照（延迟 3 秒）"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSnapshot(null);
              setBefore(null);
            }}
          >
            清除当前视图
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void manage(refreshHistory)}
          >
            刷新历史
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !history.length}
            onClick={() =>
              void manage(async () => {
                const result = await window.proactive.invoke("ax.clear");
                if (result.cancelled) return;
                const remaining = await window.proactive.invoke("ax.history");
                setHistory(remaining);
                if (
                  !remaining.some(
                    (item: any) => item.id === snapshot?.snapshotId,
                  )
                )
                  setSnapshot(null);
                if (
                  !remaining.some((item: any) => item.id === before?.snapshotId)
                )
                  setBefore(null);
                setNotice(
                  `已移到废纸篓 ${result.deleted} 条${result.failed.length ? `，${result.failed.length} 条失败` : ""}`,
                );
              })
            }
          >
            一键清空历史
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>历史 {history.length} 条</span>
          <select
            aria-label="历史快照"
            className="max-w-96 rounded border bg-background p-2 text-xs"
            disabled={busy}
            value={snapshot?.snapshotId ?? ""}
            onChange={(event) => {
              if (event.target.value)
                void manage(() => load(event.target.value));
            }}
          >
            <option value="">选择已保存快照</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.capturedAt} · {item.app} · {item.nodes} 节点 · {item.id}
              </option>
            ))}
          </select>
          <select
            aria-label="对比基线"
            className="max-w-80 rounded border bg-background p-2 text-xs"
            disabled={busy}
            value={before?.snapshotId ?? ""}
            onChange={(event) => {
              if (event.target.value)
                void manage(() => load(event.target.value, true));
              else setBefore(null);
            }}
          >
            <option value="">选择对比基线（可选）</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.capturedAt} · {item.app} · {item.id}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !snapshot?.snapshotId}
            onClick={() =>
              void manage(async () => {
                await window.proactive.invoke("ax.copy", {
                  id: snapshot.snapshotId,
                });
                setNotice("已复制快照 ID 和本地文件路径，可直接粘贴给 Codex");
              })
            }
          >
            复制 ID
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !snapshot?.snapshotId}
            onClick={() =>
              void manage(async () => {
                await window.proactive.invoke("ax.delete", {
                  id: snapshot.snapshotId,
                });
                if (before?.snapshotId === snapshot.snapshotId) setBefore(null);
                setSnapshot(null);
                setNotice("快照已移到系统废纸篓，可恢复");
              })
            }
          >
            删除当前快照
          </Button>
        </div>
        {snapshot?.snapshotId && (
          <p className="mt-2 break-all text-xs text-muted-foreground">
            ID：{snapshot.snapshotId}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-2 text-sm">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {snapshot && (
          <p className="mt-2 text-xs text-muted-foreground">
            {snapshot.app} · {snapshot.bundleId} · {snapshot.capturedAt} ·{" "}
            {snapshot.elapsedMs}ms · {snapshot.nodes.length} 节点 ·{" "}
            {snapshot.partial ? "预算截断，非完整树" : "本次遍历完成"} ·
            AX窗口状态码 {snapshot.windowCode} · 焦点状态码 {snapshot.focusCode}
          </p>
        )}
      </header>
      {!snapshot ? (
        <div className="p-6 text-sm text-muted-foreground">
          先刷新应用并选择目标。建议依次测试
          TextEdit：输入中文、删除、粘贴、全选，然后再测试微信。每次采集会与上一次快照比较。
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,30%)_minmax(0,1fr)]">
          <aside className="overflow-auto border-r p-3" aria-label="AX 节点树">
            <input
              aria-label="筛选节点"
              className="mb-3 w-full rounded border p-2 text-sm"
              placeholder="筛选角色、标题、文本…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {snapshot.nodes
              .filter((item: any) =>
                JSON.stringify(item)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setTab("attributes");
                  }}
                  className={`mb-1 block w-full rounded p-2 text-left text-xs ${selected === item.id ? "bg-muted" : "hover:bg-muted/50"}`}
                  style={{
                    paddingLeft: Math.min(48, item.path.split("/").length * 8),
                  }}
                >
                  <span className="font-medium">
                    {item.id} {attributeText(item, "AXRole") || "未知角色"}{" "}
                    {item.id === snapshot.focusId ? "· 焦点" : ""}{" "}
                    {item.protected ? "· 已保护" : ""}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {attributeText(item, "AXTitle") ||
                      attributeText(item, "AXValue") ||
                      item.path}
                  </span>
                </button>
              ))}
          </aside>
          <div className="min-w-0 overflow-auto p-4">
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                ["attributes", "节点属性"],
                ["diff", `前后差异 ${differences.length}`],
                ["screenshot", "截图"],
                ["raw", "完整快照"],
              ].map(([id, label]) => (
                <Button
                  key={id}
                  size="sm"
                  variant={tab === id ? "secondary" : "ghost"}
                  onClick={() => setTab(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {tab === "attributes" && node && (
              <>
                <p className="mb-3 text-sm">
                  {node.id} · 父节点 {node.parent ?? "无"} · 路径 {node.path}
                </p>
                {node.protected && (
                  <p className="mb-3 text-sm">
                    受保护输入：不读取其内容和子节点。
                  </p>
                )}
                <p className="mb-3 text-xs text-muted-foreground">
                  属性枚举状态码：{node.attributeListCode}
                  。可执行操作只展示名称，不执行；参数化属性只列出名称。
                </p>
                <table className="w-full table-fixed text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="w-1/3 p-2">属性</th>
                      <th className="w-24 p-2">状态</th>
                      <th className="p-2">值／错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(node.attributes).map(([name, raw]) => {
                      const a = raw as any;
                      return (
                        <tr key={name} className="border-b align-top">
                          <td className="break-all p-2">{name}</td>
                          <td className="p-2">
                            {{
                              ok: "已读取",
                              no_value: "无值",
                              unsupported: "不支持",
                              error: "失败",
                              not_read: "未读取",
                            }[a.status as string] ?? a.status}
                          </td>
                          <td className="whitespace-pre-wrap break-all p-2">
                            {JSON.stringify(
                              a.value ?? { code: a.code, reason: a.reason },
                              null,
                              2,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <details className="mt-4">
                  <summary>支持的操作与参数化属性</summary>
                  <pre className="whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(
                      {
                        actions: node.actions,
                        actionsCode: node.actionsCode,
                        parameterizedAttributes: node.parameterizedAttributes,
                        parameterizedCode: node.parameterizedCode,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </>
            )}
            {tab === "diff" && (
              <>
                <p className="mb-3 text-sm">
                  按同应用的结构路径与角色做候选匹配；布局变化或采集截断可能导致误匹配。临时节点编号不用于跨快照匹配。
                </p>
                {!before ? (
                  <p>再采集一次才能对比。</p>
                ) : (
                  <pre className="whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(differences, null, 2)}
                  </pre>
                )}
              </>
            )}
            {tab === "screenshot" && (
              <>
                <p className="mb-3 text-sm">
                  {snapshot.screenshot.status} ·{" "}
                  {snapshot.screenshot.reason ??
                    snapshot.screenshot.selection ??
                    snapshot.screenshot.code}
                </p>
                {snapshot.screenshot.data && (
                  <img
                    alt="目标应用窗口快照"
                    className="max-w-full rounded border"
                    src={`data:image/png;base64,${snapshot.screenshot.data}`}
                  />
                )}
              </>
            )}
            {tab === "raw" && (
              <pre className="whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(
                  {
                    ...snapshot,
                    screenshot: {
                      ...snapshot.screenshot,
                      data: snapshot.screenshot.data
                        ? "图片见截图页"
                        : undefined,
                    },
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
