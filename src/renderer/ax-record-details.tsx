/** 按 AI 结果、截图、技术详情组织单条记录；不改变采集和投递策略。 */
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FocusOverlay } from "./focus-overlay.tsx";
import { attributeText } from "./ax-attributes.ts";
import { AITrace } from "./ai-trace.tsx";
import { DetailDisclosure } from "./detail-disclosure.tsx";
import { CaptureStatus } from "./capture-status.tsx";

/** 读取当前记录，在折叠区保留 AX、采集诊断与原始数据。 */
export function AXRecordDetails({
  recordId,
  status,
  aiStatus,
  aiReason,
  recording,
  onRemoved,
  summary,
}: {
  recordId: string;
  status?: string;
  aiStatus?: string;
  aiReason?: string;
  recording: boolean;
  onRemoved: () => void;
  summary?: { action_title?: string; action_detail?: string };
}) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [tab, setTab] = useState("ax");
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [nodeId, setNodeId] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError("");
    setNotice("");
    void window.proactive
      .invoke("ax.load", { id: recordId })
      .then((value) => {
        if (cancelled) return;
        setSnapshot(value);
        const s = value;
        setNodeId(
          s.nodes.some((node: any) => node.id === s.focusId)
            ? s.focusId
            : (s.nodes[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled) setError("记录读取失败，可能已被删除");
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, status]);
  const node = snapshot?.nodes.find((node: any) => node.id === nodeId);
  /** 执行记录复制或删除，并反馈失败状态。 */
  async function act(method: string) {
    setBusy(true);
    setError("");
    try {
      await window.proactive.invoke(method, { id: recordId });
      if (method === "ax.delete") onRemoved();
      else setNotice("已复制当前记录 ID");
    } catch {
      setError("操作失败，请先停止记录后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-col gap-4 p-4" aria-label="本地证据详情">
      <section aria-label="AI 理解">
        <h3 className="mb-2 font-medium">AI 理解</h3>
        <AITrace
          id={recordId}
          status={aiStatus}
          reason={aiReason}
          summary={summary}
        />
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !snapshot}
          onClick={() => void act("ax.copy")}
        >
          复制 ID
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || recording || !snapshot}
          onClick={() => void act("ax.delete")}
        >
          删除记录
        </Button>
        <span className="text-xs text-muted-foreground">
          Agent：
          {(
            {
              queued: "待理解",
              understanding: "理解中",
              ready: "等待主 Agent",
              delivering: "主 Agent 处理中",
              delivered: "已交给主 Agent",
              filtered: "未触发",
              failed: "失败",
            } as Record<string, string>
          )[aiStatus ?? ""] ?? "仅记录／等待有效证据"}{" "}
          {aiReason}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs">
          {notice}
        </p>
      )}
      {!snapshot && !error && <p className="text-sm">加载证据…</p>}
      {snapshot && (
        <>
          {(snapshot.captureStatus === "failed" ||
            !snapshot.screenshot?.data) && (
            <CaptureStatus snapshot={snapshot} />
          )}
          <section aria-label="截图">
            {snapshot.screenshot?.data ? (
              <FocusOverlay
                screenshot={snapshot.screenshot}
                trigger={snapshot.trigger}
                onSelectNode={(id) => {
                  setNodeId(id);
                  setTab("ax");
                  setTechnicalOpen(true);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                此事件没有截图：
                {snapshot.captureError ??
                  snapshot.screenshot?.reason ??
                  snapshot.captureStatus ??
                  "不可用"}
              </p>
            )}
          </section>

          <DetailDisclosure
            title="技术详情 · AX / 采集诊断 / 原始记录"
            open={technicalOpen}
            onOpenChange={setTechnicalOpen}
          >
            <p className="break-all text-xs text-muted-foreground">
              {recordId}
            </p>
            <CaptureStatus snapshot={snapshot} />
            <p className="text-xs">
              {snapshot.trigger?.kind ?? "手动快照"} ·{" "}
              {(snapshot.trigger?.modifiers ?? []).join("+")}{" "}
              {snapshot.trigger?.key} · {snapshot.captureStatus ?? "captured"} ·{" "}
              {snapshot.nodes.length} 个节点 {snapshot.captureError}
            </p>
            <p className="text-xs text-muted-foreground">
              当前：{snapshot.trigger?.occurredAt ?? snapshot.capturedAt}
            </p>
            {snapshot.timing && (
              <p className="text-xs text-muted-foreground">
                事件→截图请求：
                {snapshot.timing.eventAt &&
                snapshot.timing.screenshotRequestedAt
                  ? `${Date.parse(snapshot.timing.screenshotRequestedAt) - Date.parse(snapshot.timing.eventAt)}ms`
                  : "不可用"}{" "}
                · AX {snapshot.timing.axStartedAt} →{" "}
                {snapshot.timing.axCompletedAt}
              </p>
            )}
            {snapshot.alignment?.sameWindow === false && (
              <p className="text-sm text-amber-700">
                AX 与截图窗口不一致，不作为同一画面理解。
              </p>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList variant="line">
                <TabsTrigger value="ax">AX 属性</TabsTrigger>
                <TabsTrigger value="raw">原始记录</TabsTrigger>
              </TabsList>
              <TabsContent value="ax" className="pt-3">
                <input
                  className="mb-3 w-full rounded border bg-background p-2 text-sm"
                  aria-label="筛选 AX 节点"
                  placeholder="搜索角色、title、value、description…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="grid grid-cols-[minmax(120px,30%)_minmax(0,1fr)] gap-3">
                  <div className="max-h-[55vh] overflow-auto">
                    {snapshot.nodes
                      .filter((n: any) =>
                        JSON.stringify(n)
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((n: any) => (
                        <button
                          key={n.id}
                          className={`mb-1 block w-full rounded p-2 text-left text-xs ${nodeId === n.id ? "bg-muted" : "hover:bg-muted/50"}`}
                          onClick={() => setNodeId(n.id)}
                        >
                          <span>
                            {n.id} · {attributeText(n, "AXRole")}{" "}
                            {n.id === snapshot.focusId ? "· 焦点" : ""}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {attributeText(n, "AXTitle") ||
                              attributeText(n, "AXValue") ||
                              attributeText(n, "AXDescription") ||
                              n.path}
                          </span>
                        </button>
                      ))}
                  </div>
                  <div className="min-w-0">
                    {node ? (
                      <>
                        <p className="mb-2 break-all text-xs">
                          {node.id} · 路径 {node.path} · 父节点{" "}
                          {node.parent ?? "无"} ·{" "}
                          {node.protected ? "受保护" : ""}
                        </p>
                        <table className="w-full table-fixed text-xs">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="w-1/3 p-2">属性</th>
                              <th className="p-2">值／状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(node.attributes ?? {}).map(
                              ([key, raw]) => {
                                const value = raw as any;
                                return (
                                  <tr key={key} className="border-b align-top">
                                    <td className="break-all p-2">{key}</td>
                                    <td className="whitespace-pre-wrap break-all p-2">
                                      {value.status}{" "}
                                      {JSON.stringify(
                                        value.value ?? {
                                          code: value.code,
                                          reason: value.reason,
                                        },
                                        null,
                                        2,
                                      )}
                                    </td>
                                  </tr>
                                );
                              },
                            )}
                          </tbody>
                        </table>
                        <details className="mt-3 text-xs">
                          <summary>支持的操作、参数及读取覆盖</summary>
                          <pre className="whitespace-pre-wrap break-all">
                            {JSON.stringify(
                              {
                                actions: node.actions,
                                parameterizedAttributes:
                                  node.parameterizedAttributes,
                                attributeListCode: node.attributeListCode,
                                partial: snapshot.partial,
                                limits: snapshot.limits,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        本条没有 AX 节点，事件已记录。
                        {snapshot.captureError ?? snapshot.captureStatus}
                      </p>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="raw" className="pt-3">
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    {
                      ...snapshot,
                      screenshot: {
                        ...snapshot.screenshot,
                        data: snapshot.screenshot?.data
                          ? "图片见截图页"
                          : undefined,
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
              </TabsContent>
            </Tabs>
          </DetailDisclosure>
        </>
      )}
    </div>
  );
}
