import { ProactiveRuntime } from "./runtime.ts";
// 只接受父进程私有 IPC；不开放网络端口，也不加载用户 DSH home/profile。
if (!process.send) throw new Error("sidecar_requires_parent_ipc");
const root = process.argv[2];
if (!root) throw new Error("runtime_root_required");
const toolPending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function requestCapability(request: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      toolPending.delete(id);
      reject(new Error("capability_timeout"));
    }, 5000);
    timer.unref();
    toolPending.set(id, { resolve, reject, timer });
    process.send?.({ toolRequest: { ...request, id } });
  });
}
let runtime: ProactiveRuntime;
const ready = new Promise<unknown>((resolve, reject) => {
  process.once("message", async (raw: any) => {
    if (!raw.bootstrap) {
      reject(new Error("bootstrap_required"));
      return;
    }
    const { modelConfig, subagentConfig, allowedReadRoot, prompts } =
      raw.bootstrap;
    runtime = new ProactiveRuntime(
      root,
      (event) => process.send?.({ event }),
      Number(process.env.PROACTIVE_FIXTURE_DELAY_MS ?? 20_000),
      {
        allowedReadRoot,
        prompts,
        readEvidence: (actionId, part) =>
          requestCapability({ kind: "read_evidence", actionId, part }),
        readObservation: (actionId) =>
          requestCapability({ kind: "read_observation", actionId }),
        sendDanmaku: (input) =>
          requestCapability({ kind: "send_danmaku", input }),
      },
    );
    try {
      resolve(
        await runtime.start(
          process.argv.includes("--resume"),
          modelConfig,
          subagentConfig,
        ),
      );
    } catch (error) {
      reject(error);
    }
  });
});
ready.then(
  (value) => process.send?.({ ready: value }),
  async (error) => {
    await runtime?.close();
    process.exitCode = 1;
    process.send?.({ fatal: String(error) }, () => process.disconnect?.());
  },
);
process.on("message", async (raw: any) => {
  if (raw.bootstrap) return;
  if (raw.toolResponse) {
    const p = toolPending.get(raw.toolResponse.id);
    toolPending.delete(raw.toolResponse.id);
    if (p) {
      clearTimeout(p.timer);
      raw.toolResponse.error
        ? p.reject(new Error(raw.toolResponse.error))
        : p.resolve(raw.toolResponse.result);
    }
    return;
  }
  const message = raw as { id: number; method: string; params?: any };
  try {
    await ready;
    const p = message.params ?? {};
    let result: unknown;
    switch (message.method) {
      case "observe":
        result = await runtime.observe(p.actionId, p.value, p.imageBase64);
        break;
      case "revise":
        result = await runtime.revise(p.taskId, p.target);
        break;
      case "cancel":
        result = await runtime.cancel(p.taskId);
        break;
      case "idle":
        result = await runtime.idle(p.sessionId);
        break;
      case "events":
        result = runtime.events(p.cursors);
        break;
      case "close":
        await runtime?.close();
        process.send?.({ id: message.id, result: { closed: true } }, () =>
          process.disconnect?.(),
        );
        return;
      default:
        throw new Error("unknown_method");
    }
    process.send?.({ id: message.id, result });
  } catch (error) {
    process.send?.({ id: message.id, error: String(error) });
  }
});
process.on("disconnect", () => {
  for (const p of toolPending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("desktop_disconnected"));
  }
  toolPending.clear();
  void runtime?.close();
});
