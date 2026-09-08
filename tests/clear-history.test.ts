import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  HistoryClear,
  historyEntries,
} from "../src/observation/clear-history.ts";

test("整批清空全部历史，保留配置，失败可重试且不影响新数据", async () => {
  const root = await mkdtemp(join(tmpdir(), "clear-history-"));
  try {
    for (const name of ["ax-snapshots", "understanding", "sessions"])
      await mkdir(join(root, name));
    for (let index = 0; index < 1000; index++)
      await mkdir(join(root, "ax-snapshots", "ax-" + crypto.randomUUID()));
    for (const name of historyEntries.filter((name) => name.includes("sqlite")))
      await writeFile(join(root, name), "fixture-db");
    for (const name of [
      "model-roles.json",
      "observation-routing.json",
      "Preferences",
    ])
      await writeFile(join(root, name), "fixture-config");
    let fail = true,
      calls = 0;
    const trash = join(root, "fixture-trash");
    await mkdir(trash);
    const clear = new HistoryClear(root, async (path) => {
      calls++;
      if (fail) throw Error("trash_unavailable");
      await rename(path, join(trash, basename(path)));
    });
    const progress: number[] = [];
    const staged = await clear.stage((completed) => progress.push(completed));
    expect(staged.snapshots).toBe(1000);
    expect(progress.at(-1)).toBe(9);
    expect(
      (await readdir(root)).filter((name) =>
        historyEntries.includes(name as any),
      ),
    ).toEqual([]);
    const failed = await clear.finish();
    expect(failed.failed).toEqual([staged.id]);
    expect(calls).toBe(1);
    await mkdir(join(root, "ax-snapshots"));
    await writeFile(join(root, "ax-snapshots", "new-record"), "new-content");
    fail = false;
    expect((await clear.finish()).failed).toEqual([]);
    expect(
      await readFile(join(root, "ax-snapshots", "new-record"), "utf8"),
    ).toBe("new-content");
    for (const name of [
      "model-roles.json",
      "observation-routing.json",
      "Preferences",
    ])
      expect(await readFile(join(root, name), "utf8")).toBe("fixture-config");
    expect((await readdir(join(trash, staged.id, "ax-snapshots"))).length).toBe(
      1000,
    );
    expect(await clear.pending()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("清理拒绝符号链接，移动中途失败回滚，不误报成功", async () => {
  const root = await mkdtemp(join(tmpdir(), "clear-rollback-"));
  try {
    await mkdir(join(root, "ax-snapshots"));
    await writeFile(join(root, "observations.sqlite"), "old-data");
    const clear = new HistoryClear(root, async () => {});
    await expect(
      clear.stage((completed) => {
        if (completed === 1) throw Error("fixture_midway_failure");
      }),
    ).rejects.toThrow("rolled_back");
    expect(await readdir(join(root, "ax-snapshots"))).toEqual([]);
    expect(await readFile(join(root, "observations.sqlite"), "utf8")).toBe(
      "old-data",
    );
    await symlink(join(root, "ax-snapshots"), join(root, "sessions"));
    await expect(clear.stage()).rejects.toThrow("target_type_rejected");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("中途退出后恢复未完成批次，冲突时不覆盖新文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "clear-interrupted-"));
  try {
    const id = "history-cleared-" + crypto.randomUUID();
    const path = join(root, id);
    await mkdir(path);
    await writeFile(
      join(path, "manifest.json"),
      JSON.stringify({ schema: 1, complete: false }),
    );
    await writeFile(join(path, "observations.sqlite"), "recover-me");
    await writeFile(join(root, "observations.sqlite"), "new-db");
    const clear = new HistoryClear(root, async () => {});
    await expect(clear.recoverInterrupted()).rejects.toThrow(
      "recovery_conflict",
    );
    expect(await readFile(join(root, "observations.sqlite"), "utf8")).toBe(
      "new-db",
    );
    await rename(
      join(root, "observations.sqlite"),
      join(root, "fixture-new-db"),
    );
    await clear.recoverInterrupted();
    expect(await readFile(join(root, "observations.sqlite"), "utf8")).toBe(
      "recover-me",
    );
    expect(await clear.pending()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
