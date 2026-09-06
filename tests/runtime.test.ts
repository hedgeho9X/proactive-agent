import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeHost } from "../src/host.ts";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { proposalSchema } from "../src/runtime.ts";

const until = async (predicate: () => boolean, timeout = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("event_timeout");
    await Bun.sleep(20);
  }
};
test("DSH sidecar 连续会话、20秒子任务期间修正、提案、取消和恢复", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-s0-"));
  let host = new RuntimeHost(root);
  const events: any[] = [];
  host.on("event", (event) => events.push(event));
  host.on("diagnostic", (message) => console.error(message));
  try {
    expect(await host.ready).toMatchObject({
      mode: "deterministic_fixture",
      liveModel: "unavailable",
    });
    const first = await host.request("observe", {
      actionId: "a1",
      value: { scenario: "dispatch", taskId: "t1", target: "Monday" },
    });
    await until(() => events.some((e) => e.kind === "tool.delay.started"));
    const started = events.find((e) => e.kind === "task.started");
    expect(started.childId).toBeTruthy();
    const before = Date.now();
    const second = await host.request("observe", {
      actionId: "a2",
      value: { scenario: "observation", fact: "用户改为周五" },
    });
    await host.request("idle");
    expect(Date.now() - before).toBeLessThan(5000);
    expect(second.sessionId).toBe(first.sessionId);
    expect(events.some((e) => e.kind === "tool.delay.stopped")).toBe(false);
    const corrected = await host.request("revise", {
      taskId: "t1",
      target: "Friday",
    });
    expect(corrected.revision).toBe(2);
    await host.request("idle", { sessionId: started.childId });
    await until(() => events.some((e) => e.kind === "proposal"));
    expect(events.find((e) => e.kind === "proposal").proposal).toMatchObject({
      target: "Friday",
      revision: 2,
      status: "not_executed",
    });
    expect(events.filter((e) => e.kind === "proposal")).toHaveLength(1);
    const childRequests = events.filter((e) => e.kind === "fixture.request");
    expect(
      childRequests.some((e) =>
        JSON.stringify(e.messages).includes(corrected.messageId),
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.kind === "session.event" &&
          e.event.type === "assistant/chunk" &&
          e.event.data.chunk.type === "text-delta",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.kind === "session.event" && e.event.type === "assistant/message",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.kind === "session.event" && e.event.type === "step/start",
      ),
    ).toBe(true);
    await host.request("observe", {
      actionId: "stale",
      value: {
        scenario: "revise",
        taskId: "t1",
        revision: 1,
        target: "Monday",
      },
    });
    await host.request("idle");
    expect(events.filter((e) => e.kind === "proposal")).toHaveLength(1);
    expect(
      events.some(
        (e) =>
          e.kind === "session.event" &&
          e.event.type === "tool/result" &&
          JSON.stringify(e.event.data).includes("superseded_task"),
      ),
    ).toBe(true);
    await host.request("observe", {
      actionId: "a3",
      value: { scenario: "dispatch", taskId: "t2", target: "Tuesday" },
    });
    await until(() =>
      events.some((e) => e.kind === "tool.delay.started" && e.taskId === "t2"),
    );
    const cancelAt = Date.now();
    expect(await host.request("cancel", { taskId: "t2" })).toMatchObject({
      status: "stopped",
    });
    expect(Date.now() - cancelAt).toBeLessThan(3000);
    expect(
      events.some(
        (e) =>
          e.kind === "tool.delay.stopped" && e.taskId === "t2" && e.aborted,
      ),
    ).toBe(true);
    const replay = await host.request("events");
    const cursors: Record<string, number> = {};
    for (const row of replay)
      cursors[row.sessionId] = Math.max(
        cursors[row.sessionId] ?? -1,
        row.event.seq,
      );
    expect(await host.request("events", { cursors })).toEqual([]);
    await host.close();
    expect(host.child.exitCode).toBe(0);
    host = new RuntimeHost(root, { resume: true });
    await host.ready;
    expect(
      await host.request("observe", {
        actionId: "a1",
        value: { scenario: "dispatch", taskId: "t1", target: "Monday" },
      }),
    ).toMatchObject({ status: "duplicate" });
    await host.request("observe", {
      actionId: "a4",
      value: { scenario: "observation", fact: "恢复后的新观察" },
    });
    await host.request("idle");
    const resumed = await host.request("events");
    expect(
      resumed.some((r: any) => JSON.stringify(r.event).includes("action:a1")),
    ).toBe(true);
    expect(
      resumed.some((r: any) => JSON.stringify(r.event).includes("action:a4")),
    ).toBe(true);
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);

test("proposal Schema 拒绝实际执行、缺失字段与多余字段", () => {
  const valid = {
    proposalId: "p",
    taskId: "t",
    revision: 1,
    operation: "calendar.update",
    target: "Friday",
    status: "not_executed",
  };
  expect(validateJsonSchemaValue(proposalSchema, valid)).toEqual([]);
  expect(
    validateJsonSchemaValue(proposalSchema, { ...valid, status: "executed" })
      .length,
  ).toBeGreaterThan(0);
  expect(
    validateJsonSchemaValue(proposalSchema, { ...valid, secret: "x" }).length,
  ).toBeGreaterThan(0);
  expect(
    validateJsonSchemaValue(proposalSchema, { status: "not_executed" }).length,
  ).toBeGreaterThan(0);
});

test("图片附件经过真实持久层抵达 adapter，正文引用不影响 action 去重", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-image-"));
  const host = new RuntimeHost(root, { delayMs: 100 });
  const events: any[] = [];
  host.on("event", (event) => events.push(event));
  try {
    await host.ready;
    const imageBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    const deliveries = await Promise.all(
      [1, 2, 3].map(() =>
        host.request("observe", {
          actionId: "image",
          value: { scenario: "observation", reference: "action:future" },
          imageBase64,
        }),
      ),
    );
    expect(
      deliveries.filter((receipt) => receipt.status === "persisted"),
    ).toHaveLength(1);
    expect(
      deliveries.filter((receipt) => receipt.status === "duplicate"),
    ).toHaveLength(2);
    await host.request("idle");
    expect(
      events.some(
        (e) =>
          e.kind === "fixture.image" &&
          e.verifiedBytes > 0 &&
          e.messageId === "action:image",
      ),
    ).toBe(true);
    expect(
      await host.request("observe", {
        actionId: "future",
        value: { scenario: "observation" },
      }),
    ).toMatchObject({ status: "persisted" });
    await host.request("idle");
    expect(
      await host.request("observe", {
        actionId: "future",
        value: { scenario: "observation" },
      }),
    ).toMatchObject({ status: "duplicate" });
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("continuable child已retire后仍可冷恢复修正，idle取消不重新执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "proactive-cold-"));
  const host = new RuntimeHost(root, { delayMs: 50 });
  const events: any[] = [];
  host.on("event", (event) => events.push(event));
  try {
    await host.ready;
    await host.request("observe", {
      actionId: "cold-action",
      value: { scenario: "dispatch", taskId: "cold-task", target: "Monday" },
    });
    await until(() => events.some((e) => e.kind === "task.started"));
    const childId = events.find((e) => e.kind === "task.started").childId;
    await until(() =>
      events.some(
        (e) => e.kind === "agent.disposed" && e.sessionId === childId,
      ),
    );
    expect(
      await host.request("revise", { taskId: "cold-task", target: "Friday" }),
    ).toMatchObject({ revision: 2 });
    await until(() => events.some((e) => e.kind === "proposal"));
    expect(events.find((e) => e.kind === "proposal").proposal).toMatchObject({
      revision: 2,
      target: "Friday",
      status: "not_executed",
    });
    await until(
      () =>
        events.filter(
          (e) => e.kind === "agent.disposed" && e.sessionId === childId,
        ).length === 2,
    );
    expect(await host.request("cancel", { taskId: "cold-task" })).toMatchObject(
      { status: "stopped" },
    );
    expect(events.filter((e) => e.kind === "tool.delay.started")).toHaveLength(
      1,
    );
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("子消息拒绝时回滚revision和target", async () => {
  const { ProactiveRuntime } = await import("../src/runtime.ts");
  const root = await mkdtemp(join(tmpdir(), "proactive-reject-"));
  const runtime = new ProactiveRuntime(root, () => {}, 1);
  try {
    await runtime.start();
    runtime.tasks.set("missing", {
      taskId: "missing",
      childId: "not-a-child",
      revision: 1,
      target: "Monday",
      status: "running",
    });
    await expect(runtime.revise("missing", "Friday")).rejects.toThrow();
    expect(runtime.tasks.get("missing")).toMatchObject({
      revision: 1,
      target: "Monday",
    });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("快速child退休不影响多action主回执，全量flush跳过退休快照", async () => {
  const { ProactiveRuntime } = await import("../src/runtime.ts");
  const root = await mkdtemp(join(tmpdir(), "retire-flush-"));
  const events: any[] = [];
  const runtime = new ProactiveRuntime(root, (e) => events.push(e), 15);
  try {
    await runtime.start();
    await runtime.observe("spawn", {
      scenario: "dispatch",
      taskId: "fast-child",
      target: "test",
    });
    await until(() => events.some((e) => e.kind === "tool.delay.started"));
    const sessionFlush = runtime.ctx.sessions.flush.bind(runtime.ctx.sessions);
    let delayed = false;
    runtime.ctx.sessions.flush = async (session) => {
      if (session.id === "proactive-main" && !delayed) {
        delayed = true;
        await until(() => events.some((e) => e.kind === "agent.disposed"));
      }
      return sessionFlush(session);
    };
    await runtime.flush();
    for (let i = 0; i < 15; i++)
      expect(
        await runtime.observe("next-" + i, { scenario: "observation" }),
      ).toMatchObject({ status: "persisted" });
    await runtime.idle();
    expect(events.some((e) => e.kind === "agent.disposed")).toBe(true);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("已入队后持久化失败重试会重新flush且不重复消息", async () => {
  const { ProactiveRuntime } = await import("../src/runtime.ts");
  const root = await mkdtemp(join(tmpdir(), "retry-flush-"));
  const runtime = new ProactiveRuntime(root, () => {}, 1);
  try {
    await runtime.start();
    const real = runtime.ctx.sessions.flush.bind(runtime.ctx.sessions);
    let calls = 0;
    runtime.ctx.sessions.flush = async (session) => {
      calls++;
      if (calls === 1) throw new Error("fixture_disk_failure");
      return real(session);
    };
    await expect(
      runtime.observe("retry-one", { scenario: "observation" }),
    ).rejects.toThrow("fixture_disk_failure");
    expect(
      await runtime.observe("retry-one", { scenario: "observation" }),
    ).toMatchObject({ status: "duplicate" });
    expect(calls).toBe(2);
    await runtime.idle();
    expect(
      runtime
        .events()
        .filter(
          (row) =>
            row.event.type === "user/message" &&
            row.event.data.id === "action:retry-one",
        ),
    ).toHaveLength(1);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
