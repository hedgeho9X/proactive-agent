/** 使用合成证据预览真实详情组件；所有 IPC 在本页替身处理，不连接采集器和模型。 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AXRecordDetails } from "../src/renderer/ax-record-details.tsx";
import {
  UnderstandingText,
  understandingCost,
} from "../src/renderer/understanding-row.tsx";

const canvas = document.createElement("canvas");
canvas.width = 1200;
canvas.height = 650;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#f4f4f3";
ctx.fillRect(0, 0, 1200, 650);
ctx.fillStyle = "#242424";
ctx.font = "28px system-ui";
ctx.fillText("Example Project", 60, 80);
ctx.font = "22px system-ui";
ctx.fillText("Selected folder: demo-project", 60, 160);
ctx.fillStyle = "#2675d9";
ctx.fillRect(930, 520, 180, 65);
ctx.fillStyle = "white";
ctx.fillText("Open", 985, 561);
const image = canvas.toDataURL("image/png").split(",")[1];
const summary = {
  action_title: "在文件夹选择框中点击 Open",
  action_detail: "当前选中 demo-project 文件夹，用户点击 Open 按钮。",
};
const snapshot = {
  nodes: [
    {
      id: "button",
      attributes: {
        AXRole: { status: "ok", value: { text: "AXButton" } },
        AXTitle: { status: "ok", value: { text: "Open" } },
      },
    },
  ],
  clickedId: "button",
  captureStatus: "captured",
  capturedAt: "2026-09-13T12:00:00Z",
  trigger: { kind: "click", x: 500, y: 280 },
  screenshot: {
    status: "captured",
    data: image,
    coordinateSpace: "screen_top_left_points",
    shadowsExcluded: true,
    frame: { x: 0, y: 0, width: 600, height: 325 },
    pixelWidth: 1200,
    pixelHeight: 650,
    regions: {
      click: {
        status: "available",
        nodeId: "button",
        rect: { x: 465, y: 260, width: 90, height: 32.5 },
      },
    },
  },
};
const api = {
  async invoke(method: string, params: any) {
    if (method === "ax.load")
      return params.id === "failed"
        ? {
            ...snapshot,
            captureStatus: "failed",
            screenshot: { status: "error", reason: "target_window_closed" },
          }
        : snapshot;
    if (method === "ai.trace")
      return params.id === "expired" || params.id === "failed"
        ? null
        : {
            model: "fixture-model",
            status: "completed",
            elapsedMs: 250,
            output: summary,
            image,
            systemPrompt: "合成 System Prompt",
            userPrompt: "合成 User Prompt",
            rawOutput: JSON.stringify(summary),
            actionId: "fixture-action",
            startedAt: "2026-09-13T12:00:00Z",
            steps: [
              {
                step: 1,
                status: "completed",
                elapsedMs: 180,
                startedAt: "2026-09-13T12:00:00Z",
                messages: [{ role: "user", content: "查看当前选中的目录" }],
                usage: { inputTokens: 950, outputTokens: 30 },
                toolCalls: [
                  {
                    toolCallId: "lookup",
                    toolName: "get_action_ax",
                    input: { action_id: "fixture-action" },
                  },
                ],
              },
              {
                step: 2,
                status: "completed",
                elapsedMs: 70,
                text: JSON.stringify(summary),
              },
            ],
            toolCalls: [
              {
                step: 1,
                toolCallId: "lookup",
                name: "get_action_ax",
                status: "completed",
                elapsedMs: 5,
                input: { action_id: "fixture-action" },
                result: { focused: "Open", role: "AXButton" },
              },
            ],
          };
    if (method === "ax.copyImage") {
      (window as any).copiedFixtureImage = params.dataUrl;
      return { copied: true };
    }
    return {};
  },
};
(window as any).proactive = api;

/** 切换合成状态，验证追踪过期、采集失败和正常截图的布局。 */
function Preview() {
  const [id, setId] = useState("success");
  return (
    <main style={{ maxWidth: 980, margin: "24px auto" }}>
      <header style={{ padding: 16 }}>
        <h1>详情布局 · 合成验收</h1>
        <nav>
          {["success", "expired", "failed"].map((value) => (
            <button
              key={value}
              onClick={() => setId(value)}
              style={{ marginRight: 16 }}
            >
              {value}
            </button>
          ))}
        </nav>
      </header>
      <button className="event-row w-full" data-understood="true">
        <span className="event-time">09-13 20:00:00</span>
        <span className="event-kind">示例应用</span>
        <UnderstandingText
          title={summary.action_title}
          detail={summary.action_detail}
        />
        <span className="text-xs text-muted-foreground">
          {understandingCost({ totalTokens: 980, elapsedMs: 250 })}
        </span>
      </button>
      <AXRecordDetails
        key={id}
        recordId={id}
        aiStatus={id === "failed" ? "failed" : "delivered"}
        recording={false}
        onRemoved={() => {}}
        summary={id === "failed" ? undefined : summary}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
