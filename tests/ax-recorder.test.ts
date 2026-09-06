import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AXHistory } from "../src/observation/ax-history.ts";
import { AXRecorder } from "../src/observation/ax-recorder.ts";

test("只记录按下和点击，忙时保留原因，松开不再生成空快照", async () => {
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
    await expect(history.get(up.id)).rejects.toThrow();
    finish({
      pid: 123,
      app: "fixture",
      nodes: [],
      capturedAt: "later",
      screenshot: { status: "captured", data: "fixture" },
    });
    await job;
    expect(calls).toBe(1);
    expect((await history.list()).length).toBe(2);
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
