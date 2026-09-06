import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AXHistory } from "./ax-history.ts";

// 原始输入事件先独立落盘；重采集仅一个在途，忙时不积压过时截图请求。
export class AXRecorder {
  private child?: ChildProcessWithoutNullStreams;
  private jobs = new Set<Promise<void>>();
  private captureBusy = false;
  private current = { state: "stopped", reason: "", count: 0 };
  constructor(
    private binary: string,
    private history: AXHistory,
    private inspect: (event: any) => Promise<any>,
    private changed: () => void,
  ) {}
  status() {
    return { ...this.current, pending: this.jobs.size };
  }
  async accept(event: any) {
    if (
      !/^ax-[0-9a-f-]{36}$/.test(event?.id ?? "") ||
      !Number.isInteger(event.pid)
    )
      throw new Error("invalid_input_event");
    const captures = ["click", "key_down"].includes(event.kind);
    const captureStatus = !captures
      ? "event_only"
      : this.captureBusy
        ? "skipped_busy"
        : "pending";
    if (captureStatus === "pending") this.captureBusy = true;
    try {
      await this.history.save(
        {
          pid: event.pid,
          app: event.app,
          bundleId: event.bundleId,
          capturedAt: null,
          nodes: [],
          trigger: event,
          captureStatus,
          partial: true,
          screenshot: { status: "unavailable", reason: captureStatus },
        },
        event.id,
      );
      this.current.count++;
      this.changed();
      if (captureStatus !== "pending") return;
      try {
        const result = await this.inspect(event);
        const failed = !!result.error;
        await this.history.update(event.id, {
          ...result,
          nodes: result.nodes ?? [],
          trigger: event,
          captureStatus: failed ? "failed" : "captured",
          captureError: failed ? result.error : undefined,
        });
      } catch {
        await this.history.update(event.id, {
          captureStatus: "failed",
          captureError: "inspection_failed_or_timeout",
          screenshot: {
            status: "unavailable",
            reason: "inspection_failed_or_timeout",
          },
        });
      }
      this.changed();
    } finally {
      if (captureStatus === "pending") this.captureBusy = false;
    }
  }
  async start() {
    if (this.child || this.jobs.size) return this.status();
    this.current = { state: "starting", reason: "", count: 0 };
    const child = spawn(this.binary, ["--watch-input"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    // 不记录原始 stderr，避免平台诊断意外带入应用正文。
    child.stderr.resume();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("watch_start_timeout"));
      }, 5000);
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.type === "watch_ready") {
            clearTimeout(timer);
            this.current.state = "running";
            this.changed();
            resolve(this.status());
          }
          if (message.type === "watch_error") {
            clearTimeout(timer);
            this.current = {
              ...this.current,
              state: "failed",
              reason: message.reason,
            };
            this.changed();
            reject(new Error(message.reason));
          }
          if (message.type === "input_event") {
            if (this.jobs.size >= 500) {
              this.current = {
                ...this.current,
                state: "failed",
                reason: "storage_backpressure_recording_stopped",
              };
              child.kill("SIGTERM");
              this.changed();
              return;
            }
            const job = this.accept(message.event)
              .catch(() => {
                this.current = {
                  ...this.current,
                  state: "failed",
                  reason: "event_storage_failed",
                };
                child.kill("SIGTERM");
                this.changed();
              })
              .finally(() => this.jobs.delete(job));
            this.jobs.add(job);
          }
        } catch {
          this.current = {
            ...this.current,
            state: "failed",
            reason: "invalid_watch_protocol",
          };
          child.kill("SIGTERM");
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        this.current = {
          ...this.current,
          state: "failed",
          reason: "watch_start_failed",
        };
        this.changed();
        reject(new Error("watch_start_failed"));
      });
      child.on("exit", () => {
        clearTimeout(timer);
        this.child = undefined;
        if (
          this.current.state !== "failed" &&
          this.current.state !== "stopping"
        )
          this.current.state = "stopped";
        this.changed();
        reject(new Error("watch_exited"));
      });
    });
  }
  async stop() {
    this.current.state = "stopping";
    const child = this.child;
    if (child)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGTERM"), 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
    await Promise.all([...this.jobs]);
    if (this.current.state !== "failed") this.current.state = "stopped";
    this.changed();
    return this.status();
  }
}
