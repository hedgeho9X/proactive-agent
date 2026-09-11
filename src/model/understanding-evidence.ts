/** 提取模型需要的控件和文字证据；不改变原始 AX、截图或事件存储。 */

/** 将未知证据收窄为可读取的对象，忽略数组和空值。 */
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 提取原始 AX 的可读字符串属性，不携带属性列表、坐标或系统错误堆栈。 */
function attribute(node: Record<string, unknown>, key: string): unknown {
  const value = object(object(object(node.attributes)[key]).value).text;
  return typeof value === "string" ? value : undefined;
}

/** 保留区域可用性和采样来源；不可用区域的矩形不作为定位证据。 */
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

/** 生成独立的点击、焦点、AX 文本与截图元数据；完整原始节点由详情按需读取。 */
export function projectVisualEvidence(
  axTree: unknown,
  screenshot: unknown,
  focusTitle: unknown,
) {
  const ax = object(axTree),
    image = object(screenshot);
  const raw = new Map<string, Record<string, unknown>>();
  if (Array.isArray(ax.raw_nodes))
    for (const value of ax.raw_nodes) {
      const node = object(value);
      if (typeof node.id === "string") raw.set(node.id, node);
    }
  const nodes = (Array.isArray(ax.nodes) ? ax.nodes : [])
    .map(object)
    .filter(
      (node) => !node.protected && !raw.get(String(node.node_id))?.protected,
    )
    .map((node) => {
      const original = raw.get(String(node.node_id)) ?? {};
      return {
        node_id: node.node_id,
        parent_id: node.parent_id,
        role: node.role,
        title: node.title,
        value: node.value,
        description: node.description,
        url: node.url ?? attribute(original, "AXURL"),
        document: node.document ?? attribute(original, "AXDocument"),
        focused: node.focused,
        clicked: node.clicked,
        visible: node.visible,
      };
    });
  const regions = object(image.regions ?? ax.regions);
  return {
    clickedElement: {
      nodes: nodes.filter((node) => node.clicked === true),
      region: region(regions.click),
    },
    focusedElement: {
      nodes: nodes.filter((node) => node.focused === true),
      title_hint: focusTitle,
      region: region(regions.focus),
      selection: region(regions.selection),
    },
    axContext: { nodes, url: ax.url, title: ax.title, coverage: ax.coverage },
    screenshotMetadata: {
      frame: image.frame,
      timing: image.timing,
      captured_at: image.capturedAt,
      annotated: image.annotated,
      annotation_version: image.annotationVersion,
      coordinate_space: image.coordinateSpace,
      shadows_excluded: image.shadowsExcluded,
    },
  };
}
