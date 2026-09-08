import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FocusOverlay } from "./focus-overlay.tsx";
export function AITrace({
  id,
  status,
  reason,
}: {
  id: string;
  status?: string;
  reason?: string;
}) {
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setTrace(null);
    setError("");
    const load = () =>
      window.proactive
        .invoke("ai.trace", { id })
        .then((value) => {
          if (active) setTrace(value);
        })
        .catch(() => {
          if (active) setError("请求记录暂不可读");
        });
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
      <p className="text-xs text-muted-foreground">
        {trace
          ? `${trace.model} · ${trace.status} · ${trace.elapsedMs ?? "…"} ms`
          : "尚未调用 AI：等待配置、筛选或有效证据"}{" "}
        {reason} {error}
      </p>
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
      {trace && (
        <Tabs defaultValue="output">
          <TabsList variant="line">
            <TabsTrigger value="output">输出</TabsTrigger>
            <TabsTrigger value="prompt">中文 Prompt</TabsTrigger>
            <TabsTrigger value="image">AI 看到的图片</TabsTrigger>
            <TabsTrigger value="input">完整输入</TabsTrigger>
          </TabsList>
          <TabsContent value="output" className="flex flex-col gap-3">
            {trace.output && (
              <>
                <p className="font-medium">{trace.output.action_title}</p>
                <p className="whitespace-pre-wrap text-sm">
                  {trace.output.action_detail}
                </p>
              </>
            )}
            <p className="text-sm text-destructive">{trace.error}</p>
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
      )}
    </div>
  );
}
