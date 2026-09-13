/** 编辑会话保存连续 AX 观察并提供不可变动作证据；不截图或调用模型。 */
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { AXHistory } from "./ax-history.ts";

/** 一个焦点会话只占一条草稿索引，修订证据追加保存，正文不进入元数据。 */
export class EditingSessions {
  private current = new Map<string, any>();
  private writes = new Map<string, Promise<void>>();
  constructor(
    private history: AXHistory,
    private changed: () => void,
  ) {}

  /** 在首次 await 前更新内存状态，后续动作能冻结按源顺序已收到的 AX 文本。 */
  accept(event: any): Promise<void> {
    if (
      !/^ax-[0-9a-f-]{36}$/.test(event.id) ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 1
    )
      return Promise.reject(new Error("invalid_editing_event"));
    const previous = this.current.get(event.id);
    if (
      previous &&
      (previous.session !== event.session ||
        previous.pid !== event.pid ||
        event.revision <= previous.revision)
    )
      return Promise.resolve();
    if (event.kind === "editing_closed" && !previous) return Promise.resolve();
    if (
      event.kind === "editing_update" &&
      (typeof event.editing?.text !== "string" ||
        event.editing?.source !== "AXValue")
    )
      return Promise.reject(new Error("invalid_editing_value"));
    const state = {
      ...previous,
      id: event.id,
      session: event.session,
      pid: event.pid,
      app: event.app,
      bundleId: event.bundleId,
      revision: event.revision,
      observedAt: event.occurredAt,
      firstObservedAt: previous?.firstObservedAt ?? event.occurredAt,
      ...(event.editing ?? {}),
      state: event.kind === "editing_closed" ? "closed" : "editing",
      reason: event.reason,
    };
    this.current.set(event.id, state);
    const save = async () => {
      const trigger = {
        kind: "editing_session",
        occurredAt: state.firstObservedAt,
        session: state.session,
        pid: state.pid,
        app: state.app,
        bundleId: state.bundleId,
      };
      const snapshot = {
        app: state.app,
        bundleId: state.bundleId,
        pid: state.pid,
        capturedAt: state.observedAt,
        trigger,
        captureStatus: state.state === "closed" ? "editing_closed" : "editing",
        editing: state,
        nodes: [
          {
            id: "editor",
            protected: false,
            attributes: {
              AXRole: { status: "ok", value: { text: state.role } },
              AXValue: { status: "ok", value: { text: state.text } },
              AXSelectedTextRange: {
                status: state.selection?.status ?? "unavailable",
                value: state.selection,
              },
            },
          },
        ],
        focusId: "editor",
        partial: true,
        screenshot: { status: "unavailable", reason: "editing_state_only" },
      };
      if (previous) await this.history.update(event.id, snapshot);
      else await this.history.save(snapshot, event.id);
      await appendFile(
        join(this.history.root, event.id, "editing-revisions.jsonl"),
        JSON.stringify(state) + "\n",
        { mode: 0o600 },
      );
      this.changed();
    };
    const work = (this.writes.get(event.id) ?? Promise.resolve()).then(save);
    this.writes.set(event.id, work);
    void work
      .finally(() => {
        if (this.writes.get(event.id) === work) this.writes.delete(event.id);
      })
      .catch(() => {});
    // 已结束会话不再给新动作挂接，已冻结副本不受影响。
    if (state.state === "closed") this.current.delete(event.id);
    return work;
  }

  /** 仅同一监听会话、目标进程和原始时间之前的状态可挂接。 */
  evidence(event: any) {
    const state = this.current.get(event.editingSessionId);
    return state &&
      state.pid === event.pid &&
      state.session === event.session &&
      Date.parse(state.observedAt) <= Date.parse(event.occurredAt)
      ? {
          ...structuredClone(state),
          association: "focused_editor_before_event_not_click_target",
        }
      : null;
  }

  /** 监听退出切断内存关联，原始修订保留供诊断。 */
  async close() {
    await Promise.allSettled(this.writes.values());
    this.current.clear();
  }
}
