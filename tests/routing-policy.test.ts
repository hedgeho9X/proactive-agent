import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultRouting,
  matchesRouting,
  snapshotRoutingReason,
} from "../src/observation/routing-policy.ts";
import { RoutingStore } from "../src/observation/routing-store.ts";
import { axObservation } from "../src/observation/ax-agent-bridge.ts";
import { projectAXRecords } from "../src/renderer/ax-stream.ts";
import { understandingSchema } from "../src/model/understanding.ts";

test("默认仅Enter和空格进入Agent，保护或错位证据不可发送", () => {
  for (const key of ["Enter", "NumpadEnter", "Space"])
    expect(matchesRouting({ kind: "key_down", key }, defaultRouting)).toBe(
      true,
    );
  for (const key of ["Tab", "Escape", "A"])
    expect(matchesRouting({ kind: "key_down", key }, defaultRouting)).toBe(
      false,
    );
  expect(matchesRouting({ kind: "click" }, defaultRouting)).toBe(false);
  expect(matchesRouting({ kind: "click" }, ["click"])).toBe(true);
  expect(
    matchesRouting({ kind: "key_down", key: "C", modifiers: ["Cmd"] }, [
      "shortcuts",
    ]),
  ).toBe(true);
  const snapshot = {
    captureStatus: "captured",
    trigger: { kind: "key_down", key: "Enter" },
    nodes: [],
    screenshot: { data: "fixture" },
  };
  expect(snapshotRoutingReason(snapshot, defaultRouting)).toBeUndefined();
  expect(
    snapshotRoutingReason(
      { ...snapshot, alignment: { sameWindow: false } },
      defaultRouting,
    ),
  ).toBe("evidence_window_mismatch");
  expect(
    snapshotRoutingReason(
      { ...snapshot, screenshot: { status: "excluded" } },
      defaultRouting,
    ),
  ).toBe("protected_evidence");
  expect(
    (understandingSchema as any).properties.intent_hypothesis,
  ).toBeUndefined();
});
test("触发设置可重开，空列表表示全部关闭", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routing-"));
  try {
    const file = join(dir, "policy.json");
    const store = new RoutingStore(file);
    await store.load();
    expect(store.get()).toEqual(defaultRouting);
    await store.update([]);
    const reopened = new RoutingStore(file);
    await reopened.load();
    expect(reopened.get()).toEqual([]);
    await expect(store.update(["invented"])).rejects.toThrow(
      "invalid_routing_policy",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("快照按需适配模型证据，保留value、区域和缺失状态；统一流无需旧action查询", () => {
  const snapshot = {
    snapshotId: "ax-fixture",
    savedAt: "2026-09-08T00:00:00Z",
    capturedAt: "2026-09-08T00:00:00Z",
    pid: 1,
    app: "fixture",
    bundleId: "fixture",
    trigger: {
      kind: "key_down",
      key: "Enter",
      occurredAt: "2026-09-08T00:00:00Z",
      sequence: 1,
    },
    focusId: "n1",
    nodes: [
      {
        id: "n1",
        parent: null,
        attributes: {
          AXRole: { value: { text: "AXTextField" } },
          AXValue: { value: { text: "测试内容" } },
        },
      },
    ],
    screenshot: { data: "fixture-image", regions: { focus: { nodeId: "n1" } } },
  };
  const observation = axObservation(snapshot);
  expect(observation.action.action_id).toBe("ax-fixture");
  expect(observation.artifacts.screenshot?.bytes).toBe("fixture-image");
  expect(observation.artifacts.ax?.payload.content.nodes[0].value).toBe(
    "测试内容",
  );
  expect(observation.evidence.every((item) => item.status !== "pending")).toBe(
    true,
  );
  const row = projectAXRecords([
    {
      ...snapshot,
      id: snapshot.snapshotId,
      nodes: 1,
      captureStatus: "captured",
    },
  ])[0];
  expect(row.actionId).toBeUndefined();
  expect(row.detail.axRecord.id).toBe("ax-fixture");
});
