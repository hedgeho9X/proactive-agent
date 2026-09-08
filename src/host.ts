import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import type { ModelConfig } from "./model/gemini.ts";
import { parseDanmaku, type DanmakuInput } from "./model/danmaku.ts";
import type { RuntimeCapabilities } from "./model/tools.ts";
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
      sidecarPath = resolve("dist/sidecar.mjs"),
      execPath = process.env.PROACTIVE_NODE ?? "node",
      electronNode = false,
      modelConfig,
      subagentConfig,
      allowedReadRoot,
      readObservation,
      sendDanmaku,
      readEvidence,
      prompts,
    }: {
      resume?: boolean;
      delayMs?: number;
      sidecarPath?: string;
      execPath?: string;
      electronNode?: boolean;
      modelConfig?: ModelConfig;
      subagentConfig?: ModelConfig;
      allowedReadRoot?: string;
      readObservation?: (id: string) => Promise<unknown>;
      sendDanmaku?: (input: DanmakuInput) => Promise<unknown>;
      readEvidence?: RuntimeCapabilities["readEvidence"];
      prompts?: RuntimeCapabilities["prompts"];
    } = {},
  ) {
    super();
    this.child = fork(sidecarPath, [root, ...(resume ? ["--resume"] : [])], {
      execPath,
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        ...(electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        PROACTIVE_FIXTURE_DELAY_MS: String(delayMs),
      },
    });
    this.child.once("spawn", () =>
      this.child.send({
        bootstrap: { modelConfig, subagentConfig, allowedReadRoot, prompts },
      }),
    );
    this.child.on("message", async (raw: any) => {
      if (!raw.toolRequest) return;
      try {
        const request = raw.toolRequest;
        let result: unknown;
        if (
          request.kind === "read_evidence" &&
          ["ax", "ocr", "image"].includes(request.part)
        )
          result = readEvidence
            ? await readEvidence(request.actionId, request.part)
            : { status: "unavailable" };
        else if (request.kind === "send_danmaku")
          result = sendDanmaku
            ? await sendDanmaku(parseDanmaku(request.input))
            : { status: "unavailable" };
        else if (!request.kind || request.kind === "read_observation")
          result = readObservation
            ? await readObservation(request.actionId)
            : { status: "unavailable" };
        else throw new Error("capability_not_allowed");
        if (this.child.connected)
          this.child.send(
            { toolResponse: { id: request.id, result } },
            () => {},
          );
      } catch {
        if (this.child.connected)
          this.child.send(
            {
              toolResponse: {
                id: raw.toolRequest.id,
                error: "capability_failed",
              },
            },
            () => {},
          );
      }
    });
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
