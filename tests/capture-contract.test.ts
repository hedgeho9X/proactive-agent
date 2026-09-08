import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AXHistory } from "../src/observation/ax-history.ts";
import { AXRecorder } from "../src/observation/ax-recorder.ts";
import { captureDiagnostic } from "../src/observation/capture-diagnostics.ts";
import { UnderstandingService } from "../src/model/understanding.ts";
test("空 AX 占位不能算截图成功，不进入 AI，保留失败阶段及系统错误", async () => {
  const root = await mkdtemp(join(tmpdir(), "capture-contract-"));
  try {
    const history = new AXHistory(root, async () => {});
    let delivered = 0;
    const recorder = new AXRecorder(
      "fixture",
      history,
      async () => ({
        nodes: [{ attributes: {} }],
        screenshot: {
          status: "error",
          stage: "screenshot_capture",
          reason: "screenshot_api_failed",
          diagnostics: {
            target: { id: 123, pid: 456 },
            domain: "fixture-domain",
            code: 42,
            message: "fixture-error",
          },
        },
      }),
      () => {},
      async () => {
        delivered++;
      },
    );
    const id = "ax-" + crypto.randomUUID();
    await recorder.accept({ id, pid: 456, app: "fixture", kind: "click" });
    const snapshot = await history.get(id);
    expect(snapshot.captureStatus).toBe("failed");
    expect(snapshot.captureError).toBe("screenshot_api_failed");
    expect(delivered).toBe(0);
    expect(captureDiagnostic(snapshot)).toMatchObject({
      stage: "screenshot_capture",
      targetId: 123,
      detail: { domain: "fixture-domain", code: 42 },
    });
    expect((await history.list())[0].hasScreenshot).toBe(false);
    const service = new UnderstandingService(join(root, "cache"), () => {});
    await expect(
      service.summarize(
        {
          action: { action_id: id },
          artifacts: {},
          evidence: [],
          revision: 1,
          view: "raw",
        },
        { model: "fixture", apiKey: "fixture" },
      ),
    ).rejects.toThrow("screenshot_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("三路采集上限下前三条并行，过载事件带具体并发诊断", async () => {
  const root = await mkdtemp(join(tmpdir(), "capture-concurrency-"));
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const history = new AXHistory(root, async () => {});
    const recorder = new AXRecorder(
      "fixture",
      history,
      async () => {
        await pending;
        return {
          nodes: [],
          screenshot: { status: "captured", data: "fixture" },
        };
      },
      () => {},
      undefined,
      3,
    );
    const ids = Array.from({ length: 4 }, () => "ax-" + crypto.randomUUID());
    const jobs = ids.map((id) =>
      recorder.accept({ id, pid: 1, kind: "click" }),
    );
    await jobs[3];
    expect(await history.get(ids[3])).toMatchObject({
      captureStatus: "skipped_busy",
      captureDiagnostics: { inFlight: 3, limit: 3 },
    });
    finish();
    await Promise.all(jobs);
    expect(
      (await history.list()).filter((row) => row.hasScreenshot),
    ).toHaveLength(3);
    expect(recorder.status().capturing).toBe(0);
  } finally {
    finish();
    await rm(root, { recursive: true, force: true });
  }
});
