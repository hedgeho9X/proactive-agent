/** 应用图标组件预览；宿主仅提供本机图标接口，不读取模型或采集历史。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { ApplicationIcon } from "../src/renderer/application-icon.tsx";
(window as any).proactive = {
  invoke: (_method: string, params: any) =>
    fetch(`/icon?bundleId=${encodeURIComponent(params.bundleId)}`).then(
      (response) => response.json(),
    ),
};
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-xl p-8">
    <h1 className="mb-6 font-medium">本机应用图标 · 组件验收</h1>
    {[
      ["com.openai.codex", "ChatGPT"],
      ["com.brave.Browser", "Brave Browser"],
      ["com.tencent.xinWeChat", "微信"],
      ["nonexistent.fixture", "未安装应用"],
    ].map(([bundleId, name]) => (
      <div className="flex items-center gap-3 border-b py-4" key={bundleId}>
        <ApplicationIcon bundleId={bundleId!} name={name!} />
        <span>{name}</span>
      </div>
    ))}
  </main>,
);
