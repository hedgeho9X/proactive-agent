import { test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { AXInspectorClient } from "../src/observation/ax-inspector-client.ts";

test("预热进程重复使用并匹配请求，异常退出后能够重启", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspector-client-"));
  const binary = join(dir, "mock.mjs");
  await writeFile(
    binary,
    "#!/usr/bin/env node\nimport{createInterface}from'node:readline';console.log(JSON.stringify({type:'inspector_ready'}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.event.crash)process.exit(1);console.log(JSON.stringify({requestId:r.requestId,result:{pid:process.pid,token:r.event.token}}))}).on('close',()=>process.exit(0));",
  );
  await chmod(binary, 0o755);
  const client = new AXInspectorClient(binary);
  try {
    await client.start();
    const a = await client.inspect({ token: "a" }),
      b = await client.inspect({ token: "b" });
    expect(a.pid).toBe(b.pid);
    expect(a.token).toBe("a");
    expect(b.token).toBe("b");
    await expect(client.inspect({ crash: true })).rejects.toThrow(
      "inspector_exited",
    );
    const c = await client.inspect({ token: "c" });
    expect(c.token).toBe("c");
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "darwin")(
  "光标变化不会清掉控件框，但会让旧选区失效",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "focus-stability-"));
    try {
      const binary = join(dir, "check");
      const build = spawnSync(
        "swiftc",
        [
          "tests/native-focus/main.swift",
          "native/collector/Sources/Collector/FocusRegions.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );
      expect(build.status, build.stderr).toBe(0);
      expect(spawnSync(binary, [], { encoding: "utf8" }).stdout).toContain(
        "PASS",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
