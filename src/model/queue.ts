import { DatabaseSync } from "node:sqlite";
export type QueueStatus =
  | "queued"
  | "understanding"
  | "ready"
  | "delivering"
  | "delivered"
  | "failed"
  | "filtered";
export class ActionQueue {
  private db: DatabaseSync;
  private busy = false;
  private stopped = false;
  private closed = false;
  constructor(
    path: string,
    private handlers: {
      read: (id: string) => any;
      canUnderstand: () => boolean;
      canDeliver: () => boolean;
      understand: (item: any) => Promise<any>;
      deliver: (id: string, result: any) => Promise<any>;
      deliverBatch?: (
        items: { actionId: string; result: any }[],
      ) => Promise<any>;
      concurrency?: () => number;
      change: () => void;
      filter?: (id: string) => string | undefined | Promise<string | undefined>;
    },
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,actionId TEXT UNIQUE,status TEXT,reason TEXT,attempts INTEGER DEFAULT 0,result TEXT,createdAt INTEGER);UPDATE queue SET status='queued',reason='interrupted' WHERE status='understanding';UPDATE queue SET status='ready',reason='delivery_interrupted' WHERE status='delivering'",
    );
  }
  enqueue(actionId: string, reason?: string) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO queue(actionId,status,reason,createdAt) VALUES(?,?,?,?)",
      )
      .run(
        actionId,
        reason ? "filtered" : "queued",
        reason ?? null,
        Date.now(),
      );
    this.handlers.change();
    void this.drain();
  }
  list() {
    // 主列表只读取摘要，不把整份 Prompt/AX/响应反复传到渲染层。
    return this.db
      .prepare(
        "SELECT seq,actionId,status,reason,attempts,createdAt,json_extract(result,'$.result.action_title') AS actionTitle,json_extract(result,'$.result.action_detail') AS actionDetail FROM queue ORDER BY seq",
      )
      .all();
  }
  result(id: string) {
    const row = this.db
      .prepare("SELECT result FROM queue WHERE actionId=?")
      .get(id) as any;
    return row?.result ? JSON.parse(row.result) : null;
  }
  retry(id: string) {
    this.db
      .prepare(
        "UPDATE queue SET status=CASE WHEN result IS NULL THEN 'queued' ELSE 'ready' END,reason=NULL WHERE actionId=? AND status='failed'",
      )
      .run(id);
    this.handlers.change();
    void this.drain();
  }
  private set(
    id: string,
    status: QueueStatus,
    reason: string | null = null,
    result?: any,
  ) {
    if (result !== undefined)
      this.db
        .prepare("UPDATE queue SET status=?,reason=?,result=? WHERE actionId=?")
        .run(status, reason, JSON.stringify(result), id);
    else
      this.db
        .prepare("UPDATE queue SET status=?,reason=? WHERE actionId=?")
        .run(status, reason, id);
    this.handlers.change();
  }
  private async understand(row: any, deferred: Set<string>) {
    try {
      const reason = await this.handlers.filter?.(row.actionId);
      if (reason) {
        this.set(row.actionId, "filtered", reason);
        return;
      }
      const item = await this.handlers.read(row.actionId);
      if (!item) throw new Error("action_missing");
      if (item.evidence.some((e: any) => e.status === "pending")) {
        if (Date.now() - row.createdAt > 15000)
          throw new Error("evidence_wait_timeout");
        deferred.add(row.actionId);
        this.set(row.actionId, "queued");
        return;
      }
      this.db
        .prepare("UPDATE queue SET attempts=attempts+1 WHERE actionId=?")
        .run(row.actionId);
      const result = await this.handlers.understand(item);
      this.set(row.actionId, "ready", null, result);
    } catch (error) {
      this.set(
        row.actionId,
        "failed",
        error instanceof Error ? error.message : "understanding_failed",
      );
    }
  }
  private async deliver(rows: any[]) {
    const selected: { actionId: string; result: any }[] = [];
    try {
      for (const row of rows) {
        const reason = await this.handlers.filter?.(row.actionId);
        if (reason) this.set(row.actionId, "filtered", reason);
        else
          selected.push({
            actionId: row.actionId,
            result: this.result(row.actionId),
          });
      }
      if (this.stopped || !this.handlers.canDeliver()) {
        for (const row of selected) this.set(row.actionId, "ready");
        return;
      }
      if (selected.length) {
        if (this.handlers.deliverBatch)
          await this.handlers.deliverBatch(selected);
        else
          for (const row of selected)
            await this.handlers.deliver(row.actionId, row.result);
        for (const row of selected) this.set(row.actionId, "delivered");
      }
    } catch (error) {
      for (const row of selected.length ? selected : rows)
        this.set(
          row.actionId,
          "failed",
          error instanceof Error ? error.message : "delivery_failed",
        );
    }
  }
  async drain() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const workers = new Set<Promise<void>>(),
      deferred = new Set<string>();
    let delivery: Promise<void> | undefined;
    try {
      while (!this.stopped) {
        const concurrency = Math.max(
          1,
          Math.min(20, this.handlers.concurrency?.() ?? 1),
        );
        if (this.handlers.canUnderstand()) {
          const rows = this.db
            .prepare(
              "SELECT seq,actionId,createdAt FROM queue WHERE status='queued' ORDER BY seq LIMIT ?",
            )
            .all(concurrency + deferred.size) as any[];
          for (const row of rows
            .filter((row) => !deferred.has(row.actionId))
            .slice(0, Math.max(0, concurrency - workers.size))) {
            this.set(row.actionId, "understanding");
            const work = this.understand(row, deferred).finally(() =>
              workers.delete(work),
            );
            workers.add(work);
          }
        }
        if (!delivery && this.handlers.canDeliver()) {
          // 按采集入队顺序投递；不能让快完成的后一帧越过仍在理解的前一帧。
          const pending = this.db
            .prepare(
              this.handlers.deliverBatch
                ? "SELECT seq,actionId,status FROM queue WHERE status IN ('queued','understanding','ready') ORDER BY seq LIMIT 20"
                : "SELECT seq,actionId,status FROM queue WHERE status='ready' ORDER BY seq LIMIT 20",
            )
            .all() as any[];
          const barrier = pending.findIndex((row) => row.status !== "ready");
          const ready = pending.slice(
            0,
            barrier < 0 ? pending.length : barrier,
          );
          if (ready.length) {
            for (const row of ready) this.set(row.actionId, "delivering");
            delivery = this.deliver(ready).finally(() => {
              delivery = undefined;
            });
          }
        }
        const active = [...workers, ...(delivery ? [delivery] : [])];
        if (!active.length) break;
        await Promise.race(active);
      }
    } finally {
      const remaining = [...workers, ...(delivery ? [delivery] : [])];
      if (remaining.length) await Promise.allSettled(remaining);
      this.busy = false;
    }
  }
  pause() {
    this.stopped = true;
  }
  async close() {
    this.pause();
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
