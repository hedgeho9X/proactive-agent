import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join, resolve } from "node:path";
import {
  mkdir,
  readdir,
  stat,
  unlink,
  readFile,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { EvidenceStore } from "../observation/store.ts";
import { NativeCollectorHost } from "../observation/native-host.ts";
import { RuntimeHost } from "../host.ts";
import {
  UnderstandingService,
  type UnderstandingInput,
} from "../model/understanding.ts";
import type { ModelConfig } from "../model/gemini.ts";

app.setName("Proactive Lab");
app.setPath(
  "userData",
  process.env.PROACTIVE_DATA_DIR ??
    join(app.getPath("appData"), "Proactive Lab"),
);
let window: BrowserWindow | undefined;
let store: EvidenceStore;
let collector: NativeCollectorHost;
let runtime: RuntimeHost | undefined;
let config: ModelConfig | undefined;
let mode = "unavailable";
let connection = "unavailable";
let allowedReadRoot: string | undefined;
let autoUnderstand = false;
let shuttingDown = false;
const events: any[] = [];
const understandings = new Map<string, unknown>();
let sequence = 0;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let autoBusy = false;
let lastAutoAction = "";
const autoProcessed = new Set<string>();
function emit(event: any) {
  if (event.event?.type === "assistant/message") {
    event = structuredClone(event);
    delete event.event.data.message.source.replayState;
  }
  if (event.kind === "model.usage" || event.kind === "understanding.completed")
    connection = "connected";
  if (event.kind === "model.error" || event.kind === "understanding.failed")
    connection = "last_request_failed";
  events.push({ ...event, id: ++sequence, at: new Date().toISOString() });
  if (events.length > 1000) events.splice(0, events.length - 1000);
  window?.webContents.send("proactive:event");
}
function observation(actionId: string) {
  const item = store.getObservation(actionId);
  if (!item) throw new Error("action_not_found");
  const artifacts = Object.fromEntries(
    item.evidence.map((link) => [
      link.slot ?? link.kind,
      link.artifact_id ? store.getArtifact(link.artifact_id) : null,
    ]),
  );
  return {
    ...item,
    artifacts,
    understanding: understandings.get(actionId) ?? null,
  };
}
function snapshot() {
  return {
    actions: store.listActions(200),
    activities: store.listActivities(100),
    collector: collector.status(),
    events,
    mode,
    connection,
    model: config?.model ?? null,
    hasKey: !!config?.apiKey && mode === "gemini",
    allowedReadRoot,
    autoUnderstand,
    dataDir: app.getPath("userData"),
  };
}
let understanding: UnderstandingService;
async function summarize(actionId: string, view: "raw" | "context") {
  if (!config || mode !== "gemini") throw new Error("model_unavailable");
  const item = observation(actionId);
  const input: UnderstandingInput = {
    action: item.action as unknown as Record<string, unknown>,
    revision: item.revision,
    evidence: item.evidence,
    artifacts: item.artifacts,
    view,
  };
  const result = await understanding.summarize(input, config);
  understandings.set(actionId, result);
  emit({
    kind: "understanding.available",
    actionId,
    cached: (result as any).cached,
  });
  if (runtime && mode === "gemini")
    await runtime.request("observe", {
      actionId: actionId + ":understanding:" + view + ":" + item.revision,
      value: {
        observation: item.action,
        understanding: (result as any).result,
        evidence_action_id: actionId,
      },
    });
  return result;
}
function scheduleUnderstanding() {
  if (!autoUnderstand || !config || autoBusy) return;
  if (autoTimer) return;
  autoTimer = setTimeout(async () => {
    autoTimer = undefined;
    const candidate = store
      .listActions(20)
      .find(
        (o) =>
          (!["key_down", "key_up"].includes(o.action.kind) ||
            o.action.input?.key_category === "special") &&
          o.evidence.every((e) => e.status !== "pending") &&
          !autoProcessed.has(o.action.action_id) &&
          o.action.policy_status !== "excluded",
      );
    if (!candidate) return;
    lastAutoAction = candidate.action.action_id;
    autoProcessed.add(lastAutoAction);
    autoBusy = true;
    try {
      await summarize(lastAutoAction, "context");
    } catch (error) {
      emit({ kind: "error", message: String(error) });
    } finally {
      autoBusy = false;
      scheduleUnderstanding();
    }
  }, 1500);
}
async function startRuntime(fixture: boolean) {
  if (runtime) {
    await runtime.close();
    const known = new Map<string, any>();
    for (const event of events)
      if (event.kind?.startsWith("task.")) known.set(event.taskId, event);
    for (const task of known.values())
      if (!["stopped", "interrupted"].includes(task.status))
        emit({
          kind: "task.interrupted",
          taskId: task.taskId,
          status: "interrupted",
          reason: "runtime_restarted",
        });
  }
  if (fixture) autoUnderstand = false;
  mode = fixture ? "deterministic_fixture" : config ? "gemini" : "unavailable";
  if (mode === "unavailable") throw new Error("model_unavailable");
  const sessionRoot = join(
    app.getPath("userData"),
    "sessions",
    fixture ? "fixture" : "gemini",
  );
  const marker = join(sessionRoot, "started.json");
  runtime = new RuntimeHost(sessionRoot, {
    resume: existsSync(marker),
    delayMs: 2_000,
    sidecarPath: join(app.getAppPath(), "dist", "sidecar.mjs"),
    execPath: process.execPath,
    electronNode: true,
    modelConfig: fixture ? undefined : config,
    allowedReadRoot,
    readObservation: async (id) => {
      const item = observation(id);
      return {
        ...item,
        artifacts: Object.fromEntries(
          Object.entries(item.artifacts).map(([k, a]) => [
            k,
            a ? { ...a, bytes: undefined } : null,
          ]),
        ),
      };
    },
  });
  runtime.on("event", (event) => emit({ ...event, runtimeMode: mode }));
  runtime.on("diagnostic", (message) =>
    emit({ kind: "runtime.diagnostic", message }),
  );
  await runtime.ready;
  await writeFile(marker, JSON.stringify({ mode }));
  for (const row of await runtime.request("events"))
    emit({ kind: "session.event", ...row, replayed: true, runtimeMode: mode });
  emit({ kind: "runtime.ready", mode, restored_tasks: "not_reconstructed" });
}
async function closeAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(autoTimer);
  await collector?.stop();
  await runtime?.close();
  store?.close();
}
app.on("before-quit", (event) => {
  if (!shuttingDown) {
    event.preventDefault();
    void closeAll().finally(() => app.quit());
  }
});
// ESM导入完成前Electron不会ready，不能在模块顶层等待whenReady。
async function bootstrap() {
  console.error("[proactive] bootstrap:ready");
  await mkdir(app.getPath("userData"), { recursive: true });
  store = new EvidenceStore(
    join(app.getPath("userData"), "observations.sqlite"),
  );
  collector = new NativeCollectorHost({
    binaryPath: join(app.getAppPath(), "dist", "native", "ProactiveCollector"),
    store,
    onEvent: (event: any) => {
      if (["status", "permissions", "error"].includes(event.type))
        emit({ kind: "collector." + event.type, ...event });
      window?.webContents.send("proactive:event");
      scheduleUnderstanding();
    },
  });
  const cacheDir = join(app.getPath("userData"), "understanding");
  understanding = new UnderstandingService(cacheDir, emit);
  async function pruneCache() {
    if (!existsSync(cacheDir)) return;
    for (const name of await readdir(cacheDir)) {
      const file = join(cacheDir, name);
      if ((await stat(file)).mtimeMs < Date.now() - 86_400_000)
        await unlink(file);
    }
  }
  await pruneCache();
  // 冷启动只从DSH原生日志读历史，不重建或假装恢复内存中的任务状态。
  const historyRoot = join(app.getPath("userData"), "sessions");
  if (existsSync(historyRoot))
    for (const file of await readdir(historyRoot, { recursive: true })) {
      if (!file.endsWith("session.jsonl")) continue;
      const lines = (await readFile(join(historyRoot, file), "utf8"))
        .trim()
        .split("\n");
      try {
        const header = JSON.parse(lines[0]);
        for (const line of lines.slice(-1000)) {
          const event = JSON.parse(line);
          if (typeof event.seq === "number")
            emit({
              kind: "session.event",
              sessionId: header.id,
              event,
              replayed: true,
              runtimeMode: file.startsWith("fixture")
                ? "deterministic_fixture"
                : "gemini",
            });
        }
      } catch {
        emit({
          kind: "runtime.history_error",
          message: "history_tail_unreadable",
        });
      }
    }
  const cleanup = setInterval(() => {
    store.prune();
    void pruneCache();
  }, 60_000);
  cleanup.unref();
  ipcMain.handle(
    "proactive:invoke",
    async (_event, method: string, p: any = {}) => {
      switch (method) {
        case "snapshot":
          return snapshot();
        case "observation":
          return observation(String(p.actionId));
        case "permissions":
          await collector.checkPermissions();
          return collector.status();
        case "capture.start": {
          const allowedBundleIds = String(p.bundleIds ?? "")
            .split(/[\s,]+/)
            .filter(Boolean);
          if (!allowedBundleIds.length) throw new Error("allowlist_required");
          await collector.start({ allowedBundleIds });
          return snapshot();
        }
        case "capture.stop":
          await collector.stop();
          return snapshot();
        case "config": {
          if (!p.apiKey || !/^gemini-[a-zA-Z0-9.\-]+$/.test(p.model))
            throw new Error("invalid_model_config");
          config = { apiKey: String(p.apiKey), model: p.model, maxCalls: 30 };
          connection = "configured_unverified";
          await startRuntime(false);
          return { mode, model: config.model };
        }
        case "fixture":
          await startRuntime(true);
          await runtime!.request("observe", {
            actionId: "fixture-" + Date.now(),
            value: {
              scenario: "dispatch",
              taskId: "demo-" + Date.now(),
              target: "Monday",
            },
          });
          return { mode };
        case "prompt":
          if (!runtime) throw new Error("agent_unavailable");
          return runtime.request("observe", {
            actionId: "prompt-" + Date.now(),
            value:
              mode === "gemini"
                ? { user_prompt: String(p.text) }
                : {
                    scenario: "observation",
                    fact: String(p.text),
                    origin: "user_prompt",
                  },
          });
        case "revise": {
          if (!runtime) throw new Error("agent_unavailable");
          const result = await runtime.request("revise", {
            taskId: p.taskId,
            target: p.target,
          });
          emit({ kind: "task.revised", ...result });
          return result;
        }
        case "cancel":
          if (!runtime) throw new Error("agent_unavailable");
          return runtime.request("cancel", { taskId: p.taskId });
        case "summarize":
          return summarize(
            String(p.actionId),
            p.view === "raw" ? "raw" : "context",
          );
        case "auto":
          autoUnderstand = !!p.enabled;
          scheduleUnderstanding();
          return { autoUnderstand };
        case "readRoot": {
          const choice = await dialog.showOpenDialog({
            properties: ["openDirectory"],
          });
          if (!choice.canceled) {
            allowedReadRoot = choice.filePaths[0];
            if (runtime) await startRuntime(mode !== "gemini");
          }
          return { allowedReadRoot };
        }
        default:
          throw new Error("method_not_allowed");
      }
    },
  );
  window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    title: "Proactive Lab",
    backgroundColor: "#f5f5f2",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await window.loadFile(
    join(app.getAppPath(), "dist", "renderer", "index.html"),
  );
  console.error("[proactive] bootstrap:window-loaded");
}
app.on("window-all-closed", () => app.quit());
void app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error(
      "[proactive] bootstrap:failed",
      error instanceof Error ? error.stack : String(error),
    );
    void closeAll().finally(() => app.exit(1));
  });
