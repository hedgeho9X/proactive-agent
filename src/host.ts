import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
// 宿主拥有 sidecar 生命周期；丢失 IPC 时子进程自行停止所有 DSH 活动。
export class RuntimeHost extends EventEmitter {
  readonly child: ChildProcess;
  readonly ready: Promise<unknown>;
  readonly exited: Promise<void>;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    root: string,
    {
      resume = false,
      delayMs = 20_000,
    }: { resume?: boolean; delayMs?: number } = {},
  ) {
    super();
    this.child = fork(
      fileURLToPath(new URL("./sidecar.ts", import.meta.url)),
      [root, ...(resume ? ["--resume"] : [])],
      {
        execPath: process.env.PROACTIVE_NODE ?? "node",
        execArgv: ["--experimental-transform-types"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          PATH: process.env.PATH,
          PROACTIVE_FIXTURE_DELAY_MS: String(delayMs),
        },
      },
    );
    this.child.stderr?.on("data", (data) =>
      this.emit("diagnostic", String(data)),
    );
    this.exited = new Promise((resolve) =>
      this.child.once("exit", () => resolve()),
    );
    this.ready = new Promise((resolve, reject) => {
      this.child.on("message", (raw: any) => {
        if (raw.ready) resolve(raw.ready);
        if (raw.fatal) reject(new Error(raw.fatal));
        if (raw.event) this.emit("event", raw.event);
        if (raw.id !== undefined) {
          const pending = this.pending.get(raw.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(raw.id);
            raw.error
              ? pending.reject(new Error(raw.error))
              : pending.resolve(raw.result);
          }
        }
      });
      this.child.once("error", reject);
      this.child.once("exit", () => {
        reject(new Error("sidecar_exited"));
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("sidecar_exited"));
        }
        this.pending.clear();
      });
    });
  }
  async request(method: string, params: unknown = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("request_timeout:" + method));
      }, 35_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, method, params }, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  async close() {
    try {
      if (this.child.connected) await this.request("close");
    } finally {
      if (this.child.exitCode === null) {
        const timeout = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
        await this.exited;
        clearTimeout(timeout);
      }
    }
  }
}
