/** 编辑会话分离采集与理解，保存原始修订且提交动作使用不可变文本证据。 */
import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AXHistory } from "../src/observation/ax-history.ts";
import { AXRecorder } from "../src/observation/ax-recorder.ts";
import { EditingSessions } from "../src/observation/editing-sessions.ts";
import { snapshotRoutingReason } from "../src/observation/routing-policy.ts";
import { axObservation } from "../src/observation/ax-agent-bridge.ts";
import { projectVisualEvidence } from "../src/model/understanding-evidence.ts";

/** 构造不包含键盘正文的独立 AX 状态样本。 */
const sample = (id: string, revision: number, text: string) => ({
  id,
  revision,
  session: "session",
  pid: 42,
  app: "fixture",
  bundleId: "fixture",
  kind: "editing_update",
  occurredAt: new Date(revision * 100).toISOString(),
  editing: {
    text,
    role: "AXTextArea",
    selection: { location: text.length, length: 0 },
    source: "AXValue",
  },
});

test("连续编辑保留原始修订，原有截图照常采集，但不逐条进 AI", async () => {
  const root = await mkdtemp(join(tmpdir(), "editing-session-"));
  const history = new AXHistory(root, async () => {});
  let captured = 0;
  const routed: string[] = [];
  const recorder = new AXRecorder(
    "fixture",
    history,
    async () => {
      captured++;
      return { nodes: [], screenshot: { status: "captured", data: "fixture" } };
    },
    () => {},
    async (snapshot) => {
      if (!snapshotRoutingReason(snapshot, ["space", "enter", "click"]))
        routed.push(snapshot.snapshotId);
    },
  );
  const id = "ax-" + randomUUID();
  const event = (key: string, editingActivity: boolean) => ({
    id: "ax-" + randomUUID(),
    pid: 42,
    app: "fixture",
    bundleId: "fixture",
    session: "session",
    kind: "key_down",
    key,
    editingActivity,
    editingSessionId: id,
    occurredAt: new Date(1000).toISOString(),
  });
  try {
    await recorder.accept(sample(id, 1, "第一版"));
    await recorder.accept(sample(id, 2, "最终正文"));
    const space = event("Space", true);
    await recorder.accept(space);
    expect(captured).toBe(1);
    expect(routed).toEqual([]);
    expect((await history.get(space.id)).screenshot.data).toBe("fixture");
    const enter = event("Enter", false);
    await recorder.accept(enter);
    await recorder.accept(sample(id, 3, ""));
    expect(routed).toEqual([enter.id]);
    const saved = await history.get(enter.id);
    expect(saved.editingEvidence.text).toBe("最终正文");
    expect((await history.get(id)).editing.text).toBe("");
    expect(
      (await readFile(join(root, id, "editing-revisions.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(3);
    expect(await readFile(join(root, id, "meta.json"), "utf8")).not.toContain(
      "最终正文",
    );
    const item = axObservation(saved);
    expect(
      projectVisualEvidence(item.artifacts.ax?.payload.content, {}, null)
        .focusedElement.prior_editing_observation,
    ).toMatchObject({ text: "最终正文", source: "AXValue" });
  } finally {
    await recorder.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("不同输入框、旧修订、未来状态和监听会话不能串正文", async () => {
  const root = await mkdtemp(join(tmpdir(), "editing-boundary-"));
  const sessions = new EditingSessions(
    new AXHistory(root, async () => {}),
    () => {},
  );
  const a = "ax-" + randomUUID(),
    b = "ax-" + randomUUID();
  try {
    await Promise.all([
      sessions.accept(sample(a, 2, "A")),
      sessions.accept(sample(b, 1, "B")),
    ]);
    await sessions.accept(sample(a, 1, "过期"));
    const event = {
      editingSessionId: a,
      pid: 42,
      session: "session",
      occurredAt: new Date(1000).toISOString(),
    };
    expect(sessions.evidence(event)?.text).toBe("A");
    expect(sessions.evidence({ ...event, editingSessionId: b })?.text).toBe(
      "B",
    );
    expect(sessions.evidence({ ...event, pid: 43 })).toBeNull();
    expect(sessions.evidence({ ...event, session: "other" })).toBeNull();
    expect(
      sessions.evidence({ ...event, occurredAt: new Date(0).toISOString() }),
    ).toBeNull();
    await sessions.accept({
      ...sample(a, 3, ""),
      kind: "editing_closed",
      editing: undefined,
      reason: "focus_changed",
    });
    expect(sessions.evidence(event)).toBeNull();
  } finally {
    await sessions.close();
    await rm(root, { recursive: true, force: true });
  }
});
