/** 将已保存快照适配为模型证据；保留来源，不重新采集或改变窗口身份。 */
import { createHash } from "node:crypto";
import { filterAX } from "./filter.ts";
/** 构建动作和证据视图，保护标记优先于模型可见内容。 */
export function axObservation(snapshot: any) {
  const event = snapshot.trigger ?? {};
  const id = snapshot.snapshotId;
  const at = snapshot.capturedAt ?? event.occurredAt ?? snapshot.savedAt;
  const protectedEvidence =
    snapshot.readingContext?.status === "excluded" ||
    snapshot.screenshot?.status === "excluded" ||
    snapshot.nodes?.some((node: any) => node.protected);
  const text = (node: any, name: string) =>
    node.attributes?.[name]?.value?.text;
  const nodes = (snapshot.nodes ?? []).map((node: any) => ({
    node_id: node.id,
    parent_id: node.parent ?? null,
    role: text(node, "AXRole"),
    title: text(node, "AXTitle"),
    value: text(node, "AXValue"),
    description: text(node, "AXDescription"),
    focused: node.id === snapshot.focusId,
    clicked: node.id === snapshot.clickedId,
    protected: !!node.protected,
  }));
  const filtered = filterAX(nodes);
  const artifact = (kind: string, content: any, bytes?: string) => ({
    id: `${id}:${kind}`,
    kind,
    captured: Date.parse(at),
    hash: createHash("sha256")
      .update(bytes ?? JSON.stringify(content))
      .digest("hex"),
    payload: { content },
    bytes,
  });
  return {
    action: {
      schema_version: "1",
      action_id: id,
      capture_session_id: event.session ?? "ax",
      collector_epoch: event.session ?? "ax",
      source_sequence: String(event.sequence ?? 0),
      occurred_at: event.occurredAt ?? at,
      received_at: snapshot.savedAt ?? at,
      monotonic_ns: event.monotonicNs ?? "0",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      kind: event.kind ?? "manual_snapshot",
      actor: "unknown",
      origin: "native_observation",
      trust_class: "untrusted_observation",
      app: {
        pid: snapshot.pid,
        bundle_id: snapshot.bundleId,
        name: snapshot.app,
      },
      window: {
        id: snapshot.windowId,
        target: event.targetWindow,
        captureDiagnostics: snapshot.captureDiagnostics,
      },
      input: {
        key_name: event.key,
        key_category: "special",
        modifiers: event.modifiers ?? [],
        button: event.button,
        x: event.x,
        y: event.y,
      },
      policy_status: protectedEvidence ? "excluded" : "allowed",
      reason_codes: [],
    },
    activity_id: id,
    revision: 1,
    evidence: [
      {
        kind: "ax",
        slot: "ax",
        status: protectedEvidence
          ? "excluded"
          : nodes.length ||
              snapshot.editingEvidence ||
              snapshot.readingContext?.selectedText ||
              snapshot.readingContext?.context
            ? "captured"
            : "unavailable",
        reason: nodes.length ? null : "ax_unavailable",
      },
      {
        kind: "screenshot",
        slot: "screenshot",
        status: protectedEvidence
          ? "excluded"
          : snapshot.screenshot?.data
            ? "captured"
            : "unavailable",
        reason: snapshot.screenshot?.data
          ? null
          : (snapshot.screenshot?.reason ?? "screenshot_unavailable"),
      },
      {
        kind: "ocr",
        slot: "ocr",
        status: "unavailable",
        reason: "ocr_not_collected",
      },
      {
        kind: "screenshot",
        slot: "screenshot_before",
        status: "unavailable",
        reason: "before_frame_not_collected",
      },
    ],
    artifacts: {
      ax:
        !protectedEvidence &&
        (nodes.length ||
          snapshot.editingEvidence ||
          snapshot.readingContext?.selectedText ||
          snapshot.readingContext?.context)
          ? artifact("ax", {
              nodes: filtered.normalized,
              raw_nodes: snapshot.nodes,
              focus_title:
                text(
                  (snapshot.nodes ?? []).find(
                    (node: any) => node.id === snapshot.focusId,
                  ) ?? {},
                  "AXTitle",
                ) ?? null,
              focus_title_reliability: "辅助线索，可能过时或指错控件",
              context: filtered,
              editing_evidence: snapshot.editingEvidence ?? null,
              reading_context: snapshot.readingContext ?? null,
              coverage: {
                partial: !!snapshot.partial,
                timing: snapshot.timing,
                diagnostics: snapshot.captureDiagnostics,
              },
              regions: snapshot.screenshot?.regions,
            })
          : null,
      screenshot:
        !protectedEvidence && snapshot.screenshot?.data
          ? artifact(
              "screenshot",
              {
                frame: snapshot.screenshot.frame,
                regions: snapshot.screenshot.regions,
                coordinateSpace: snapshot.screenshot.coordinateSpace,
                pixelWidth: snapshot.screenshot.pixelWidth,
                pixelHeight: snapshot.screenshot.pixelHeight,
                shadowsExcluded: snapshot.screenshot.shadowsExcluded,
                capturedAt: snapshot.screenshot.capturedAt,
                timing: snapshot.timing,
              },
              snapshot.screenshot.data,
            )
          : null,
      ocr: null,
      screenshot_before: null,
    },
  };
}
