import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

// 记录开始前预热采集进程，事件到达后只通过管道发请求。
export class AXInspectorClient {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private stopReason = "process_exited";
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      stages: Record<string, any>;
    }
  >();
  constructor(
    private binary: string,
    private timeoutMs = 15000,
  ) {}
  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.stopReason = "process_exited";
    const child = spawn(this.binary, ["--inspect-stream"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.resume();
    this.ready = new Promise((resolve, reject) => {
      const boot = setTimeout(() => {
        reject(new Error("inspector_boot_timeout"));
        child.kill("SIGTERM");
      }, 5000);
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          if (line.length > 32 * 1024 * 1024)
            throw new Error("inspection_too_large");
          const message = JSON.parse(line);
          if (message.type === "inspector_ready") {
            clearTimeout(boot);
            resolve();
            return;
          }
          if (message.type === "inspection_progress") {
            const pending = this.pending.get(
              message.progressFor ?? message.requestId,
            );
            if (pending && typeof message.progress?.component === "string")
              pending.stages[message.progress.component] = message.progress;
            return;
          }
          const pending = this.pending.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.requestId);
            pending.resolve(message.result);
          }
        } catch {
          this.stopReason = "invalid_inspector_protocol";
          child.kill("SIGTERM");
        }
      });
      child.on("error", () => {
        clearTimeout(boot);
        reject(new Error("inspector_start_failed"));
      });
      child.on("close", () => {
        clearTimeout(boot);
        this.child = undefined;
        this.ready = undefined;
        reject(new Error("inspector_exited"));
        for (const item of this.pending.values()) {
          clearTimeout(item.timer);
          item.reject(
            Object.assign(new Error("inspector_exited"), {
              captureDiagnostics: {
                stage: "inspector_ipc",
                reason: "inspector_exited",
                processReason: this.stopReason,
                lastKnownStages: item.stages,
              },
            }),
          );
        }
        this.pending.clear();
      });
    });
    return this.ready;
  }
  async inspect(event: any) {
    await this.start();
    const requestId = crypto.randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const stages = this.pending.get(requestId)?.stages ?? {};
        this.pending.delete(requestId);
        const active = Object.values(stages).find(
          (item: any) => item.state === "running",
        ) as any;
        reject(
          Object.assign(new Error("inspection_timeout"), {
            captureDiagnostics: {
              stage: active?.stage ?? "inspector_ipc",
              reason: "inspection_timeout",
              timeoutMs: this.timeoutMs,
              target: event.targetWindow ?? null,
              lastKnownStages: stages,
            },
          }),
        );
        this.stopReason = `inspection_timeout:${requestId}`;
        this.child?.kill("SIGTERM");
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, stages: {} });
      this.child!.stdin.write(
        JSON.stringify({ requestId, event }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(requestId);
            reject(new Error("inspector_write_failed"));
          }
        },
      );
    });
  }
  async close() {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGTERM"), 1000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
