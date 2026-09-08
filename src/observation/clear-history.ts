import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// 只移动历史数据白名单，不触碰模型配置、路由设置或 Electron 用户配置。
export const historyEntries = [
  "ax-snapshots",
  "understanding",
  "sessions",
  "observations.sqlite",
  "observations.sqlite-wal",
  "observations.sqlite-shm",
  "action-queue.sqlite",
  "action-queue.sqlite-wal",
  "action-queue.sqlite-shm",
] as const;
const recoveryPattern = /^history-cleared-[0-9a-f-]{36}$/;
export class HistoryClear {
  constructor(
    readonly root: string,
    private trash: (path: string) => Promise<void>,
  ) {}

  // 上次若在整批移动中途退出，先恢复缺失项，再允许打开 SQLite；不覆盖冲突项。
  async recoverInterrupted() {
    for (const id of await readdir(this.root)) {
      if (!recoveryPattern.test(id)) continue;
      const path = join(this.root, id);
      if (!(await lstat(path)).isDirectory()) continue;
      const manifest = await readFile(join(path, "manifest.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (manifest?.schema !== 1 || manifest.complete || manifest.rolledBack)
        continue;
      const entries = (await readdir(path)).filter(
        (name) => name !== "manifest.json",
      );
      if (entries.some((name) => !historyEntries.includes(name as any)))
        throw new Error("invalid_history_recovery_manifest");
      for (const name of entries) {
        const target = join(this.root, name);
        const exists = await lstat(target).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (exists) throw new Error("history_recovery_conflict:" + path);
        await rename(join(path, name), target);
      }
      await writeFile(
        join(path, "manifest.json"),
        JSON.stringify({ ...manifest, rolledBack: true }),
      );
    }
  }

  // 调用方必须先停止所有写入并关闭 SQLite，连同 WAL 一起保留恢复能力。
  async stage(progress: (completed: number, total: number) => void = () => {}) {
    const selected: string[] = [];
    for (const name of historyEntries) {
      const info = await lstat(join(this.root, name)).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info) continue;
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error("history_target_type_rejected:" + name);
      selected.push(name);
    }
    const snapshots = selected.includes("ax-snapshots")
      ? (await readdir(join(this.root, "ax-snapshots"))).filter((name) =>
          /^ax-[0-9a-f-]{36}$/.test(name),
        ).length
      : 0;
    const id = "history-cleared-" + crypto.randomUUID();
    const path = join(this.root, id);
    await mkdir(path, { mode: 0o700 });
    const manifest = {
      schema: 1,
      complete: false,
      entries: selected,
      snapshots,
    };
    await writeFile(join(path, "manifest.json"), JSON.stringify(manifest), {
      mode: 0o600,
    });
    const moved: string[] = [];
    try {
      progress(0, selected.length);
      for (const name of selected) {
        await rename(join(this.root, name), join(path, name));
        moved.push(name);
        progress(moved.length, selected.length);
      }
      await writeFile(
        join(path, "manifest.json"),
        JSON.stringify({ ...manifest, complete: true }),
      );
    } catch {
      // 不覆盖后来出现的文件；回滚失败时两边均保留，交由显式恢复处理。
      let rolledBack = true;
      for (const name of moved.reverse()) {
        try {
          const destination = join(this.root, name);
          if (
            await lstat(destination).then(
              () => true,
              (error) => {
                if (error.code === "ENOENT") return false;
                throw error;
              },
            )
          )
            throw new Error("restore_conflict");
          await rename(join(path, name), destination);
        } catch {
          rolledBack = false;
        }
      }
      throw new Error(
        rolledBack
          ? "history_move_failed_rolled_back"
          : "history_move_failed_recovery_required:" + path,
      );
    }
    return { id, path, snapshots, groups: selected.length };
  }

  async pending() {
    const pending: string[] = [];
    for (const id of await readdir(this.root)) {
      if (!recoveryPattern.test(id)) continue;
      const path = join(this.root, id);
      if (
        !(await lstat(path)).isDirectory() ||
        (await lstat(path)).isSymbolicLink()
      )
        continue;
      const manifest = await readFile(join(path, "manifest.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (manifest?.schema === 1 && manifest.complete === true)
        pending.push(id);
    }
    return pending;
  }

  // 失败重试仅处理已整体移出的备份，绝不会删除重试期间新采集的记录。
  async finish() {
    const succeeded: string[] = [],
      failed: string[] = [];
    for (const id of await this.pending()) {
      try {
        await this.trash(join(this.root, id));
        succeeded.push(id);
      } catch {
        failed.push(id);
      }
    }
    return {
      succeeded,
      failed,
      recoveryPaths: failed.map((id) => join(this.root, id)),
    };
  }
}
