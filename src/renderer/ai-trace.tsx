/** 优先展示动作理解，完整 Prompt、模型输入和响应按需展开。 */
import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DetailDisclosure } from "./detail-disclosure.tsx";
import { FocusOverlay } from "./focus-overlay.tsx";
import { UnderstandingChain } from "./understanding-chain.tsx";
/** 加载单条理解追踪，历史追踪过期时仍展示持久化摘要。 */
export function AITrace({
  id,
  status,
  reason,
  summary,
  panels,
}: {
  id: string;
  status?: string;
  reason?: string;
  summary?: { action_title?: string; action_detail?: string };
  panels?: {
    screenshot?: any;
    trigger?: any;
    ax?: React.ReactNode;
    diagnostics?: React.ReactNode;
    actions?: React.ReactNode;
  };
}) {
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setTrace(null);
    setError("");
    let pending = false;
    const load = () => {
      if (pending) return;
      pending = true;
      return window.proactive
        .invoke("ai.trace", { id })
        .then((value) => {
          if (active) setTrace(value);
        })
        .catch(() => {
          if (active) setError("请求记录暂不可读");
        })
        .finally(() => {
          pending = false;
        });
    };
    void load();
    const timer = [
      "capturing",
      "queued",
      "understanding",
      "ready",
      "delivering",
    ].includes(status ?? "")
      ? setInterval(() => void load(), 1000)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [id, status]);
  return (
    <div className="flex flex-col gap-3" aria-label="AI 理解追踪">
      {(trace?.output ?? summary)?.action_title ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">
            {(trace?.output ?? summary).action_title}
          </p>
          <p className="whitespace-pre-wrap text-sm">
            {(trace?.output ?? summary).action_detail}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {status === "editing" || status === "editing_closed"
            ? "输入框 AX 状态持续记录；编辑过程不逐条调用 AI。"
            : status === "understanding"
              ? "AI 正在理解这次操作…"
              : status === "failed"
                ? "AI 理解失败"
                : status === "queued"
                  ? "等待 AI 理解…"
                  : status === "filtered"
                    ? "此操作未进入 AI 理解"
                    : "暂无 AI 理解结果"}
        </p>
      )}
      {(trace?.error || error || reason) && (
        <p role="alert" className="text-sm text-destructive">
          {trace?.error || error || reason}
        </p>
      )}
      {status === "failed" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.proactive.invoke("retry", { actionId: id })
          }
        >
          重试处理
        </Button>
      )}
      {panels?.actions}
      <Tabs key={id} defaultValue="image">
        <TabsList variant="line">
          <TabsTrigger value="image">截图</TabsTrigger>
          <TabsTrigger value="prompt">原始输入 Prompt</TabsTrigger>
          <TabsTrigger value="trace">观测</TabsTrigger>
          <TabsTrigger value="ax">AX 树</TabsTrigger>
        </TabsList>
        <TabsContent value="image">
          {trace?.image ? (
            <FocusOverlay
              key={trace.imageHash}
              screenshot={{ data: trace.image, annotated: true }}
            />
          ) : panels?.screenshot?.data ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                当前采集的标注预览；模型输入图尚未生成或缓存已过期。
              </p>
              <FocusOverlay
                screenshot={panels.screenshot}
                trigger={panels.trigger}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              没有可用截图：
              {panels?.screenshot?.reason ?? "尚未采集或图片已过期"}
              。完整诊断见观测。
            </p>
          )}
          {trace?.image && (
            <p className="mt-2 break-all text-xs text-muted-foreground">
              与模型输入共用同一张图片 · SHA256 {trace.imageHash}
            </p>
          )}
        </TabsContent>
        <TabsContent value="prompt">
          {trace ? (
            <div className="flex flex-col gap-3">
              <h4 className="font-medium">System</h4>
              <pre className="whitespace-pre-wrap break-all text-xs">
                {trace.systemPrompt}
              </pre>
              <h4 className="font-medium">User · 注入后的实际内容</h4>
              <pre className="whitespace-pre-wrap break-all text-xs">
                {trace.userPrompt}
              </pre>
            </div>
          ) : (
            <p>尚无模型请求，或追踪已过期。</p>
          )}
        </TabsContent>
        <TabsContent value="trace">
          {trace ? (
            <UnderstandingChain key={id} trace={trace} />
          ) : (
            <p className="text-sm">尚无 Agent Trace。</p>
          )}
          <DetailDisclosure title="采集诊断与原始记录">
            {panels?.diagnostics ?? "暂无采集诊断"}
          </DetailDisclosure>
        </TabsContent>
        <TabsContent value="ax">
          <DetailDisclosure key={id} title="展开 AX 树结构">
            {panels?.ax ?? "暂无 AX 数据"}
          </DetailDisclosure>
        </TabsContent>
      </Tabs>
    </div>
  );
}
