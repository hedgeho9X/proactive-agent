import { ProactiveRuntime } from "./runtime.ts";
// 只接受父进程私有 IPC；不开放网络端口，也不加载用户 DSH home/profile。
if (!process.send) throw new Error("sidecar_requires_parent_ipc");
const root = process.argv[2];
if (!root) throw new Error("runtime_root_required");
const runtime = new ProactiveRuntime(
  root,
  (event) => process.send?.({ event }),
  Number(process.env.PROACTIVE_FIXTURE_DELAY_MS ?? 20_000),
);
const ready = runtime.start(process.argv.includes("--resume"));
ready.then(
  (value) => process.send?.({ ready: value }),
  async (error) => {
    await runtime.close();
    process.exitCode = 1;
    process.send?.({ fatal: String(error) }, () => process.disconnect?.());
  },
);
process.on("message", async (raw) => {
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
        await runtime.close();
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
  void runtime.close();
});
