/** 接收原生动作并有界调度采集；自身操作在截图、落盘和理解投递前排除。 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AXHistory } from "./ax-history.ts";
import { EditingSessions } from "./editing-sessions.ts";

// 原始输入独立落盘；在途数量有界，满额时记录原因，不积压过时截图请求。
export class AXRecorder {
  private child?: ChildProcessWithoutNullStreams;
  private jobs = new Set<Promise<void>>();
  private capturing = 0;
  private editing: EditingSessions;
  private scope: { allApps: boolean; allowedBundleIds: string[] } = {
    allApps: true,
    allowedBundleIds: [],
  };
  private current = { state: "stopped", reason: "", count: 0 };
  constructor(
    private binary: string,
    private history: AXHistory,
    private inspect: (event: any) => Promise<any>,
    private changed: () => void,
    private completed?: (snapshot: any) => Promise<void>,
    private maxConcurrent = 1,
    private lifecycle?: {
      admitted: (event: any) => void;
      settled: (event: any) => void;
    },
  ) {
    this.editing = new EditingSessions(history, changed);
  }
  status() {
    return {
      ...this.current,
      pending: this.jobs.size,
      capturing: this.capturing,
      maxConcurrent: this.maxConcurrent,
    };
  }
  async accept(event: any) {
    if (
      !/^ax-[0-9a-f-]{36}$/.test(event?.id ?? "") ||
      !Number.isInteger(event.pid)
    )
      throw new Error("invalid_input_event");
    // AX 命中可以纠正 Dock 覆盖层误归属；原生目标 PID 可能滞后，不能单独作为排除依据。
    if (
      event.pid === process.pid ||
      event.targetWindow?.pid === process.pid ||
      event.targetResolution?.hitTestPid === process.pid ||
      event.bundleId === "io.github.hedgeho9x.proactive-agent"
    )
      return;
    if (
      !this.scope.allApps &&
      !this.scope.allowedBundleIds.includes(event.bundleId)
    )
      return;
    if (["editing_update", "editing_closed"].includes(event.kind)) {
      await this.editing.accept(event);
      return;
    }
    const editingEvidence = this.editing.evidence(event);
    const captures = ["click", "key_down"].includes(event.kind);
    // 防御旧监听协议，松开及修饰键不再生成空快照记录。
    if (!captures) return;
    this.lifecycle?.admitted(event);
    const captureStatus =
      this.capturing >= this.maxConcurrent ? "skipped_busy" : "pending";
    if (captureStatus === "pending") this.capturing++;
    // 截图请求与事件落盘同时启动，避免磁盘延迟推迟取证。
    const inspection =
      captureStatus === "pending"
        ? this.inspect(event).then(
            (result) => ({ result, error: false }),
            (error) => ({ result: null, error }),
          )
        : null;
    try {
      await this.history.save(
        {
          pid: event.pid,
          app: event.app,
          bundleId: event.bundleId,
          capturedAt: null,
          nodes: [],
          trigger: event,
          editingEvidence,
          captureStatus,
          partial: true,
          screenshot: { status: "unavailable", reason: captureStatus },
          captureDiagnostics: {
            stage: "capture_admission",
            reason: captureStatus,
            inFlight: this.capturing,
            limit: this.maxConcurrent,
            target: event.targetWindow ?? null,
          },
        },
        event.id,
      );
      this.current.count++;
      this.changed();
      if (captureStatus !== "pending") return;
      try {
        const outcome = await inspection!;
        if (outcome.error) throw outcome.error;
        const result = outcome.result;
        const failed =
          !!result.error ||
          result.screenshot?.status !== "captured" ||
          !result.screenshot?.data;
        const reason =
          result.error ?? result.screenshot?.reason ?? "screenshot_required";
        const saved = await this.history.update(event.id, {
          ...result,
          nodes: result.nodes ?? [],
          trigger: event,
          captureStatus: failed ? "failed" : "captured",
          captureError: failed ? reason : undefined,
          screenshot: result.screenshot ?? {
            status: "error",
            reason,
            stage: result.captureDiagnostics?.stage ?? "inspector_result",
          },
        });
        if (!failed && this.completed) {
          // Agent 路由失败不能把成功截图改成采集失败，也不能停止输入监听。
          try {
            await this.completed(saved);
          } catch {
            await this.history.update(event.id, {
              routing: { status: "failed", reason: "routing_failed" },
            });
          }
        }
      } catch (error) {
        const reason =
          error instanceof Error &&
          /^(inspection_|inspector_)/.test(error.message)
            ? error.message
            : "inspection_failed";
        const diagnostics = (error as any)?.captureDiagnostics ?? {
          stage: "inspector_ipc",
          reason,
          target: event.targetWindow ?? null,
        };
        await this.history.update(event.id, {
          captureStatus: "failed",
          captureError: reason,
          captureDiagnostics: diagnostics,
          screenshot: {
            status: "unavailable",
            reason,
            stage: diagnostics.stage,
          },
        });
      }
      this.changed();
    } finally {
      if (captureStatus === "pending") this.capturing--;
      this.lifecycle?.settled(event);
    }
  }
  async start(scope?: { allApps: boolean; allowedBundleIds: string[] }) {
    if (this.child || this.jobs.size) return this.status();
    if (scope) {
      if (!scope.allApps && !scope.allowedBundleIds.length)
        throw new Error("explicit_allowlist_required");
      this.scope = scope;
    } else this.scope = { allApps: true, allowedBundleIds: [] };
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
    await this.editing.close();
    if (this.current.state !== "failed") this.current.state = "stopped";
    this.changed();
    return this.status();
  }
}
