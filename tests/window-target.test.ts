import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test.skipIf(process.platform !== "darwin")(
  "按坐标和层级锁定窗口 ID，支持同应用重叠/同尺寸和负坐标显示器",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "window-target-"));
    try {
      const binary = join(root, "test");
      const built = spawnSync(
        "swiftc",
        [
          "tests/native-window-target/main.swift",
          "native/collector/Sources/Collector/WindowTarget.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );
      expect(built.status, built.stderr).toBe(0);
      const result = spawnSync(binary, [], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("PASS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
