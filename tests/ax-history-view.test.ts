import { test, expect } from "bun:test";
import {
  hasAXEvidence,
  precedingAXEvent,
  eventOrder,
} from "../src/observation/ax-history-view.ts";

const row = (
  id: string,
  sequence: number,
  kind = "key_down",
  status = "captured",
  pid = 1,
) => ({
  id,
  pid,
  bundleId: "fixture",
  captureStatus: status,
  trigger: {
    kind,
    sequence,
    session: "fixture",
    occurredAt: "2026-09-06T12:00:00.000Z",
    appLaunchedAt: "start",
  },
  savedAt: "2026-09-06T12:00:00.100Z",
});
test("默认隐藏空事件，按同应用上一次有效采集自动配对并报告跳过数", () => {
  const current = row("current", 10);
  const history = [
    row("previous", 6),
    row("other-app", 9, "key_down", "captured", 2),
    row("up", 9, "key_up", "event_only"),
    row("busy", 8, "key_down", "skipped_busy"),
    row("shift", 7, "modifiers_changed", "event_only"),
    current,
  ];
  const result = precedingAXEvent(
    { ...current, snapshotId: current.id },
    history,
  );
  expect(result.previous?.id).toBe("previous");
  expect(result.missing).toBe(1);
  expect(
    history
      .filter(hasAXEvidence)
      .map((r) => r.id)
      .sort(),
  ).toEqual(["current", "other-app", "previous"]);
  expect(history.sort(eventOrder)[0].id).toBe("current");
});
test("首个事件与进程重启不能错误连接基线", () => {
  const current = row("new", 2);
  const previous = {
    ...row("old", 1),
    trigger: { ...row("old", 1).trigger, appLaunchedAt: "older" },
  };
  expect(precedingAXEvent(current, [current, previous])).toEqual({
    previous: null,
    missing: 0,
  });
});
