import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AXHistory } from "../src/observation/ax-history.ts";
import { AXRecorder } from "../src/observation/ax-recorder.ts";

test("键盘/点击每条落盘，忙时不积压截图，松开只保留事件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ax-recorder-test-"));
  const history = new AXHistory(dir, async () => {});
  let finish!: (v: any) => void;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const recorder = new AXRecorder(
    "fixture",
    history,
    async () => {
      calls++;
      return waiting;
    },
    () => {},
  );
  const event = (kind: string, key: string) => ({
    id: "ax-" + randomUUID(),
    pid: 123,
    app: "fixture",
    bundleId: "fixture",
    occurredAt: new Date().toISOString(),
    kind,
    key,
  });
  try {
    const enter = event("key_down", "Enter");
    const job = recorder.accept(enter);
    const click = event("click", "");
    const up = event("key_up", "Enter");
    await recorder.accept(click);
    await recorder.accept(up);
    expect((await history.get(click.id)).captureStatus).toBe("skipped_busy");
    expect((await history.get(up.id)).captureStatus).toBe("event_only");
    finish({
      pid: 123,
      app: "fixture",
      nodes: [],
      capturedAt: "later",
      screenshot: { status: "captured", data: "fixture" },
    });
    await job;
    expect(calls).toBe(1);
    expect((await history.list()).length).toBe(3);
    expect(await history.get(enter.id)).toMatchObject({
      captureStatus: "captured",
      trigger: { key: "Enter" },
      capturedAt: "later",
    });
  } finally {
    finish({ nodes: [] });
    await rm(dir, { recursive: true, force: true });
  }
});
