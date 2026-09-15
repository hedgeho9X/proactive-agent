/** 使用合成段落验证真实详情组件，不请求模型或读取用户会话。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { AXRecordDetails } from "../src/renderer/ax-record-details.tsx";

const selected = "先过滤权限，再检索候选。";
const context = `${selected}候选按相关度排序，最后返回来源链接。\n此段为已采到的局部正文，其他段落未取得。`;
const reading = {
  status: "partial",
  nonAtomic: true,
  selectedText: {
    text: selected,
    source: "AXSelectedText",
    nodeId: "reading:focus",
    sampledAt: "2026-09-15T04:00:00Z",
    range: { location: 0, length: selected.length, unit: "utf16" },
    truncated: false,
  },
  context: {
    text: context,
    source: "AXRelatedSubtree",
    scope: "related_subtree",
    sampledAt: "2026-09-15T04:00:00Z",
    truncated: true,
    reason: "subtree_only_not_complete_reply",
    selectionRelation: "selected_text_found_in_context",
  },
};
const result = {
  description: "在研究会话中查看检索方案，选中“先过滤权限，再检索候选。”",
  detail: `当前左键命中方案正文，选区说明了检索顺序。\n\n已取得的相关原文：\n${context}`,
};
const canvas = document.createElement("canvas");
canvas.width = 1000;
canvas.height = 350;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, 1000, 350);
ctx.fillStyle = "#222";
ctx.font = "24px system-ui";
ctx.fillText("研究会话 · 合成页面", 40, 65);
ctx.fillText(selected, 40, 130);
ctx.fillText("候选按相关度排序，最后返回来源链接。", 40, 180);
ctx.strokeStyle = "#f59e0b";
ctx.strokeRect(34, 100, 370, 42);
const image = canvas.toDataURL("image/png").split(",")[1];
(window as any).proactive = {
  async invoke(method: string) {
    if (method === "ai.trace")
      return {
        actionId: "reading-fixture",
        model: "fixture",
        status: "completed",
        output: result,
        contextEvidence: reading,
        image,
        systemPrompt: "合成规则",
        userPrompt: "合成阅读上下文",
      };
    if (method === "ax.load")
      return {
        readingContext: reading,
        snapshotId: "reading-fixture",
        captureStatus: "captured",
        nodes: [],
        screenshot: { status: "captured", data: image, annotated: true },
      };
    return {};
  },
};
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-5xl p-6">
    <h1 className="mb-3 font-medium">阅读上下文 · 合成验收</h1>
    <AXRecordDetails
      recordId="reading-fixture"
      aiStatus="delivered"
      recording={false}
      onRemoved={() => {}}
      summary={result}
    />
  </main>,
);
