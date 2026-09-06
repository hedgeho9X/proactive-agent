// 节点编号只在一次快照内有效；跨快照按路径和角色做候选匹配，变化需人工确认。
export function attributeText(node: any, name: string): string {
  const value = node.attributes?.[name]?.value;
  return typeof value === "string"
    ? value
    : (value?.text ?? (typeof value === "number" ? String(value) : ""));
}
export function diffAX(before: any, after: any) {
  if (
    !before ||
    !after ||
    before.pid !== after.pid ||
    before.bundleId !== after.bundleId
  )
    return [];
  const key = (node: any) => `${node.path}:${attributeText(node, "AXRole")}`;
  const old = new Map<string, any>(
    before.nodes.map((node: any) => [key(node), node]),
  );
  const changes: any[] = [];
  // Swift 字典键序不稳定，比较前排序；关系引用使用临时编号，不作值变化依据。
  const canonical = (value: any): string => {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
          .join(",") +
        "}"
      );
    return JSON.stringify(value) ?? "undefined";
  };
  for (const node of after.nodes) {
    const previous = old.get(key(node));
    old.delete(key(node));
    if (!previous) {
      changes.push({ node: node.id, kind: "新增或匹配失败", path: node.path });
      continue;
    }
    for (const name of new Set([
      ...Object.keys(previous.attributes),
      ...Object.keys(node.attributes),
    ])) {
      // 节点关系包含临时编号，不作为属性值差异比较。
      if (
        ["AXChildren", "AXParent", "AXWindow", "AXTopLevelUIElement"].includes(
          name,
        )
      )
        continue;
      const left = previous.attributes[name];
      const right = node.attributes[name];
      if (
        JSON.stringify(left)?.includes('"nodeRef"') ||
        JSON.stringify(right)?.includes('"nodeRef"')
      )
        continue;
      if (canonical(left) !== canonical(right))
        changes.push({
          node: node.id,
          kind: "属性变化（候选）",
          attribute: name,
          before: left,
          after: right,
        });
    }
  }
  for (const node of old.values())
    changes.push({ node: node.id, kind: "消失或未采到", path: node.path });
  return changes;
}
