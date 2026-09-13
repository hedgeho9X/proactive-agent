/** 验证搜索凭证保存恢复、清除与状态脱敏，不访问系统钥匙串。 */
import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchSettings } from "../src/understanding/search-settings.ts";

test("搜索 Key 加密保存，状态不泄露，重启恢复且可清除", async () => {
  const root = await mkdtemp(join(tmpdir(), "search-settings-"));
  const values = new Map<string, string>();
  const codec = {
    encrypt(value: string) {
      const id = crypto.randomUUID();
      values.set(id, value);
      return id;
    },
    decrypt(id: string) {
      return values.get(id)!;
    },
  };
  try {
    const file = join(root, "web-search.json"),
      settings = new SearchSettings(file, codec);
    await settings.update("fixture-private-key");
    expect(await readFile(file, "utf8")).not.toContain("fixture-private-key");
    expect(JSON.stringify(settings.snapshot())).not.toContain(
      "fixture-private-key",
    );
    const recovered = new SearchSettings(file, codec);
    await recovered.load();
    expect(recovered.getKey()).toBe("fixture-private-key");
    await recovered.update("");
    const cleared = new SearchSettings(file, codec);
    await cleared.load();
    expect(cleared.snapshot().hasKey).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
