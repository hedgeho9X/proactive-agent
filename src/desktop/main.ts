import { ModelRoles, type ModelRole } from "../model/config.ts";
import { testModelConnection } from "../model/connection-test.ts";
import { ActionQueue } from "../model/queue.ts";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  nativeImage,
  ClipboardItem,
} from "electron";
import { AXHistory } from "../observation/ax-history.ts";
import { AXRecorder } from "../observation/ax-recorder.ts";
import { AXInspectorClient } from "../observation/ax-inspector-client.ts";
import { RoutingStore } from "../observation/routing-store.ts";
import {
  matchesRouting,
  snapshotRoutingReason,
} from "../observation/routing-policy.ts";
import { axObservation } from "../observation/ax-agent-bridge.ts";
import { projectVisualEvidence } from "../model/understanding-evidence.ts";
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
import { DesktopDanmaku } from "./danmaku.ts";
import { ApplicationIcons } from "./application-icons.ts";
import { HistoryClear } from "../observation/clear-history.ts";
import { PromptStore, type PromptRole } from "../model/prompts.ts";
import { prepareEvidence } from "../observation/prepare-evidence.ts";
import { buildUserPrompt as buildMainPrompt } from "../../prompts/main.ts";
import { trajectoryLine } from "../model/trajectory.ts";
import {
  EvidenceSession,
  type EvidenceRow,
} from "../understanding/evidence-session.ts";
import { WebResearch } from "../understanding/web-research.ts";
import { SearchSettings } from "../understanding/search-settings.ts";
import { createHash } from "node:crypto";
import { captureDiagnostic } from "../observation/capture-diagnostics.ts";
import { desktopCredentials } from "./credentials.ts";

app.setName("Proactive Agent");
app.setPath(
  "userData",
  process.env.PROACTIVE_DATA_DIR ??
    join(app.getPath("appData"), "Proactive Agent"),
);
// 同一数据目录只允许一个桌面实例，防止清理期间其他实例继续写入旧数据库。
const ownsDataDirectory = app.requestSingleInstanceLock();
if (!ownsDataDirectory) app.quit();
let window: BrowserWindow | undefined;
let danmaku: DesktopDanmaku | undefined;
let store: EvidenceStore;
let collector: NativeCollectorHost;
let axRecorder: AXRecorder | undefined;
let axInspector: AXInspectorClient | undefined;
let routing: RoutingStore;
let axHistory: AXHistory;
let runtime: RuntimeHost | undefined;
let runtimeReady = false;
let mainIdle = true;
let aiConcurrency = 10;
let modelRoles: ModelRoles;
let searchSettings: SearchSettings;
let prompts: PromptStore;
let queue: ActionQueue;
let mode = "unavailable";
let connection = "unavailable";
let allowedReadRoot: string | undefined;
let autoUnderstand = false;
let shuttingDown = false;
let clearing = false;
let dataUnavailable = false;
let clearWork: Promise<unknown> | undefined;
let clearState: any = { phase: "idle" };
let historyGeneration = 0;
const operations = new Set<Promise<unknown>>();
const events: any[] = [];
const understandings = new Map<string, unknown>();
let sequence = 0;
function notify() {
  if (
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !window.webContents.isCrashed()
  )
    window.webContents.send("proactive:event");
}
function emit(event: any) {
  if (event.event?.type === "assistant/message") {
    event = structuredClone(event);
    delete event.event.data.message.source.replayState;
  }
  if (event.role && modelRoles) {
    modelRoles.status[event.role as ModelRole] = [
      "model.usage",
      "model.completed",
    ].includes(event.kind)
      ? "connected"
      : event.kind === "model.error"
        ? "last_request_failed"
        : modelRoles.status[event.role as ModelRole];
  }
  if (event.kind === "model.usage" || event.kind === "understanding.completed")
    connection = "connected";
  if (event.kind === "model.error" || event.kind === "understanding.failed")
    connection = "last_request_failed";
  events.push({ ...event, id: ++sequence, at: new Date().toISOString() });
  if (events.length > 1000) events.splice(0, events.length - 1000);
  notify();
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
    understanding:
      understandings.get(actionId) ?? queue?.result(actionId) ?? null,
  };
}
async function readObservation(actionId: string) {
  return actionId.startsWith("ax-")
    ? axObservation(await axHistory.get(actionId))
    : observation(actionId);
}
function snapshot() {
  if (dataUnavailable)
    return {
      actions: [],
      activities: [],
      events: [],
      queue: [],
      collector: { state: "stopped" },
      mode: "unavailable",
      modelRoles: modelRoles.snapshot(),
      prompts: prompts.snapshot(),
      aiConcurrency,
      routing: routing.get(),
      clearing,
      clearState,
      historyGeneration,
    };
  return {
    clearing,
    clearState,
    historyGeneration,
    actions: store.listActions(200).map((item) => {
      const record =
        understandings.get(item.action.action_id) ??
        queue.result(item.action.action_id);
      return {
        ...item,
        understanding: record
          ? {
              result: (record as any).result,
              model: (record as any).model,
              created_at: (record as any).created_at,
            }
          : null,
      };
    }),
    activities: store.listActivities(100),
    collector: {
      ...collector.status(),
      ...axRecorder?.status(),
      permissions: collector.status().permissions,
    },
    routing: routing.get(),
    events,
    mode,
    connection,
    model: modelRoles.get("main")?.model ?? null,
    hasKey: !!modelRoles.get("understanding"),
    modelRoles: modelRoles.snapshot(),
    webSearch: searchSettings.snapshot(),
    prompts: prompts.snapshot(),
    queue: queue.list(),
    aiConcurrency,
    allowedReadRoot,
    autoUnderstand,
    danmakuEnabled: danmaku?.enabled ?? true,
    dataDir: app.getPath("userData"),
  };
}
let understanding: UnderstandingService;
async function summarize(actionId: string, view: "raw" | "context") {
  const config = modelRoles.get("understanding");
  if (!config) throw new Error("understanding_model_unavailable");
  // AX 记录已包含截图，避免同一次理解读取、解析两遍完整快照。
  const axSnapshot = actionId.startsWith("ax-")
    ? await axHistory.get(actionId)
    : undefined;
  const item = axSnapshot ? axObservation(axSnapshot) : observation(actionId);
  if (item.evidence.some((e: any) => e.status === "excluded"))
    throw new Error("protected_evidence");
  if (actionId.startsWith("ax-") && item.artifacts.screenshot?.bytes) {
    const prepared = await prepareEvidence(
      join(app.getAppPath(), "dist/native/ProactiveCollector"),
      axSnapshot.screenshot,
      axSnapshot.trigger,
    );
    item.artifacts.screenshot = {
      ...item.artifacts.screenshot,
      bytes: prepared.data,
      payload: {
        content: {
          ...item.artifacts.screenshot.payload.content,
          annotated: true,
          annotationVersion: prepared.annotationVersion,
        },
      },
    };
  }
  const result = await understanding.summarize(
    {
      action: item.action as unknown as Record<string, unknown>,
      revision: item.revision,
      evidence: item.evidence,
      artifacts: item.artifacts,
      view,
    },
    config,
    prompts.snapshot().understanding,
  );
  // 常驻内存只留摘要；原始 Prompt、AX、截图与响应从 trace/队列按需加载。
  understandings.set(actionId, {
    result: result.result,
    model: result.model,
    created_at: result.created_at,
  });
  return result;
}
function admit(action: any) {
  const reason =
    action.policy_status === "excluded"
      ? "excluded_by_capture_policy"
      : ["key_down", "key_up"].includes(action.kind) &&
          action.input?.key_category !== "special"
        ? "ordinary_typing_filtered"
        : !matchesRouting(
              {
                kind: action.kind,
                key: action.input?.key_name,
                modifiers: action.input?.modifiers,
              },
              routing.get(),
            )
          ? "trigger_not_selected"
          : undefined;
  queue.enqueue(action.action_id, reason);
}
async function startRuntime(fixture: boolean) {
  runtimeReady = false;
  mode = "transitioning";
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
  const config = modelRoles.get("main");
  mainIdle = true;
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
    subagentConfig: fixture ? undefined : modelRoles.get("subagent"),
    allowedReadRoot,
    sendDanmaku: async (input) =>
      danmaku?.show(input) ?? { status: "unavailable" },
    prompts: prompts.snapshot(),
    readEvidence: async (id, kind) => {
      const item = await readObservation(id);
      if (
        item.evidence.some((e: any) => e.status === "excluded") ||
        item.artifacts.ax?.payload?.content?.nodes?.some(
          (n: any) => n.protected,
        )
      )
        return { status: "excluded", reason: "protected_evidence" };
      if (kind === "ax")
        return {
          action_id: id,
          status: item.artifacts.ax ? "available" : "unavailable",
          ...projectVisualEvidence(
            item.artifacts.ax?.payload?.content,
            item.artifacts.screenshot?.payload?.content,
            null,
          ),
        };
      const trace = await understanding.trace(id);
      if (kind === "image")
        return trace?.image
          ? {
              status: "available",
              action_id: id,
              imageBase64: trace.image,
              imageHash: trace.imageHash,
            }
          : { status: "unavailable", reason: "model_input_image_not_saved" };
      return { action_id: id, status: "unavailable", reason: "ocr_disabled" };
    },
    readObservation: async (id) => {
      const item = await readObservation(id);
      return {
        ...item,
        artifacts: Object.fromEntries(
          Object.entries(item.artifacts)
            .filter(([k]) => k !== "ocr")
            .map(([k, a]) => [
              k,
              a
                ? {
                    ...a,
                    bytes: undefined,
                    ...(k === "ax"
                      ? {
                          payload: {
                            content: projectVisualEvidence(
                              a.payload?.content,
                              item.artifacts.screenshot?.payload?.content,
                              null,
                            ),
                          },
                        }
                      : {}),
                  }
                : null,
            ]),
        ),
      };
    },
  });
  runtime.on("event", (event) => {
    if (event.kind === "agent.status" && event.sessionId === "proactive-main")
      mainIdle = event.status === "idle";
    emit({ ...event, runtimeMode: mode });
  });
  runtime.on("diagnostic", (message) =>
    emit({ kind: "runtime.diagnostic", message }),
  );
  await runtime.ready;
  runtimeReady = true;
  runtime.child.once("exit", () => {
    runtimeReady = false;
    notify();
  });
  await writeFile(marker, JSON.stringify({ mode }));
  for (const row of await runtime.request("events"))
    emit({ kind: "session.event", ...row, replayed: true, runtimeMode: mode });
  emit({ kind: "runtime.ready", mode, restored_tasks: "not_reconstructed" });
  void queue?.drain();
}
async function closeAll() {
  if (shuttingDown) return;
  await clearWork?.catch(() => {});
  shuttingDown = true;
  danmaku?.close();
  runtimeReady = false;
  understanding?.abort();
  try {
    await axRecorder?.stop();
    await axInspector?.close();
    await collector?.stop();
  } finally {
    try {
      await queue?.close();
    } finally {
      try {
        await runtime?.close();
      } finally {
        store?.close();
      }
    }
  }
}
app.on("before-quit", (event) => {
  if (!shuttingDown) {
    event.preventDefault();
    const deadline = setTimeout(() => app.exit(1), 35000);
    void closeAll()
      .catch((error) =>
        console.error(
          "shutdown_failed",
          error instanceof Error ? error.message : "unknown",
        ),
      )
      .finally(() => {
        clearTimeout(deadline);
        app.quit();
      });
  }
});
// ESM导入完成前Electron不会ready，不能在模块顶层等待whenReady。
async function bootstrap() {
  console.error("[proactive] bootstrap:ready");
  await mkdir(app.getPath("userData"), { recursive: true });
  routing = new RoutingStore(
    join(app.getPath("userData"), "observation-routing.json"),
  );
  await routing.load();
  modelRoles = new ModelRoles(
    join(app.getPath("userData"), "model-roles.json"),
    desktopCredentials,
  );
  await modelRoles.load();
  searchSettings = new SearchSettings(
    join(app.getPath("userData"), "web-search.json"),
    desktopCredentials,
  );
  await searchSettings.load();
  prompts = new PromptStore(join(app.getPath("userData"), "prompts.json"));
  await prompts.load();
  const aiSettingsPath = join(app.getPath("userData"), "ai-settings.json");
  const aiSettings = await readFile(aiSettingsPath, "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  aiConcurrency = Math.max(
    1,
    Math.min(20, Math.trunc(Number(aiSettings.concurrency)) || 10),
  );
  const cacheDir = join(app.getPath("userData"), "understanding");
  const applicationIcons = new ApplicationIcons(
    join(app.getAppPath(), "dist/native/ProactiveCollector"),
  );
  function openStores() {
    axHistory = new AXHistory(
      join(app.getPath("userData"), "ax-snapshots"),
      (path) => shell.trashItem(path),
    );
    axInspector = new AXInspectorClient(
      join(app.getAppPath(), "dist", "native", "ProactiveCollector"),
    );
    axRecorder = new AXRecorder(
      join(app.getAppPath(), "dist", "native", "ProactiveCollector"),
      axHistory,
      async (event) => {
        const result = await axInspector!.inspect(event);
        if (
          result.appLaunchedAt &&
          event.appLaunchedAt &&
          result.appLaunchedAt !== event.appLaunchedAt
        )
          return {
            error: "target_process_replaced",
            captureDiagnostics: {
              stage: "application_identity",
              reason: "target_process_replaced",
              target: event.targetWindow,
              expectedLaunch: event.appLaunchedAt,
              actualLaunch: result.appLaunchedAt,
            },
          };
        return result;
      },
      () => notify(),
      async (snapshot) => {
        const reason = snapshotRoutingReason(snapshot, routing.get());
        if (reason) {
          await axHistory.update(snapshot.snapshotId, {
            routing: { status: "not_selected", reason },
          });
          return;
        }
        const id = snapshot.snapshotId;
        await axHistory.update(id, { routing: { status: "queued" } });
        queue.enqueue(id);
      },
      3,
      {
        admitted: (event) => {
          if (!event.editingActivity && matchesRouting(event, routing.get()))
            queue.reserve(event.id);
        },
        settled: (event) => queue.finishCapture(event.id),
      },
    );
    store = new EvidenceStore(
      join(app.getPath("userData"), "observations.sqlite"),
    );
    collector = new NativeCollectorHost({
      binaryPath: join(
        app.getAppPath(),
        "dist",
        "native",
        "ProactiveCollector",
      ),
      store,
      onEvent: (event: any) => {
        if (["status", "permissions", "error"].includes(event.type))
          emit({ kind: "collector." + event.type, ...event });
        notify();
        if (event.type === "action") admit(event.action);
        else if (event.type === "artifact") void queue.drain();
      },
    });
    understanding = new UnderstandingService(
      cacheDir,
      (event) => {
        modelRoles.status.understanding =
          event.kind === "understanding.failed"
            ? "last_request_failed"
            : event.kind === "understanding.completed"
              ? "connected"
              : modelRoles.status.understanding;
        emit(event);
      },
      {
        web: new WebResearch(() => searchSettings.getKey()),
        createSession: async (input) => {
          const action = input.action as any;
          const anchor: EvidenceRow = {
            id: action.action_id,
            time: action.occurred_at,
            app: action.app ?? {},
            sequence: Number(action.source_sequence),
            session: action.capture_session_id,
            window_id: action.window?.id,
          };
          return EvidenceSession.create(
            {
              list: async () => {
                const summaries = new Map(
                  queue.list().map((row: any) => [row.actionId, row]),
                );
                // 草稿索引会持续更新，历史理解只能使用动作冻结的副本，不能读取未来修订。
                return (await axHistory.list())
                  .filter((meta) => meta.trigger?.kind !== "editing_session")
                  .map((meta) => {
                    const summary = summaries.get(meta.id) as any;
                    return {
                      id: meta.id,
                      time:
                        meta.trigger?.occurredAt ??
                        meta.capturedAt ??
                        meta.savedAt,
                      app: { name: meta.app, bundle_id: meta.bundleId },
                      sequence: meta.trigger?.sequence,
                      session: meta.trigger?.session,
                      window_id: meta.trigger?.targetWindow?.id,
                      title: summary?.actionTitle ?? undefined,
                      status: summary?.status ?? meta.captureStatus,
                    };
                  });
              },
              read: async (id) =>
                id === action.action_id
                  ? {
                      action: input.action,
                      artifacts: input.artifacts,
                      evidence: input.evidence,
                    }
                  : readObservation(id),
              result: (id) => queue.result(id),
            },
            anchor,
          );
        },
      },
    );
    queue = new ActionQueue(
      join(app.getPath("userData"), "action-queue.sqlite"),
      {
        read: readObservation,
        filter: async (id) => {
          if (id.startsWith("ax-")) {
            try {
              return snapshotRoutingReason(
                await axHistory.get(id),
                routing.get(),
              );
            } catch {
              return "record_missing";
            }
          }
          const action = store.getObservation(id)?.action;
          if (!action) return "action_missing";
          if (action.policy_status === "excluded")
            return "excluded_by_capture_policy";
          return matchesRouting(
            {
              kind: action.kind,
              key: action.input?.key_name,
              modifiers: action.input?.modifiers,
            },
            routing.get(),
          )
            ? undefined
            : "trigger_not_selected";
        },
        canUnderstand: () =>
          !clearing &&
          !!modelRoles.get("understanding") &&
          mode !== "deterministic_fixture",
        canDeliver: () =>
          !clearing &&
          mainIdle &&
          runtimeReady &&
          !!runtime &&
          mode === "gemini",
        concurrency: () => aiConcurrency,
        understand: (item) => summarize(item.action.action_id, "raw"),
        deliver: async (actionId, result) => {
          const action = (await readObservation(actionId)).action;
          return runtime!.request("observe", {
            actionId: "understood:" + actionId,
            value: {
              trajectory: buildMainPrompt({
                trajectory: [trajectoryLine(actionId, action, result.result)],
                app_info: [
                  { action_id: actionId, info: result.app_info ?? null },
                ],
              }),
            },
          });
        },
        change: notify,
        deliverBatch: async (items) => {
          const lines: string[] = [];
          for (const item of items)
            lines.push(
              trajectoryLine(
                item.actionId,
                (await readObservation(item.actionId)).action,
                item.result.result,
              ),
            );
          const batchId =
            "trajectory-" +
            createHash("sha256")
              .update(items.map((item) => item.actionId).join("|"))
              .digest("hex");
          mainIdle = false;
          // 每次只让主 Agent 处理一批，空闲后再取后续已理解轨迹。
          await runtime!.request("observe", {
            actionId: batchId,
            value: {
              trajectory: buildMainPrompt({
                trajectory: lines,
                app_info: items.map((item) => ({
                  action_id: item.actionId,
                  info: item.result.app_info ?? null,
                })),
              }),
            },
          });
          await runtime!.request("idle");
          mainIdle = true;
          return { batchId, actionIds: items.map((item) => item.actionId) };
        },
      },
    );
  }
  const historyClear = new HistoryClear(app.getPath("userData"), (path) =>
    shell.trashItem(path),
  );
  await historyClear.recoverInterrupted();
  openStores();
  const pendingTrash = await historyClear.pending();
  if (pendingTrash.length)
    clearState = {
      phase: "trash_failed",
      failed: pendingTrash,
      message: "历史已移出，但有备份尚未移入废纸篓，请重试。",
    };

  async function clearHistory(retryOnly = false) {
    clearing = true;
    const update = (value: any) => {
      clearState = value;
      notify();
    };
    let snapshots = clearState.snapshots ?? 0;
    try {
      if (!retryOnly) {
        update({
          phase: "stopping",
          message: "正在停止采集与 Agent，等待在途处理结束…",
        });
        queue.pause();
        runtimeReady = false;
        understanding.abort();
        await axRecorder!.stop();
        await axInspector!.close();
        // 等待之前的手动采集、模型配置和理解请求退出，禁止晚到写入重建旧目录。
        await Promise.allSettled([...operations]);
        await understanding.close();
        await collector.stop();
        await runtime?.close();
        runtime = undefined;
        await pruneWork;
        dataUnavailable = true;
        await queue.close();
        store.close();
        const stage = await historyClear.stage((completed, total) =>
          update({
            phase: "moving",
            completed,
            total,
            message: `正在整批移出本地历史：${completed}/${total} 个数据项…`,
          }),
        );
        snapshots = stage.snapshots;
        events.length = 0;
        understandings.clear();
        sequence = 0;
        historyGeneration++;
        mode = "unavailable";
        autoUnderstand = false;
        danmaku?.clear();
        openStores();
        dataUnavailable = false;
      }
      update({
        phase: "trashing",
        snapshots,
        message: "本地历史已清空，正在把整批备份移到废纸篓…",
      });
      const result = await historyClear.finish();
      update({
        ...result,
        snapshots,
        phase: result.failed.length ? "trash_failed" : "complete",
        message: result.failed.length
          ? `历史已清空，但 ${result.failed.length} 批备份移入废纸篓失败；可重试，不会删除新记录。`
          : `已清空全部本地历史（含 ${snapshots} 条 AX 快照），旧数据已移到废纸篓。`,
      });
    } catch (error) {
      update({
        phase: "failed",
        message: `清理未完成：${error instanceof Error ? error.message : "unknown"}。数据保留，请勿手动删除恢复目录。`,
      });
    } finally {
      clearing = false;
      notify();
    }
    return clearState;
  }
  // 从本应用SQLite原始action账本重建缺失队列项，不受UI最近200条限制。
  const ledger = new DatabaseSync(
    join(app.getPath("userData"), "observations.sqlite"),
    { readOnly: true },
  );
  for (const row of ledger
    .prepare("SELECT metadata FROM actions ORDER BY rowid")
    .all())
    admit(JSON.parse(String(row.metadata)));
  ledger.close();
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
  let pruneWork: Promise<void> = Promise.resolve();
  const queueTick = setInterval(() => {
    if (!clearing && !dataUnavailable) void queue.drain();
  }, 1000);
  queueTick.unref();
  const cleanup = setInterval(() => {
    if (clearing || dataUnavailable) return;
    store.prune();
    pruneWork = pruneCache().catch(() => {});
  }, 60_000);
  cleanup.unref();
  const invoke = async (method: string, p: any = {}) => {
    switch (method) {
      case "danmaku.preview": {
        const result = await danmaku?.show({
          text: "你好，我是 Proactive Agent。这是一条桌面弹幕测试。",
        });
        if (result?.status !== "shown")
          throw new Error(`danmaku_${result?.status ?? "unavailable"}`);
        return result;
      }
      case "danmaku.enabled":
        if (typeof p.enabled !== "boolean") throw new Error("invalid_enabled");
        danmaku?.setEnabled(p.enabled);
        return snapshot();
      case "danmaku.clear":
        danmaku?.clear();
        return { status: "cleared" };
      case "snapshot":
        return snapshot();
      case "routing.update":
        await routing.update(p.triggers);
        void queue.drain();
        return snapshot();
      case "app.icon":
        return applicationIcons.get(String(p.bundleId ?? ""));
      case "ax.apps":
      case "ax.inspect": {
        const pid = Number(p.pid);
        if (method === "ax.inspect" && (!Number.isInteger(pid) || pid <= 0))
          throw new Error("invalid_app_pid");
        const args =
          method === "ax.apps"
            ? ["--inspect-apps"]
            : ["--inspect", String(pid)];
        // 只返回到观测台，不保存到动作账本，不触发任何模型请求。
        const { stdout } = await promisify(execFile)(
          join(app.getAppPath(), "dist", "native", "ProactiveCollector"),
          args,
          { timeout: 15000, maxBuffer: 24 * 1024 * 1024 },
        );
        const result = JSON.parse(stdout);
        if (method !== "ax.inspect") return result;
        const saved = await axHistory.save({
          ...result,
          error: undefined,
          nodes: result.nodes ?? [],
          pid,
          app: result.app ?? `应用 PID ${pid}`,
          captureError: result.error,
          captureStatus: result.error ? "failed" : "captured",
        });
        if (result.error) {
          const failure = captureDiagnostic(result);
          throw new Error(
            `${failure.message} 阶段=${failure.stage}，原因=${failure.reason}，记录=${saved.snapshotId}`,
          );
        }
        return saved;
      }
      case "ax.history":
        return axHistory.list();
      case "ax.analysis":
        return queue.result(String(p.id));
      case "ai.trace": {
        const trace = await understanding.trace(String(p.id));
        return trace
          ? { ...trace, delivery: queue.deliveryTrace(String(p.id)) }
          : null;
      }
      case "prompts.update":
        await prompts.update(p.role as PromptRole, p.value);
        if (p.role !== "understanding" && runtime)
          await startRuntime(mode !== "gemini");
        return { prompts: prompts.snapshot() };
      case "ai.concurrency":
        if (!Number.isInteger(p.value) || p.value < 1 || p.value > 20)
          throw new Error("invalid_concurrency");
        aiConcurrency = p.value;
        await writeFile(
          aiSettingsPath,
          JSON.stringify({ concurrency: aiConcurrency }),
          { mode: 0o600 },
        );
        void queue.drain();
        return { aiConcurrency };
      case "ax.record.status":
        return axRecorder!.status();
      case "ax.record.start":
        await axInspector!.start();
        return axRecorder!.start();
      case "ax.record.stop": {
        const status = await axRecorder!.stop();
        await axInspector!.close();
        return status;
      }
      case "ax.load":
        return axHistory.get(String(p.id));
      case "ax.copy": {
        const item = await axHistory.get(String(p.id));
        await clipboard.writeText(
          `Action ID：${item.snapshotId}\n本地文件：${item.file}`,
        );
        return { copied: true };
      }
      case "ax.copyImage": {
        const data = p.dataUrl;
        if (
          typeof data !== "string" ||
          data.length > 32 * 1024 * 1024 ||
          !data.startsWith("data:image/png;base64,")
        )
          throw new Error("invalid_image");
        const image = nativeImage.createFromDataURL(data);
        if (image.isEmpty()) throw new Error("empty_image");
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(image.toPNG())], {
              type: "image/png",
            }),
          }),
        ]);
        return {
          copied: true,
          width: image.getSize().width,
          height: image.getSize().height,
        };
      }
      case "ax.delete":
        if (
          axRecorder!.status().state === "running" ||
          axRecorder!.status().pending
        )
          throw new Error("stop_recording_before_delete");
        await axHistory.remove(String(p.id));
        return { deleted: true };
      case "observation":
        return observation(String(p.actionId));
      case "permissions":
        await collector.checkPermissions();
        return collector.status();
      case "permission.request":
        return collector.requestPermission(String(p.permission));
      case "capture.start": {
        if (!runtime && modelRoles.get("main")) await startRuntime(false);
        const allowedBundleIds = String(p.bundleIds ?? "")
          .split(/[\s,]+/)
          .filter(Boolean);
        const allApps = p.allApps === true;
        if (!allApps && !allowedBundleIds.length)
          throw new Error("allowlist_required");
        await axInspector!.start();
        await axRecorder!.start({ allowedBundleIds, allApps });
        return snapshot();
      }
      case "capture.stop":
        await axRecorder!.stop();
        await axInspector!.close();
        return snapshot();
      case "config": {
        const role = p.role as ModelRole;
        await modelRoles.update(role, p.config ?? {});
        if (role === "main" || role === "subagent") {
          if (modelRoles.get("main")) await startRuntime(false);
          else {
            await runtime?.close();
            runtime = undefined;
            mode = "unavailable";
          }
        }
        if (role === "understanding" && mode === "deterministic_fixture") {
          await runtime?.close();
          runtime = undefined;
          mode = "unavailable";
          if (modelRoles.get("main")) await startRuntime(false);
        }
        void queue.drain();
        return { modelRoles: modelRoles.snapshot(), mode };
      }
      case "model.test": {
        const role = p.role as ModelRole;
        if (!["understanding", "main", "subagent"].includes(role))
          throw new Error("invalid_model_role");
        const config = modelRoles.get(role);
        const result = await testModelConnection(config);
        // 配置已变更时不让旧请求覆盖新配置状态。
        if (JSON.stringify(config) === JSON.stringify(modelRoles.get(role))) {
          modelRoles.status[role] = result.ok
            ? "connected"
            : config
              ? "last_request_failed"
              : "unavailable";
          notify();
        }
        return result;
      }
      case "web.config":
        return searchSettings.update(p.apiKey);
      case "web.status":
        return searchSettings.snapshot();
      case "retry":
        queue.retry(String(p.actionId));
        return { queue: queue.list() };
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
        if (!runtime && modelRoles.get("main")) await startRuntime(false);
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
        return {
          autoUnderstand: true,
          reason: "each_eligible_action_is_queued",
        };
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
  };
  ipcMain.handle(
    "proactive:invoke",
    async (event, method: string, p: any = {}) => {
      if (event.sender !== window?.webContents)
        throw new Error("sender_not_allowed");
      if (method === "snapshot") return snapshot();
      if (method === "records.list") {
        const generation = historyGeneration;
        const records =
          clearing || dataUnavailable ? [] : await axHistory.list();
        return { generation, records };
      }
      if (method === "ax.history" && (clearing || dataUnavailable)) return [];
      if (clearing) throw new Error("history_clear_in_progress");
      if (method === "records.retryTrash") {
        if (dataUnavailable || clearState.phase !== "trash_failed")
          throw new Error("no_pending_trash_retry");
        clearWork = clearHistory(true).finally(() => {
          clearWork = undefined;
        });
        return { started: true };
      }
      if (method === "ax.clear" || method === "records.clear") {
        if (dataUnavailable)
          throw new Error("history_recovery_restart_required");
        // 清空确认绑定主窗口；确认期间也锁住修改，避免重复点击与启动采集。
        clearing = true;
        notify();
        const choice = await dialog
          .showMessageBox(window!, {
            type: "warning",
            buttons: ["取消", "清空全部并移到废纸篓"],
            defaultId: 0,
            cancelId: 0,
            message: "清空全部本地历史？",
            detail:
              "将停止采集和 Agent，清空所有截图、AX、旧观察流水、理解结果、待处理队列和 Agent 会话。保留模型配置与权限设置。旧数据移到废纸篓，可恢复。",
          })
          .catch((error) => {
            clearing = false;
            notify();
            throw error;
          });
        if (choice.response !== 1) {
          clearing = false;
          notify();
          return { cancelled: true };
        }
        clearWork = clearHistory().finally(() => {
          clearWork = undefined;
        });
        return { started: true };
      }
      if (dataUnavailable) throw new Error("history_recovery_restart_required");
      const operation = invoke(method, p);
      operations.add(operation);
      try {
        return await operation;
      } finally {
        operations.delete(operation);
      }
    },
  );
  danmaku = new DesktopDanmaku();
  window = new BrowserWindow({
    // 自动验收可隐藏测试窗口，默认启动仍正常显示。
    show: process.env.PROACTIVE_QA_HIDDEN !== "1",
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    title: "Proactive Agent",
    backgroundColor: "#f5f5f2",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("blur", () => {
    if (!window?.webContents.isDestroyed())
      window?.webContents.send("proactive:window-blur");
  });
  // 隐藏的弹幕窗口不能阻止关闭主窗口后正常退出。
  window.on("closed", () => {
    danmaku?.close();
    app.quit();
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  // 从系统设置返回后重新读取采集器权限，合并重复聚焦事件。
  let checkingPermissions = false;
  const refreshPermissions = async () => {
    if (shuttingDown || checkingPermissions || window?.isDestroyed()) return;
    checkingPermissions = true;
    try {
      await collector.checkPermissions();
    } catch {
      if (!shuttingDown) emit({ kind: "collector.permission_check_failed" });
    } finally {
      checkingPermissions = false;
    }
  };
  window.on("focus", () => void refreshPermissions());
  await window.loadFile(
    join(app.getAppPath(), "dist", "renderer", "index.html"),
  );
  await refreshPermissions();
  console.error("[proactive] bootstrap:window-loaded");
  // 恢复加密凭证后也恢复主 Agent 投递能力，避免重启后只有理解队列在工作。
  if (!runtime && modelRoles.get("main"))
    await startRuntime(false).catch(() => {
      emit({
        kind: "runtime.start_failed",
        message:
          "主 Agent 启动失败，请检查模型设置后重新保存；本地记录仍保留。",
      });
    });
}
app.on("window-all-closed", () => app.quit());
if (ownsDataDirectory)
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
