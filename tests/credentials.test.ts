import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelRoles,
  roles,
  type CredentialCodec,
} from "../src/model/config.ts";

// 测试用不透明映射只验证存储边界；真实加密由桌面系统钥匙串验收。
function fixtureCodec(): CredentialCodec {
  const values = new Map<string, string>();
  return {
    encrypt(value) {
      const id = crypto.randomUUID();
      values.set(id, value);
      return id;
    },
    decrypt(id) {
      if (!values.has(id)) throw new Error("fixture_decryption_failed");
      return values.get(id)!;
    },
  };
}

test("三角色加密保存、并发更新、重启恢复及清除，快照不含任何凭证", async () => {
  const root = await mkdtemp(join(tmpdir(), "credentials-"));
  try {
    const file = join(root, "roles.json");
    const codec = fixtureCodec();
    const config = new ModelRoles(file, codec);
    await Promise.all(
      roles.map((role) =>
        config.update(role, {
          model: "fixture-" + role,
          apiKey: "fixture-secret-" + role,
        }),
      ),
    );
    const disk = await readFile(file, "utf8");
    expect(disk).not.toContain("fixture-secret");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const recovered = new ModelRoles(file, codec);
    await recovered.load();
    for (const role of roles) {
      expect(recovered.get(role)?.apiKey).toBe("fixture-secret-" + role);
      expect(recovered.snapshot()[role].status).toBe("configured_unverified");
    }
    expect(JSON.stringify(recovered.snapshot())).not.toContain(
      "fixture-secret",
    );
    expect(JSON.stringify(recovered.snapshot())).not.toContain(
      "encryptedApiKey",
    );
    await recovered.update("main", { model: "updated" });
    await recovered.update("subagent", { apiKey: "" });
    const cleared = new ModelRoles(file, codec);
    await cleared.load();
    expect(cleared.get("main")?.apiKey).toBe("fixture-secret-main");
    expect(cleared.get("main")?.model).toBe("updated");
    expect(cleared.get("subagent")).toBeUndefined();
    expect(
      JSON.parse(await readFile(file, "utf8")).subagent.encryptedApiKey,
    ).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("加密失败不保存明文或更换内存凭证，解密失败保留密文供恢复", async () => {
  const root = await mkdtemp(join(tmpdir(), "credentials-failure-"));
  try {
    const file = join(root, "roles.json");
    const codec = fixtureCodec();
    const config = new ModelRoles(file, codec);
    await config.update("main", { model: "fixture", apiKey: "fixture-secret" });
    const original = await readFile(file, "utf8");
    const unavailable: CredentialCodec = {
      encrypt() {
        throw new Error("fixture_keychain_locked");
      },
      decrypt() {
        throw new Error("fixture_keychain_locked");
      },
    };
    const locked = new ModelRoles(file, unavailable);
    await locked.load();
    expect(locked.get("main")).toBeUndefined();
    expect(locked.snapshot().main.status).toBe("credential_unavailable");
    await expect(
      locked.update("main", { apiKey: "new-secret" }),
    ).rejects.toThrow("fixture_keychain_locked");
    expect(await readFile(file, "utf8")).toBe(original);
    expect(locked.get("main")).toBeUndefined();
    await locked.update("understanding", { model: "updated-without-key" });
    const recovered = new ModelRoles(file, codec);
    await recovered.load();
    expect(recovered.get("main")?.apiKey).toBe("fixture-secret");
    // 旧配置的明文 Key 不自动导入，也不会透传到 UI。
    await writeFile(
      file,
      JSON.stringify({ main: { model: "legacy", apiKey: "legacy-secret" } }),
    );
    const legacy = new ModelRoles(file, codec);
    await legacy.load();
    expect(legacy.get("main")).toBeUndefined();
    expect(JSON.stringify(legacy.snapshot())).not.toContain("legacy-secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
