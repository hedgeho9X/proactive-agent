/** 验证历史工具的时间边界、应用过滤和延迟取证，不调用模型。 */
import { expect, test } from "bun:test";
import {
  EvidenceSession,
  type EvidenceRow,
} from "../src/understanding/evidence-session.ts";

test("历史按时间及同采集会话序号限定，未知未来 ID 无法取证", async () => {
  const rows: EvidenceRow[] = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    time: new Date(1000 + i * 10).toISOString(),
    app: { bundle_id: i % 2 ? "app.a" : "app.b" },
    title: "标题",
    sequence: i,
    session: "session",
  }));
  let reads = 0;
  const session = await EvidenceSession.create(
    {
      list: async () => rows,
      read: async () => {
        reads++;
        return { action: {}, evidence: [], artifacts: {} };
      },
      result: () => ({ result: { action_detail: "细节" } }),
    },
    rows[20],
  );
  expect(reads).toBe(0);
  expect(session.list().records).toHaveLength(10);
  expect(
    session
      .list({ app: "app.a", limit: 50 })
      .records.every((row) => row.app.bundle_id === "app.a"),
  ).toBe(true);
  expect(new Set(session.initial().map((row) => row.id)).size).toBe(
    session.initial().length,
  );
  await expect(session.get("21", "detail")).rejects.toThrow("boundary");
  expect((await session.get("19", "detail")).content).toContain("细节");
  expect(reads).toBe(1);
});

test("同毫秒只接收有可靠序号的前序事件，受保护证据不返回", async () => {
  const anchor: EvidenceRow = {
    id: "now",
    time: new Date(1000).toISOString(),
    app: {},
    sequence: 2,
    session: "s",
  };
  const rows = [
    { ...anchor, id: "before", sequence: 1 },
    { ...anchor, id: "after", sequence: 3 },
    { ...anchor, id: "other", session: "x" },
  ];
  const session = await EvidenceSession.create(
    {
      list: async () => rows,
      read: async () => ({ evidence: [{ status: "excluded" }] }),
      result: () => null,
    },
    anchor,
  );
  expect(session.list().records.map((row) => row.id)).toEqual(["before"]);
  expect(await session.get("before", "image")).toEqual({
    status: "excluded",
    action_id: "before",
  });
});
