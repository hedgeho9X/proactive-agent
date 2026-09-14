/** 将原始 AX 投影为少量文字线索；输入框正文独立保留，原始历史不变。 */

/** 将未知证据收窄为对象。 */
function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

/** 只接受非空文字，不将数字或控件结构转换成提示词。 */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 提取原始节点的文字属性。 */
function attribute(node: Record<string, any>, name: string) {
  return text(node.attributes?.[name]?.value?.text);
}

/** 区域证据独立于节点文字；失效矩形不参与定位。 */
function region(value: unknown) {
  const source = object(value);
  if (!Object.keys(source).length) return null;
  return {
    status: source.status,
    reason: source.reason,
    node_id: source.nodeId,
    sampled_at: source.sampledAt,
    rect: source.status === "available" ? source.rect : undefined,
  };
}

/** 仅向模型提供去重的 title/description，草稿与必要区域作为独立证据。 */
export function projectVisualEvidence(
  axTree: unknown,
  screenshot: unknown,
  focusTitle: unknown,
) {
  const ax = object(axTree),
    image = object(screenshot);
  const raw = new Map<string, Record<string, any>>();
  for (const value of Array.isArray(ax.raw_nodes) ? ax.raw_nodes : []) {
    const node = object(value);
    if (typeof node.id === "string") raw.set(node.id, node);
  }
  const nodes = (Array.isArray(ax.nodes) ? ax.nodes : [])
    .map(object)
    .filter(
      (node) => !node.protected && !raw.get(String(node.node_id))?.protected,
    );
  const compact = (items: Record<string, any>[]) => {
    const unique = new Map<string, { title?: string; description?: string }>();
    for (const node of items) {
      const original = raw.get(String(node.node_id)) ?? {};
      const title = text(node.title) ?? attribute(original, "AXTitle");
      const description =
        text(node.description) ?? attribute(original, "AXDescription");
      if (!title && !description) continue;
      const value = {
        ...(title ? { title } : {}),
        ...(description && description !== title ? { description } : {}),
      };
      unique.set(JSON.stringify(value), value);
    }
    return [...unique.values()];
  };
  const focused = nodes.filter((node) => node.focused === true);
  const sourceDraft = object(ax.editing_evidence);
  const draft =
    typeof sourceDraft.text === "string" && !sourceDraft.protected
      ? {
          id: sourceDraft.id,
          revision: sourceDraft.revision,
          observedAt: sourceDraft.observedAt,
          text: sourceDraft.text,
          selection: sourceDraft.selection,
          source: sourceDraft.source,
          completeness: sourceDraft.completeness,
          association: sourceDraft.association,
        }
      : undefined;
  const input = focused.find(
    (node) =>
      ["AXTextArea", "AXTextField", "AXComboBox"].includes(node.role) &&
      typeof node.value === "string",
  );
  const regions = object(image.regions ?? ax.regions);
  return {
    clickedElement: {
      nodes: compact(nodes.filter((node) => node.clicked === true)),
      region: region(regions.click),
    },
    focusedElement: {
      nodes: compact(focused),
      title_hint: text(focusTitle),
      region: region(regions.focus),
      selection: region(regions.selection),
      prior_editing_observation: draft,
      current_input:
        input && input.value !== draft?.text
          ? {
              text: input.value,
              source: "AXValue",
              completeness: "application_exposed",
            }
          : undefined,
    },
    axContext: { nodes: compact(nodes) },
    screenshotMetadata: {
      frame: image.frame,
      pixel_width: image.pixelWidth,
      pixel_height: image.pixelHeight,
      timing: image.timing,
      captured_at: image.capturedAt,
      annotated: image.annotated,
      annotation_version: image.annotationVersion,
      coordinate_space: image.coordinateSpace,
      shadows_excluded: image.shadowsExcluded,
    },
  };
}
