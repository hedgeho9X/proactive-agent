import { DatabaseSync } from "node:sqlite";
export type QueueStatus =
  | "queued"
  | "understanding"
  | "ready"
  | "delivered"
  | "failed"
  | "filtered";
export class ActionQueue {
  private db: DatabaseSync;
  private busy = false;
  private stopped = false;
  constructor(
    path: string,
    private handlers: {
      read: (id: string) => any;
      canUnderstand: () => boolean;
      canDeliver: () => boolean;
      understand: (item: any) => Promise<any>;
      deliver: (id: string, result: any) => Promise<any>;
      change: () => void;
    },
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,actionId TEXT UNIQUE,status TEXT,reason TEXT,attempts INTEGER DEFAULT 0,result TEXT,createdAt INTEGER);UPDATE queue SET status='queued',reason='interrupted' WHERE status='understanding'",
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
    return this.db
      .prepare(
        "SELECT seq,actionId,status,reason,attempts,createdAt FROM queue ORDER BY seq",
      )
      .all();
  }
  result(actionId: string) {
    const row = this.db
      .prepare("SELECT result FROM queue WHERE actionId=?")
      .get(actionId) as any;
    return row?.result ? JSON.parse(row.result) : null;
  }
  retry(actionId: string) {
    this.db
      .prepare(
        "UPDATE queue SET status=CASE WHEN result IS NULL THEN 'queued' ELSE 'ready' END,reason=NULL WHERE actionId=? AND status='failed'",
      )
      .run(actionId);
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
  async drain() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      while (!this.stopped) {
        const statuses = [
          ...(this.handlers.canUnderstand() ? ["queued"] : []),
          ...(this.handlers.canDeliver() ? ["ready"] : []),
        ];
        if (!statuses.length) break;
        const row = this.db
          .prepare(
            "SELECT * FROM queue WHERE status IN (" +
              statuses.map(() => "?").join(",") +
              ") ORDER BY seq LIMIT 1",
          )
          .get(...statuses) as any;
        if (!row) break;
        try {
          let result = row.result ? JSON.parse(row.result) : null;
          if (row.status === "queued") {
            if (!this.handlers.canUnderstand()) break;
            const item = this.handlers.read(row.actionId);
            if (!item) {
              this.set(row.actionId, "failed", "action_missing");
              continue;
            }
            if (item.evidence.some((e: any) => e.status === "pending")) {
              if (Date.now() - row.createdAt > 15000) {
                this.set(row.actionId, "failed", "evidence_wait_timeout");
                continue;
              }
              break;
            }
            this.set(row.actionId, "understanding");
            this.db
              .prepare("UPDATE queue SET attempts=attempts+1 WHERE actionId=?")
              .run(row.actionId);
            result = await this.handlers.understand(item);
            this.set(row.actionId, "ready", null, result);
          }
          if (!this.handlers.canDeliver()) continue;
          await this.handlers.deliver(row.actionId, result);
          this.set(row.actionId, "delivered");
        } catch (error) {
          this.set(
            row.actionId,
            "failed",
            error instanceof Error ? error.message : "queue_failed",
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async close() {
    this.stopped = true;
    while (this.busy) await new Promise((r) => setTimeout(r, 10));
    this.db.close();
  }
}
