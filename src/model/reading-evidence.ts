/** 为模型选择阅读证据；保留来源与时序，不把片段或离屏内容当作完整可见回复。 */

/** 只读取对象字段，避免将缺失或异常数据转换成正文。 */
function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

/** 规范化已采集正文，删除重复片段正文和无关诊断；不截断实际文本。 */
function passage(value: unknown) {
  const item = object(value);
  if (
    typeof item.text !== "string" ||
    !item.text.length ||
    item.protected ||
    item.status === "excluded"
  )
    return undefined;
  return {
    text: item.text,
    source: item.source,
    scope: item.scope,
    status: item.status,
    nodeId: item.nodeId,
    range: item.range,
    sampledAt: item.sampledAt,
    truncated: item.truncated,
    reason: item.reason,
    visibility: item.visibility,
    anchor: item.anchor,
    selectionRelation: item.selectionRelation,
    association: item.association,
    fragments: Array.isArray(item.fragments)
      ? item.fragments.map((part: unknown) => {
          const fragment = object(part);
          return {
            nodeId: fragment.nodeId,
            source: fragment.source,
            start: fragment.start,
            length: fragment.length,
            unit: fragment.unit,
            range: fragment.range,
          };
        })
      : undefined,
  };
}

/** 新取证优先；旧快照仅从焦点或其祖先恢复真实 AXSelectedText，不捏造周边正文。 */
export function readingEvidence(axTree: unknown, screenshot: unknown) {
  const ax = object(axTree),
    image = object(screenshot),
    reading = object(ax.reading_context);
  if (["excluded", "discarded"].includes(reading.status))
    return { status: reading.status, reason: reading.reason };
  if (reading.discarded === true)
    return { status: "unavailable", discarded: true, reason: reading.reason };
  if (
    ax.coverage?.diagnostics?.warnings?.includes("ax_window_mismatch_discarded")
  )
    return { status: "unavailable", reason: "ax_window_mismatch" };
  const nativeSelection = passage(reading.selectedText),
    context = passage(reading.context);
  if (nativeSelection || context)
    return {
      status: reading.status ?? "available",
      selectedText: nativeSelection,
      context,
      reason: reading.reason,
      timing: reading.timing,
      sampledAt: reading.sampledAt,
      completedAt: reading.completedAt,
      nonAtomic: reading.nonAtomic,
      selectionAnchor: reading.selectionAnchor,
      association: reading.association,
    };
  const raw = new Map<string, Record<string, any>>();
  for (const candidate of Array.isArray(ax.raw_nodes) ? ax.raw_nodes : []) {
    const node = object(candidate);
    if (typeof node.id === "string") raw.set(node.id, node);
  }
  const focused = (Array.isArray(ax.nodes) ? ax.nodes : [])
    .map(object)
    .filter((node) => node.focused === true && !node.protected);
  for (const focus of focused) {
    let id: string | undefined = focus.node_id;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const node: Record<string, any> | undefined = raw.get(id);
      if (!node || node.protected) break;
      const selected = object(node.attributes?.AXSelectedText);
      const selectedValue = object(selected.value);
      if (
        selected.status === "ok" &&
        typeof selectedValue.text === "string" &&
        selectedValue.text.length
      ) {
        const range = node.attributes?.AXSelectedTextRange;
        if (range?.status === "ok" && range.value?.length === 0) {
          break;
        }
        const selectionRegion = image.regions?.selection;
        const probe =
          node.source === "screenshot_region_probe" ||
          node.path?.startsWith("screenshot-");
        const probeAt =
          selectionRegion?.nodeId === id
            ? selectionRegion.sampledAt
            : image.regions?.focus?.nodeId === id
              ? image.regions.focus.sampledAt
              : undefined;
        return {
          status: "partial",
          selectedText: {
            text: selectedValue.text,
            source: "AXSelectedText",
            nodeId: id,
            range: range?.status === "ok" ? range.value : undefined,
            truncated: selectedValue.truncated,
            capturedBetween: probe
              ? undefined
              : {
                  from: ax.coverage?.timing?.axStartedAt,
                  to: ax.coverage?.timing?.axCompletedAt,
                },
            sampledAt: probe ? probeAt : undefined,
            timeBasis: probe
              ? "screenshot_region_probe"
              : "ax_traversal_interval",
            imageAlignment:
              selectionRegion?.status === "available"
                ? "not_atomic"
                : "not_verified",
            alignmentReason: selectionRegion?.reason,
          },
          reason: "related_context_not_captured",
        };
      }
      id = typeof node.parent === "string" ? node.parent : undefined;
    }
  }
  return {
    status: reading.status ?? "unavailable",
    reason: reading.reason ?? "reading_context_not_captured",
  };
}
