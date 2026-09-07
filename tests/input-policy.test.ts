import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { meaningfulAXEvent } from "../src/observation/ax-history-view.ts";

test("历史视图遵循普通字母数字过滤并保留组合键", () => {
  const event = (key: string, modifiers: string[] = [], keyCode?: number) => ({
    trigger: { kind: "key_down", key, modifiers, keyCode },
  });
  expect(meaningfulAXEvent(event("A"))).toBe(false);
  expect(meaningfulAXEvent(event("A", ["Shift"]))).toBe(false);
  expect(meaningfulAXEvent(event("1"))).toBe(false);
  expect(meaningfulAXEvent(event("Key82", [], 82))).toBe(false);
  expect(meaningfulAXEvent(event("C", ["Cmd"]))).toBe(true);
  expect(meaningfulAXEvent(event("A", ["Ctrl"]))).toBe(true);
  for (const key of ["Enter", "Space", "Tab", "Backspace", "Left", "F1"])
    expect(meaningfulAXEvent(event(key))).toBe(true);
});
test.skipIf(process.platform !== "darwin")(
  "原生过滤覆盖26字母、两组数字及操作键",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "key-policy-"));
    try {
      const binary = join(dir, "check");
      const built = spawnSync(
        "swiftc",
        [
          "tests/native-key-policy/main.swift",
          "native/collector/Sources/Collector/InputPolicy.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );
      expect(built.status, built.stderr).toBe(0);
      expect(spawnSync(binary, [], { encoding: "utf8" }).stdout).toContain(
        "PASS",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
