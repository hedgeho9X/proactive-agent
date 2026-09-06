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
