import { resolve } from "node:path";
import { RuntimeHost } from "./host.ts";
// 默认演示只产生合成观测；日志目录完全归新应用所有。
const host = new RuntimeHost(resolve(".runtime/demo-" + Date.now()), {
  delayMs: 2_000,
});
let childId: string | undefined;
host.on("event", (event) => {
  if (event.kind === "task.started") childId = event.childId;
  // 只展示语义状态，完整模型请求由测试或后续调试界面按需读取。
  if (
    [
      "task.started",
      "tool.delay.started",
      "tool.delay.stopped",
      "proposal",
      "session.flushed",
    ].includes(event.kind)
  )
    console.log(JSON.stringify(event));
});
host.on("diagnostic", (message) => console.error(message));
try {
  console.log(JSON.stringify(await host.ready));
  await host.request("observe", {
    actionId: "demo-1",
    value: { scenario: "dispatch", taskId: "demo-task", target: "Monday" },
  });
  await host.request("idle");
  await host.request("observe", {
    actionId: "demo-2",
    value: { scenario: "observation", fact: "用户将目标修正为周五" },
  });
  await host.request("revise", { taskId: "demo-task", target: "Friday" });
  await host.request("idle", { sessionId: childId });
} finally {
  await host.close();
}
