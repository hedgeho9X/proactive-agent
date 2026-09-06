import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeHost } from "../src/host.ts";

test("未发送消息的会话重启后仍可恢复", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-empty-session-"));
  let host = new RuntimeHost(root);
  try {
    await host.ready;
    await host.close();
    host = new RuntimeHost(root, { resume: true });
    const events: any[] = [];
    host.on("event", (event) => events.push(event));
    await expect(host.ready).resolves.toMatchObject({
      sessionId: "proactive-main",
    });
    expect(
      events.some((event) => event.kind === "runtime.session_missing"),
    ).toBe(false);
  } finally {
    await host.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("陈旧启动标记请求恢复缺失会话时可创建新会话", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-missing-session-"));
  const host = new RuntimeHost(root, { resume: true });
  try {
    await expect(host.ready).resolves.toMatchObject({
      sessionId: "proactive-main",
    });
    await host.request("observe", {
      actionId: "startup-check",
      value: { scenario: "observation", fact: "fixture" },
    });
    await host.request("idle");
  } finally {
    await host.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
