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
  expect(session.list().records[0].description).toBe("标题");
  expect(session.list().records[0].title).toBeUndefined();
  expect(
    session
      .list({ app: "app.a", limit: 50 })
      .records.every((row) => row.app.bundle_id === "app.a"),
  ).toBe(true);
  expect(new Set(session.initial().map((row) => row.id)).size).toBe(
    session.initial().length,
  );
  await expect(session.get("21", "detail")).rejects.toThrow("boundary");
  const detail = await session.get("19", "detail");
  expect("content" in detail ? detail.content : "").toContain("细节");
  expect(reads).toBe(1);
});

test("新结果详情保持原文换行，索引只携带活动描述", async () => {
  const previous = {
    id: "previous",
    time: new Date(1000).toISOString(),
    app: {},
    description: "查看测试回复",
  };
  const current = {
    id: "current",
    time: new Date(2000).toISOString(),
    app: {},
  };
  const session = await EvidenceSession.create(
    {
      list: async () => [previous],
      read: async () => ({ action: {}, evidence: [], artifacts: {} }),
      result: () => ({
        result: {
          description: previous.description,
          detail: "当前阅读第一段和第二段。",
        },
        contextEvidence: {
          status: "partial",
          context: {
            text: "第一段原文\n第二段原文",
            scope: "related_subtree",
            truncated: true,
          },
        },
      }),
    },
    current,
  );
  expect(session.initial()[0].description).toBe(previous.description);
  const detail = await session.get("previous", "detail");
  const content = JSON.parse("content" in detail ? detail.content : "{}");
  expect(content.description).toBe(previous.description);
  expect(content.detail).toBe("当前阅读第一段和第二段。");
  expect(content.contextEvidence.context.text).toBe("第一段原文\n第二段原文");
  expect(content.contextEvidence.context.truncated).toBe(true);
});

test("详情工具优先返回原文证据，超预算时明确截断而非静默丢失", async () => {
  const anchor = {
    id: "now",
    time: new Date(1000).toISOString(),
    app: {},
    description: "查看合成消息",
  };
  const contextEvidence = { context: { text: "相关正文" }, status: "partial" };
  const session = await EvidenceSession.create(
    {
      list: async () => [],
      read: async () => ({
        action: { metadata: "x".repeat(20000) },
        evidence: [],
      }),
      result: () => ({
        result: { description: anchor.description, detail: "相关正文的说明" },
        contextEvidence,
      }),
    },
    anchor,
  );
  const response = await session.get("now", "detail");
  expect("content" in response && response.content).toStartWith(
    '{"contextEvidence":',
  );
  expect("content" in response && response.content).toContain("相关正文");
  expect("truncated" in response && response.truncated).toBe(true);
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
