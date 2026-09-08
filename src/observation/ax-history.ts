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
  async save(snapshot: any, suppliedId?: string) {
    if (!Array.isArray(snapshot?.nodes) || snapshot.error)
      throw new Error("invalid_ax_snapshot");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = suppliedId ?? "ax-" + randomUUID();
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
      trigger: snapshot.trigger,
      captureStatus: snapshot.captureStatus,
      hasScreenshot:
        snapshot.screenshot?.status === "captured" &&
        !!snapshot.screenshot?.data,
      screenshotReason: snapshot.captureError ?? snapshot.screenshot?.reason,
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
  async update(id: string, snapshot: any) {
    const path = await this.existing(id);
    const original = await this.get(id);
    const value = { ...original, ...snapshot, snapshotId: id };
    const meta = {
      id,
      savedAt: original.savedAt,
      capturedAt: value.capturedAt,
      app: value.app,
      bundleId: value.bundleId,
      pid: value.pid,
      nodes: value.nodes.length,
      partial: !!value.partial,
      trigger: value.trigger,
      captureStatus: value.captureStatus,
      hasScreenshot:
        value.screenshot?.status === "captured" && !!value.screenshot?.data,
      screenshotReason: value.captureError ?? value.screenshot?.reason,
      file: join(path, "snapshot.json"),
    };
    // 更新只针对仍存在的快照目录，不重新创建用户已删除的记录。
    await writeFile(join(path, "snapshot.next"), JSON.stringify(value), {
      mode: 0o600,
    });
    await rename(join(path, "snapshot.next"), join(path, "snapshot.json"));
    await writeFile(join(path, "meta.next"), JSON.stringify(meta), {
      mode: 0o600,
    });
    await rename(join(path, "meta.next"), join(path, "meta.json"));
    return value;
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
