import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type {
  ActionEnvelope,
  ArtifactInput,
  EvidenceLink,
  Observation,
} from "./types.ts";
export class EvidenceStore {
  private db: DatabaseSync;
  private closed = false;
  readonly policy: {
    evidenceTTL: number;
    metadataTTL: number;
    maxBytes: number;
    burstMs: number;
  };
  constructor(
    path: string,
    policy = {
      evidenceTTL: 86_400_000,
      metadataTTL: 604_800_000,
      maxBytes: 2 * 1024 ** 3,
      burstMs: 500,
    },
  ) {
    this.policy = policy;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, epoch TEXT, seq TEXT, occurred INTEGER, metadata TEXT, activity_id TEXT, revision INTEGER DEFAULT 0, UNIQUE(epoch,seq));
      CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, kind TEXT, started INTEGER, ended INTEGER, grouping TEXT, count INTEGER);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, kind TEXT, hash TEXT, captured INTEGER, payload TEXT, bytes BLOB, size INTEGER, UNIQUE(kind,hash));
      CREATE TABLE IF NOT EXISTS evidence(action_id TEXT REFERENCES actions(id) ON DELETE CASCADE, kind TEXT, status TEXT, artifact_id TEXT REFERENCES artifacts(id), original_artifact_id TEXT, reason TEXT, delta_ms REAL, PRIMARY KEY(action_id,kind));
      CREATE TABLE IF NOT EXISTS evidence_history(action_id TEXT,revision INTEGER,links TEXT, PRIMARY KEY(action_id,revision));
      CREATE TABLE IF NOT EXISTS pins(artifact_id TEXT REFERENCES artifacts(id), owner TEXT, PRIMARY KEY(artifact_id,owner));
      CREATE TABLE IF NOT EXISTS outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT, revision INTEGER, kind TEXT);
      CREATE INDEX IF NOT EXISTS actions_time ON actions(occurred);`);
    // v2 将证据主键从类型扩展为槽位，旧记录默认槽位等于类型。
    const columns = this.db.prepare("PRAGMA table_info(evidence)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "slot"))
      this.transaction(() =>
        this.db.exec(`
      ALTER TABLE evidence RENAME TO evidence_v1;
      CREATE TABLE evidence(action_id TEXT REFERENCES actions(id) ON DELETE CASCADE,kind TEXT,slot TEXT,status TEXT,artifact_id TEXT REFERENCES artifacts(id),original_artifact_id TEXT,reason TEXT,delta_ms REAL,PRIMARY KEY(action_id,slot));
      INSERT INTO evidence SELECT action_id,kind,kind,status,artifact_id,original_artifact_id,reason,delta_ms FROM evidence_v1;
      DROP TABLE evidence_v1; PRAGMA user_version=2;
    `),
      );
    // 进程重启后不能把未完成的旧采集继续显示为等待中。
    this.db.exec(
      "UPDATE evidence SET status='unavailable', reason='collector_interrupted' WHERE status='pending'",
    );
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  recordAction(action: ActionEnvelope): Observation {
    if (
      !action.action_id ||
      !/^\d+$/.test(action.source_sequence) ||
      !Number.isFinite(Date.parse(action.occurred_at))
    )
      throw new Error("invalid_action");
    if (this.getObservation(action.action_id))
      return this.getObservation(action.action_id)!;
    this.transaction(() => {
      const time = Date.parse(action.occurred_at);
      const group = JSON.stringify([
        action.collector_epoch,
        action.app?.pid,
        action.window,
        action.target_hint?.node_id,
        action.kind.startsWith("key_") ? "typing" : action.kind,
        action.kind === "scroll"
          ? Math.sign(Number(action.input?.delta_y ?? 0))
          : null,
      ]);
      const previous = this.db
        .prepare("SELECT * FROM activities ORDER BY rowid DESC LIMIT 1")
        .get() as
        | { id: string; ended: number; grouping: string; started: number }
        | undefined;
      const merge =
        ["key_down", "key_up", "scroll"].includes(action.kind) &&
        action.input?.key_category !== "special" &&
        previous?.grouping === group &&
        time >= previous.ended &&
        time - previous.ended <= this.policy.burstMs &&
        time - previous.started <= 2000;
      const activity = merge ? previous!.id : randomUUID();
      if (merge)
        this.db
          .prepare("UPDATE activities SET ended=?,count=count+1 WHERE id=?")
          .run(time, activity);
      else
        this.db
          .prepare("INSERT INTO activities VALUES(?,?,?,?,?,1)")
          .run(activity, action.kind, time, time, group);
      this.db
        .prepare(
          "INSERT INTO actions(id,epoch,seq,occurred,metadata,activity_id) VALUES(?,?,?,?,?,?)",
        )
        .run(
          action.action_id,
          action.collector_epoch,
          action.source_sequence,
          time,
          JSON.stringify(action),
          activity,
        );
      for (const slot of ["ax", "screenshot", "ocr", "screenshot_before"])
        this.db
          .prepare(
            "INSERT INTO evidence(action_id,kind,slot,status) VALUES(?,?,?,'pending')",
          )
          .run(
            action.action_id,
            slot === "screenshot_before" ? "screenshot" : slot,
            slot,
          );
      this.db
        .prepare(
          "INSERT INTO outbox(action_id,revision,kind) VALUES(?,0,'action')",
        )
        .run(action.action_id);
    });
    return this.getObservation(action.action_id)!;
  }
  putArtifact(actionId: string, input: ArtifactInput): string | null {
    const observation = this.getObservation(actionId);
    if (!observation) throw new Error("unknown_action");
    const slot = input.slot ?? input.kind;
    if (
      !["ax", "screenshot", "ocr", "screenshot_before"].includes(slot) ||
      (slot === "screenshot_before"
        ? input.kind !== "screenshot"
        : slot !== input.kind)
    )
      throw new Error("invalid_evidence_slot");
    if (!Number.isFinite(Date.parse(input.capturedAt)))
      throw new Error("invalid_capture_time");
    const available = input.status === "captured" || input.status === "shared";
    if (!available && !input.reason) throw new Error("missing_reason");
    if (available && input.bytes === undefined && input.payload === undefined)
      throw new Error("missing_content");
    if (
      available &&
      input.kind === "ocr" &&
      (!input.screenshotArtifactId ||
        this.getArtifact(input.screenshotArtifactId)?.kind !== "screenshot" ||
        !observation.evidence.some(
          (e) =>
            e.kind === "screenshot" &&
            e.artifact_id === input.screenshotArtifactId,
        ))
    )
      throw new Error("missing_ocr_source");
    return this.transaction(() => {
      let id: string | null = null;
      let status = input.status;
      if (available) {
        const payload = JSON.stringify({
          content: input.payload ?? null,
          metadata: input.metadata ?? {},
          screenshot_artifact_id: input.screenshotArtifactId ?? null,
        });
        const bytes = input.bytes ?? new Uint8Array();
        const hash = createHash("sha256")
          .update(payload)
          .update(bytes)
          .digest("hex");
        const old = this.db
          .prepare("SELECT id FROM artifacts WHERE kind=? AND hash=?")
          .get(input.kind, hash) as { id: string } | undefined;
        id = old?.id ?? randomUUID();
        if (old) status = "shared";
        if (!old)
          this.db
            .prepare("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)")
            .run(
              id,
              input.kind,
              hash,
              Date.parse(input.capturedAt),
              payload,
              bytes,
              bytes.byteLength + Buffer.byteLength(payload),
            );
      }
      this.db
        .prepare(
          "UPDATE evidence SET status=?,artifact_id=?,original_artifact_id=?,reason=?,delta_ms=? WHERE action_id=? AND slot=?",
        )
        .run(
          status,
          id,
          id,
          input.reason ?? null,
          Date.parse(input.capturedAt) -
            Date.parse(observation.action.occurred_at),
          actionId,
          slot,
        );
      this.db
        .prepare("INSERT OR IGNORE INTO evidence_history VALUES(?,?,?)")
        .run(
          actionId,
          observation.revision,
          JSON.stringify(observation.evidence),
        );
      this.db
        .prepare("UPDATE actions SET revision=revision+1 WHERE id=?")
        .run(actionId);
      this.db
        .prepare(
          "INSERT INTO outbox(action_id,revision,kind) SELECT id,revision,'evidence' FROM actions WHERE id=?",
        )
        .run(actionId);
      return id;
    });
  }
  getObservation(id: string): Observation | null {
    const row = this.db
      .prepare("SELECT metadata,activity_id,revision FROM actions WHERE id=?")
      .get(id) as
      | { metadata: string; activity_id: string; revision: number }
      | undefined;
    return row
      ? {
          action: JSON.parse(row.metadata),
          activity_id: row.activity_id,
          revision: row.revision,
          evidence: this.db
            .prepare(
              "SELECT kind,slot,status,artifact_id,original_artifact_id,reason,delta_ms FROM evidence WHERE action_id=?",
            )
            .all(id) as unknown as EvidenceLink[],
        }
      : null;
  }
  listActions(limit = 100): Observation[] {
    return (
      this.db
        .prepare("SELECT id FROM actions ORDER BY rowid DESC LIMIT ?")
        .all(Math.max(1, Math.min(limit, 500))) as { id: string }[]
    ).map((r) => this.getObservation(r.id)!);
  }
  listActivities(limit = 100) {
    return this.db
      .prepare(
        "SELECT id,kind,started,ended,count FROM activities ORDER BY rowid DESC LIMIT ?",
      )
      .all(Math.max(1, Math.min(limit, 500)));
  }
  getArtifact(id: string) {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id=?")
      .get(id) as
      | {
          id: string;
          kind: string;
          hash: string;
          captured: number;
          payload: string;
          bytes: Uint8Array;
          size: number;
        }
      | undefined;
    return row
      ? {
          ...row,
          payload: JSON.parse(row.payload),
          bytes: Buffer.from(row.bytes).toString("base64"),
        }
      : null;
  }
  pin(artifactId: string, owner: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO pins VALUES(?,?)")
      .run(artifactId, owner);
  }
  unpin(artifactId: string, owner: string) {
    this.db
      .prepare("DELETE FROM pins WHERE artifact_id=? AND owner=?")
      .run(artifactId, owner);
  }
  prune(now = Date.now()) {
    return this.transaction(() => {
      const expire = (id: string) => {
        this.db
          .prepare(
            "UPDATE evidence SET status='expired',reason='retention_policy',artifact_id=NULL WHERE artifact_id=?",
          )
          .run(id);
        this.db.prepare("DELETE FROM artifacts WHERE id=?").run(id);
      };
      this.db
        .prepare(
          "UPDATE evidence SET status='expired',reason='retention_policy',artifact_id=NULL WHERE artifact_id NOT IN (SELECT artifact_id FROM pins) AND action_id IN (SELECT id FROM actions WHERE occurred+evidence.delta_ms<?)",
        )
        .run(now - this.policy.evidenceTTL);
      for (const row of this.db
        .prepare(
          "SELECT id FROM artifacts WHERE id NOT IN (SELECT artifact_id FROM pins) AND id NOT IN (SELECT evidence.artifact_id FROM evidence JOIN actions ON actions.id=evidence.action_id WHERE actions.occurred+evidence.delta_ms>=? AND evidence.artifact_id IS NOT NULL)",
        )
        .all(now - this.policy.evidenceTTL) as { id: string }[])
        expire(row.id);
      let size = Number(
        this.db
          .prepare("SELECT COALESCE(SUM(size),0) AS size FROM artifacts")
          .get()!.size,
      );
      for (const row of this.db
        .prepare(
          "SELECT id,size FROM artifacts WHERE id NOT IN (SELECT artifact_id FROM pins) ORDER BY captured",
        )
        .all() as { id: string; size: number }[]) {
        if (size <= this.policy.maxBytes) break;
        expire(row.id);
        size -= row.size;
      }
      this.db
        .prepare("DELETE FROM actions WHERE occurred<?")
        .run(now - this.policy.metadataTTL);
      this.db.exec(
        "DELETE FROM activities WHERE id NOT IN (SELECT activity_id FROM actions)",
      );
      return { bytes: size, overBudget: size > this.policy.maxBytes };
    });
  }
  interruptPending(reason = "collector_stopped") {
    for (const row of this.db
      .prepare(
        "SELECT action_id,kind,slot FROM evidence WHERE status='pending'",
      )
      .all() as {
      action_id: string;
      kind: ArtifactInput["kind"];
      slot: string;
    }[])
      this.putArtifact(row.action_id, {
        kind: row.kind,
        slot: row.slot,
        status: "unavailable",
        reason,
        capturedAt: new Date().toISOString(),
      });
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
