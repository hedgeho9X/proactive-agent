import type { AXNode } from "./types.ts";
export const FILTER_VERSION = "context-v1";
// 内容保护先于上下文选择，目标及其祖先始终优先保留。
export function filterAX(nodes: AXNode[], targetId?: string) {
  const protectedNodes = new Set(
    nodes.filter((n) => n.protected).map((n) => n.node_id),
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of nodes)
      if (
        !protectedNodes.has(node.node_id) &&
        node.parent_id &&
        protectedNodes.has(node.parent_id)
      ) {
        protectedNodes.add(node.node_id);
        expanded = true;
      }
  }
  const normalized = nodes.map((n) =>
    protectedNodes.has(n.node_id)
      ? {
          ...n,
          title: undefined,
          value: undefined,
          description: undefined,
          protected: true,
        }
      : { ...n },
  );
  const keep = new Set(
    normalized
      .filter(
        (n) =>
          n.node_id === targetId ||
          n.focused ||
          n.clicked ||
          n.changed ||
          (n.visible !== false && (!!n.value || n.role === "AXStaticText")),
      )
      .map((n) => n.node_id),
  );
  const byId = new Map(normalized.map((n) => [n.node_id, n]));
  for (const id of [...keep]) {
    let parent = byId.get(id)?.parent_id;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      keep.add(parent);
      parent = byId.get(parent)?.parent_id;
    }
  }
  return {
    policy_version: FILTER_VERSION,
    normalized,
    context: normalized.filter((n) => keep.has(n.node_id)),
    input_count: nodes.length,
    output_count: keep.size,
    reasons: {
      protected: protectedNodes.size,
      unrelated_chrome: nodes.length - keep.size,
    },
  };
}
