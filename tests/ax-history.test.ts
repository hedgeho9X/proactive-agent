import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rename,
  rm,
  readFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { AXHistory } from "../src/observation/ax-history.ts";

test("AX快照重开、完整截图、ID约束与清理隔离", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ax-history-test-"));
  const trash = join(dir, "trash");
  await mkdir(trash);
  const move = (path: string) => rename(path, join(trash, basename(path)));
  const root = join(dir, "history");
  try {
    let store = new AXHistory(root, move);
    const first = await store.save({
      nodes: [{ id: "n1" }],
      app: "fixture",
      pid: 1,
      capturedAt: "2026-09-06T00:00:00Z",
      screenshot: { data: "fixture-image" },
    });
    expect(first.snapshotId).toMatch(/^ax-/);
    store = new AXHistory(root, move);
    expect((await store.list()).length).toBe(1);
    expect((await store.get(first.snapshotId)).screenshot.data).toBe(
      "fixture-image",
    );
    expect(JSON.parse(await readFile(first.file, "utf8")).snapshotId).toBe(
      first.snapshotId,
    );
    await expect(store.get("../outside")).rejects.toThrow(
      "invalid_snapshot_id",
    );
    const link = "ax-00000000-0000-0000-0000-000000000000";
    await symlink(trash, join(root, link));
    await expect(store.remove(link)).rejects.toThrow(
      "invalid_snapshot_directory",
    );
    await store.remove(first.snapshotId);
    expect((await store.list()).length).toBe(0);
    expect(
      JSON.parse(
        await readFile(join(trash, first.snapshotId, "snapshot.json"), "utf8"),
      ).snapshotId,
    ).toBe(first.snapshotId);
    const second = await store.save({ nodes: [], app: "fixture" });
    const third = await store.save({ nodes: [], app: "fixture" });
    const partial = new AXHistory(root, async (path) => {
      if (path.endsWith(second.snapshotId)) throw new Error("fixture_failure");
      await move(path);
    });
    expect(await partial.clear()).toEqual({
      deleted: 1,
      failed: [second.snapshotId],
    });
    expect((await store.get(second.snapshotId)).snapshotId).toBe(
      second.snapshotId,
    );
    expect((await store.list()).map((row) => row.id)).not.toContain(
      third.snapshotId,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("元数据热缓存随采集完成更新，列表不复读旧记录且能发现外部增删", async () => {
  const root = await mkdtemp(join(tmpdir(), "ax-metadata-"));
  try {
    const history = new AXHistory(root, (path) =>
      rm(path, { recursive: true }),
    );
    const saved = await history.save({ nodes: [], captureStatus: "pending" });
    const cold = new AXHistory(root, (path) => rm(path, { recursive: true }));
    const first = (await cold.list())[0];
    // 缓存命中保留同一个轻量对象；原图和 AX 正文不进入列表缓存。
    expect((await cold.list())[0]).toBe(first);
    await cold.update(saved.snapshotId, {
      nodes: [{ id: "n1" }],
      captureStatus: "captured",
      screenshot: { status: "captured", data: "fixture" },
    });
    const completed = (await cold.list())[0];
    expect(completed.hasScreenshot).toBe(true);
    expect(completed.nodes).toBe(1);
    expect(completed.screenshot).toBeUndefined();
    const other = await history.save({ nodes: [] });
    expect((await cold.list()).length).toBe(2);
    await history.remove(other.snapshotId);
    expect((await cold.list()).length).toBe(1);
    await cold.remove(saved.snapshotId);
    expect(await cold.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
