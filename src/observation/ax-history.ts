import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// 一份快照一个目录，元数据与完整 JSON 原子发布，列表不读取大型截图正文。
export class AXHistory {
  constructor(
    readonly root: string,
    private trash: (path: string) => Promise<void>,
  ) {}
  private path(id: string) {
    if (
      !/^ax-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        id,
      )
    )
      throw new Error("invalid_snapshot_id");
    return join(this.root, id);
  }
  private async existing(id: string) {
    const path = this.path(id);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("invalid_snapshot_directory");
    return path;
  }
  async save(snapshot: any) {
    if (!Array.isArray(snapshot?.nodes) || snapshot.error)
      throw new Error("invalid_ax_snapshot");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = "ax-" + randomUUID();
    const target = this.path(id);
    const pending = join(this.root, ".pending-" + id);
    const savedAt = new Date().toISOString();
    const value = { ...snapshot, snapshotId: id, savedAt, schemaVersion: 1 };
    const meta = {
      id,
      savedAt,
      capturedAt: snapshot.capturedAt,
      app: snapshot.app,
      bundleId: snapshot.bundleId,
      pid: snapshot.pid,
      nodes: snapshot.nodes.length,
      partial: !!snapshot.partial,
      file: join(target, "snapshot.json"),
    };
    await mkdir(pending, { mode: 0o700 });
    await writeFile(join(pending, "snapshot.json"), JSON.stringify(value), {
      mode: 0o600,
    });
    await writeFile(join(pending, "meta.json"), JSON.stringify(meta), {
      mode: 0o600,
    });
    await rename(pending, target);
    return { ...value, file: meta.file };
  }
  async list() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rows: any[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^ax-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          entry.name,
        )
      )
        continue;
      try {
        const path = await this.existing(entry.name);
        const meta = JSON.parse(
          await readFile(join(path, "meta.json"), "utf8"),
        );
        rows.push({
          ...meta,
          id: entry.name,
          file: join(path, "snapshot.json"),
        });
      } catch {
        // 损坏的元数据也占据历史空间，保留固定 ID，允许一键清理。
        rows.push({
          id: entry.name,
          savedAt: "",
          capturedAt: "未知时间",
          app: "损坏的快照",
          nodes: 0,
          corrupt: true,
        });
      }
    }
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async get(id: string) {
    const path = await this.existing(id);
    return {
      ...JSON.parse(await readFile(join(path, "snapshot.json"), "utf8")),
      snapshotId: id,
      file: join(path, "snapshot.json"),
    };
  }
  async remove(id: string) {
    await this.trash(await this.existing(id));
  }
  async clear() {
    const rows = await this.list();
    let deleted = 0;
    const failed: string[] = [];
    // 固定本次清理目标，过程中新增的快照不会被删除。
    for (const row of rows) {
      try {
        await this.remove(row.id);
        deleted++;
      } catch {
        failed.push(row.id);
      }
    }
    return { deleted, failed };
  }
}
