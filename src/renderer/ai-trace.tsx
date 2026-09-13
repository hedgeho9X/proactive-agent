/** 优先展示动作理解，完整 Prompt、模型输入和响应按需展开。 */
import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DetailDisclosure } from "./detail-disclosure.tsx";
import { FocusOverlay } from "./focus-overlay.tsx";
/** 加载单条理解追踪，历史追踪过期时仍展示持久化摘要。 */
export function AITrace({
  id,
  status,
  reason,
  summary,
}: {
  id: string;
  status?: string;
  reason?: string;
  summary?: { action_title?: string; action_detail?: string };
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
    const timer = ["queued", "understanding"].includes(status ?? "")
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
          {status === "understanding"
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
      <DetailDisclosure title="查看 AI 请求详情">
        <p className="text-xs text-muted-foreground">
          {trace
            ? `${trace.model} · ${trace.status} · ${trace.elapsedMs ?? "…"} ms`
            : "完整追踪暂不可用"}{" "}
          {reason} {error}
        </p>
        {trace ? (
          <Tabs defaultValue="output">
            <TabsList variant="line">
              <TabsTrigger value="output">输出</TabsTrigger>
              <TabsTrigger value="prompt">中文 Prompt</TabsTrigger>
              <TabsTrigger value="image">AI 看到的图片</TabsTrigger>
              <TabsTrigger value="input">完整输入</TabsTrigger>
            </TabsList>
            <TabsContent value="output" className="flex flex-col gap-3">
              <details>
                <summary>模型原始输出</summary>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {trace.rawOutput ?? "尚未返回"}
                </pre>
              </details>
            </TabsContent>
            <TabsContent value="prompt">
              <p className="mb-2 text-xs text-muted-foreground">
                这是本次请求实际使用的 Prompt；修改未来请求请到设置。
              </p>
              <pre className="whitespace-pre-wrap break-all text-sm">
                {trace.systemPrompt}
              </pre>
            </TabsContent>
            <TabsContent value="image">
              {trace.image ? (
                <FocusOverlay
                  key={trace.imageHash}
                  screenshot={{ data: trace.image, annotated: true }}
                />
              ) : (
                <p>本次没有图片，或输入图片缓存已过期。</p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                输入图 SHA256：{trace.imageHash ?? "无"}
              </p>
            </TabsContent>
            <TabsContent value="input">
              <pre className="whitespace-pre-wrap break-all text-xs">
                {trace.userPrompt}
              </pre>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-xs text-muted-foreground">
            完整追踪暂不可用或已过期，已保存的理解摘要不受影响。
          </p>
        )}
      </DetailDisclosure>
    </div>
  );
}
