import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { filterAX } from "./filter.ts";
import type { EvidenceStore } from "./store.ts";
import type {
  ActionEnvelope,
  ArtifactInput,
  AXNode,
  CollectorStatus,
} from "./types.ts";
export class NativeCollectorHost {
  private child?: ChildProcessWithoutNullStreams;
  private current: CollectorStatus = { state: "stopped" };
  private screenshots = new Map<string, string>();
  private options: {
    binaryPath: string;
    store: EvidenceStore;
    onEvent?: (event: unknown) => void;
  };
  constructor(options: {
    binaryPath: string;
    store: EvidenceStore;
    onEvent?: (event: unknown) => void;
  }) {
    this.options = options;
  }
  status(): CollectorStatus {
    return { ...this.current };
  }
  private launch() {
    if (this.child) return;
    if (!existsSync(this.options.binaryPath)) {
      this.current = { state: "unavailable", reason: "collector_not_built" };
      throw new Error("collector_not_built");
    }
    this.child = spawn(this.options.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        if (line.length > 32 * 1024 * 1024)
          throw new Error("collector_message_too_large");
        const event = JSON.parse(line);
        if (event.type === "ack") {
          const waiter = this.waiters.get(event.request_id);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.waiters.delete(event.request_id);
            waiter.resolve(this.status());
          }
        }
        if (event.type === "status")
          this.current = {
            state: event.state,
            reason: event.reason,
            permissions: event.permissions ?? this.current.permissions,
          };
        if (event.type === "permissions")
          this.current.permissions = event.permissions;
        if (event.type === "action")
          this.options.store.recordAction({
            ...event.action,
            received_at: new Date().toISOString(),
          } as ActionEnvelope);
        if (event.type === "artifact") {
          if (!["ax", "screenshot", "ocr"].includes(event.kind))
            throw new Error("unknown_artifact_kind");
          if (event.kind === "ax" && event.payload?.nodes) {
            const filtered = filterAX(event.payload.nodes as AXNode[]);
            event.payload.nodes = filtered.normalized;
            event.payload.context = filtered;
          }
          const input: ArtifactInput = {
            ...event,
            bytes: event.bytes ? Buffer.from(event.bytes, "base64") : undefined,
            screenshotArtifactId:
              event.kind === "ocr"
                ? this.screenshots.get(event.action_id)
                : undefined,
          };
          const id = this.options.store.putArtifact(event.action_id, input);
          if (event.kind === "screenshot" && id)
            this.screenshots.set(event.action_id, id);
          if (event.kind === "ocr") this.screenshots.delete(event.action_id);
        }
        this.options.onEvent?.(event);
      } catch (error) {
        this.child?.kill("SIGTERM");
        this.current = { state: "unavailable", reason: String(error) };
        this.options.onEvent?.({ type: "error", reason: String(error) });
      }
    });
    this.child.stderr.on("data", (data) => {
      this.options.onEvent?.({
        type: "collector_diagnostic",
        message: String(data).slice(0, 2048),
      });
    });
    this.child.on("error", (error) => {
      this.current = { state: "unavailable", reason: error.message };
      this.options.onEvent?.(this.current);
    });
    this.child.on("exit", () => {
      for (const waiter of this.waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("collector_exited"));
      }
      this.waiters.clear();
      this.options.store.interruptPending("collector_exited");
      this.child = undefined;
      if (this.current.state !== "unavailable")
        this.current = { state: "stopped" };
      this.options.onEvent?.(this.current);
    });
  }
  private waiters = new Map<
    string,
    {
      resolve: (status: CollectorStatus) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private request(
    command: string,
    extra: Record<string, unknown> = {},
  ): Promise<CollectorStatus> {
    this.launch();
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        this.current = {
          state: "unavailable",
          reason: "collector_ack_timeout",
        };
        this.child?.kill("SIGTERM");
        reject(new Error("collector_ack_timeout"));
      }, 5000);
      this.waiters.set(requestId, { resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ command, request_id: requestId, ...extra }) + "\n",
      );
    });
  }
  async checkPermissions(): Promise<CollectorStatus> {
    return this.request("permissions");
  }
  async start(config: {
    allowedBundleIds: string[];
  }): Promise<CollectorStatus> {
    if (!config.allowedBundleIds.length)
      throw new Error("explicit_allowlist_required");
    this.current = { state: "starting" };
    return this.request("start", config);
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.current = { state: "stopped" };
      return;
    }
    this.current = { state: "stopping" };
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.write(JSON.stringify({ command: "shutdown" }) + "\n");
    });
    this.screenshots.clear();
    this.current = { state: "stopped" };
  }
}
