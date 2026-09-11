/** 验证独立提示词资源、变量替换与 Node 打包后的工作目录独立性。 */
import { test, expect } from "bun:test";
import {
  defaultPrompts,
  promptMessages,
  toolPrompts,
} from "../src/model/prompts.ts";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("角色正文来自独立文件，用户模板字符不会二次展开", async () => {
  for (const role of ["understanding", "main", "subagent"] as const) {
    const resource = await import(`../prompts/${role}.ts`);
    expect(defaultPrompts[role]).toBe(resource.default);
  }
  expect(
    promptMessages.delegation({
      system: "规则",
      task: "用户写了 {{system}} 和 ${system} 和 $&",
    }),
  ).toBe("规则\n任务：用户写了 {{system}} 和 ${system} 和 $&");
  expect(promptMessages.click({ button: "鼠标左键", x: "1", y: "2" })).toBe(
    "用户点击鼠标左键，坐标 (1, 2)",
  );
  expect(toolPrompts.delegate).toContain("子 Agent");
});

test("Prompt 随 bundle 打包，在非仓库目录也能读取全部资源", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-bundle-"));
  try {
    const output = join(root, "prompts.mjs");
    await build({
      entryPoints: ["src/model/prompts.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: output,
    });
    const result = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import {defaultPrompts, promptMessages, toolPrompts} from './prompts.mjs'; console.log(Object.keys(defaultPrompts).length, Boolean(promptMessages.action), Boolean(toolPrompts.send_danmaku));`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("3 true true");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
