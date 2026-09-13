/** Agentic Understanding 设置和步骤视图的合成预览，不连接模型或真实凭证。 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchSettings } from "../src/renderer/search-settings.tsx";
import { AITrace } from "../src/renderer/ai-trace.tsx";

(window as any).proactive = {
  async invoke() {
    return {
      model: "fixture-model",
      status: "completed",
      output: {
        action_title: "查看论文A的记忆检索方法",
        action_detail: "通过历史记录确认论文名称，当前页面讨论按任务检索事件。",
      },
      systemPrompt: "为下游主动式 Agent 提供标题级摘要",
      userPrompt: "合成当前观察和历史标题",
      tools: ["get_action_detail"],
      steps: [
        {
          step: 1,
          status: "completed",
          elapsedMs: 240,
          usage: { inputTokens: 950, outputTokens: 32 },
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "get_action_detail",
              input: { action_id: "prior" },
            },
          ],
        },
        { step: 2, text: "完成理解" },
      ],
      toolCalls: [
        {
          name: "get_action_detail",
          toolCallId: "call-1",
          status: "completed",
          input: { action_id: "prior" },
          elapsedMs: 2,
          result: { content: "论文A" },
        },
      ],
    };
  },
};

/** 仅维护界面上的已配置状态，不保存输入内容。 */
function Preview() {
  const [hasKey, setHasKey] = useState(false);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <h1>Agentic Understanding · 合成验收</h1>
      <SearchSettings
        hasKey={hasKey}
        save={async (_method, params) => {
          setHasKey(!!(params as any).apiKey);
          return true;
        }}
      />
      <AITrace id="fixture" status="delivered" />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
