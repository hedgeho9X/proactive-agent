import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

// 记录开始前预热采集进程，事件到达后只通过管道发请求。
export class AXInspectorClient {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private binary: string) {}
  start(): Promise<void> {
    if (this.ready) return this.ready;
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
          const pending = this.pending.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.requestId);
            pending.resolve(message.result);
          }
        } catch {
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
          item.reject(new Error("inspector_exited"));
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
        this.pending.delete(requestId);
        reject(new Error("inspection_timeout"));
        this.child?.kill("SIGTERM");
      }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
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
