/** 通过受控原生树验证定向阅读策略；不读取真实用户正文。 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("阅读 AX 保存选区与局部深层正文，不混入其他容器", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-context-"));
  try {
    const binary = join(root, "check");
    const built = spawnSync("swiftc", ["tests/native-reading-context/main.swift", "native/collector/Sources/Collector/ReadingContext.swift", "-o", binary], { encoding: "utf8" });
    expect(built.status, built.stderr).toBe(0);
    const result = spawnSync(binary, [], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
