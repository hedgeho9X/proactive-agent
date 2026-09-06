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
