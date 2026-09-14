import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export type ModelRole = "understanding" | "main" | "subagent";
export interface RoleModelConfig {
  protocol: "gemini" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxCalls?: number;
}
export const roles: ModelRole[] = ["understanding", "main", "subagent"];
// 加密实现由桌面主进程注入，测试和非桌面调用不依赖 Electron。
export interface CredentialCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
export class ModelRoles {
  private encryptedKeys: Partial<Record<ModelRole, string>> = {};
  private pendingWrite: Promise<unknown> = Promise.resolve();
  private values: Record<ModelRole, RoleModelConfig> = Object.fromEntries(
    roles.map((role) => [
      role,
      {
        protocol: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        model: role === "understanding" ? "gemini-3.8-flash" : "",
        maxCalls: 30,
      },
    ]),
  ) as any;
  readonly status: Record<ModelRole, string> = {
    understanding: "unavailable",
    main: "unavailable",
    subagent: "unavailable",
  };
  constructor(
    private file: string,
    private credentials?: CredentialCodec,
  ) {}
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      for (const role of roles) {
        if (!saved[role]) continue;
        // 白名单恢复公开配置；旧明文 Key 和密文都不进入 renderer 快照。
        for (const key of ["protocol", "baseUrl", "model", "maxCalls"] as const)
          if (saved[role][key] !== undefined)
            (this.values[role] as any)[key] = saved[role][key];
        const encrypted = saved[role].encryptedApiKey;
        if (typeof encrypted !== "string" || !encrypted) continue;
        this.encryptedKeys[role] = encrypted;
        try {
          if (!this.credentials)
            throw new Error("credential_storage_unavailable");
          this.values[role].apiKey = this.credentials.decrypt(encrypted);
          this.status[role] = this.values[role].apiKey
            ? "configured_unverified"
            : "unavailable";
        } catch {
          // 换机器、钥匙串锁定或密文损坏时不伪装成已配置，也不销毁密文。
          this.values[role].apiKey = "";
          this.status[role] = "credential_unavailable";
        }
      }
    } catch {}
  }
  get(role: ModelRole) {
    return this.values[role].apiKey ? { ...this.values[role] } : undefined;
  }
  snapshot() {
    return Object.fromEntries(
      roles.map((role) => {
        const { apiKey, ...config } = this.values[role];
        return [
          role,
          { ...config, hasKey: !!apiKey, status: this.status[role] },
        ];
      }),
    );
  }
  async update(role: ModelRole, input: Partial<RoleModelConfig>) {
    // 多角色并发保存时串行写入，防止整份配置互相覆盖。
    const work = this.pendingWrite.then(() => this.save(role, input));
    this.pendingWrite = work.catch(() => {});
    return work;
  }
  private async save(role: ModelRole, input: Partial<RoleModelConfig>) {
    if (!roles.includes(role)) throw new Error("invalid_model_role");
    const next = { ...this.values[role] };
    for (const key of [
      "protocol",
      "baseUrl",
      "apiKey",
      "model",
      "maxCalls",
    ] as const)
      if (input[key] !== undefined) (next as any)[key] = input[key];
    const url = new URL(next.baseUrl);
    if (
      !["gemini", "openai-compatible"].includes(next.protocol) ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !next.model?.trim() ||
      next.model.length > 200 ||
      typeof next.apiKey !== "string" ||
      next.apiKey.length > 16384
    )
      throw new Error("invalid_model_config");
    next.baseUrl = next.baseUrl.replace(/\/$/, "");
    next.maxCalls = Math.max(1, Math.min(1000, Number(next.maxCalls) || 30));
    const encryptedKeys = { ...this.encryptedKeys };
    if (input.apiKey !== undefined) {
      if (next.apiKey && this.credentials)
        encryptedKeys[role] = this.credentials.encrypt(next.apiKey);
      else delete encryptedKeys[role];
    }
    const values = { ...this.values, [role]: next };
    const temporary = this.file + "." + randomUUID() + ".tmp";
    try {
      // 同目录原子替换，且文件仅当前用户可读写；磁盘上永远不写明文 Key。
      await writeFile(
        temporary,
        JSON.stringify(
          Object.fromEntries(
            roles.map((role) => {
              const { apiKey, ...publicConfig } = values[role];
              return [
                role,
                { ...publicConfig, encryptedApiKey: encryptedKeys[role] },
              ];
            }),
          ),
        ),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
    // 落盘成功后才切换运行中凭证，保存失败不会出现界面和磁盘状态分裂。
    this.values = values;
    this.encryptedKeys = encryptedKeys;
    this.status[role] = next.apiKey ? "configured_unverified" : "unavailable";
    return this.snapshot();
  }
}
