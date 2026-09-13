/** 本应用的搜索凭证配置；磁盘只保存密文，状态查询不返回 Key。 */
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { CredentialCodec } from "../model/config.ts";

/** 管理独立于模型凭证的 Tavily Key。 */
export class SearchSettings {
  private key?: string;
  private tail: Promise<unknown> = Promise.resolve();
  /** file 位于应用私有目录，codec 由 Electron 系统加密提供。 */
  constructor(
    private file: string,
    private codec: CredentialCodec,
  ) {}
  /** 恢复 Key；解密不可用时保留原文件并报告未配置。 */
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      this.key = data.encryptedKey
        ? this.codec.decrypt(data.encryptedKey)
        : undefined;
    } catch {
      this.key = undefined;
    }
  }
  /** 只供服务读取，不能送到 renderer 状态快照。 */
  getKey() {
    return this.key;
  }
  /** 返回可公开展示的配置状态。 */
  snapshot() {
    return { provider: "tavily", hasKey: !!this.key };
  }
  /** 原子保存或清除凭证，不在落盘成功前更换运行中配置。 */
  update(apiKey: string) {
    const work = this.tail.then(async () => {
      if (typeof apiKey !== "string" || apiKey.length > 4096)
        throw new Error("invalid_search_key");
      const key = apiKey.trim();
      const data = {
        provider: "tavily",
        encryptedKey: key ? this.codec.encrypt(key) : null,
      };
      const temp = this.file + "." + randomUUID() + ".next";
      try {
        await writeFile(temp, JSON.stringify(data), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temp, this.file);
      } finally {
        await rm(temp, { force: true });
      }
      this.key = key || undefined;
      return this.snapshot();
    });
    this.tail = work.catch(() => {});
    return work;
  }
}
