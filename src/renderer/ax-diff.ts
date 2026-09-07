export function attributeText(node: any, name: string): string {
  const value = node.attributes?.[name]?.value;
  return typeof value === "string"
    ? value
    : (value?.text ?? (typeof value === "number" ? String(value) : ""));
}
export function canonicalAX(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalAX).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalAX(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "undefined";
}
export function comparisonIssue(before: any, after: any): string | null {
  if (!before || !after) return "选择两份快照后对比";
  if (
    before.alignment?.sameWindow === false ||
    after.alignment?.sameWindow === false
  )
    return "AX 树与截图来自不同窗口，不能作可靠的图树对比";
  if (before.pid !== after.pid || before.bundleId !== after.bundleId)
    return "两份快照不属于同一应用进程，不能对比";
  if (
    before.appLaunchedAt &&
    after.appLaunchedAt &&
    before.appLaunchedAt !== after.appLaunchedAt
  )
    return "应用已重启，不能按同一控件对比";
  if (before.windowId && after.windowId && before.windowId !== after.windowId)
    return "两份快照属于不同窗口，不能对比";
  if (
    before.axRootScope &&
    after.axRootScope &&
    before.axRootScope !== after.axRootScope
  )
    return "两份 AX 的采集范围不同（应用树与窗口树），不能按同一棵树对比";
  if (
    [before, after].some(
      (s) => s.captureStatus && s.captureStatus !== "captured",
    )
  )
    return "记录只有事件或采集未成功，不能作为完整树对比";
  return null;
}

// 有界 LCS 对齐文本行，插入一行不会把后续相同行全部染色。
export function alignDiffLines(left: string[], right: string[]) {
  if (left.length * right.length > 250000)
    return Array.from(
      { length: Math.max(left.length, right.length) },
      (_, i) => ({
        left: left[i],
        right: right[i],
        leftLine: i < left.length ? i + 1 : undefined,
        rightLine: i < right.length ? i + 1 : undefined,
      }),
    );
  const dp = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      dp[i][j] =
        left[i] === right[j]
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const output: {
    left?: string;
    right?: string;
    leftLine?: number;
    rightLine?: number;
  }[] = [];
  let i = 0,
    j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      output.push({
        left: left[i],
        right: right[j],
        leftLine: ++i,
        rightLine: ++j,
      });
      continue;
    }
    const removed: { value: string; line: number }[] = [],
      added: { value: string; line: number }[] = [];
    while (
      (i < left.length || j < right.length) &&
      !(i < left.length && j < right.length && left[i] === right[j])
    ) {
      if (
        i < left.length &&
        (j === right.length || dp[i + 1][j] >= dp[i][j + 1])
      )
        removed.push({ value: left[i], line: ++i });
      else added.push({ value: right[j], line: ++j });
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++)
      output.push({
        left: removed[k]?.value,
        leftLine: removed[k]?.line,
        right: added[k]?.value,
        rightLine: added[k]?.line,
      });
  }
  return output;
}
// 属性引用和截断信息保留在原始视图；它们不能证明控件内容发生变化。
function usable(value: any) {
  if (value?.status !== "ok") return false;
  const text = JSON.stringify(value);
  return (
    !text.includes('"nodeRef"') &&
    !text.includes('"truncated":true') &&
    !text.includes('"unserialized"') &&
    !text.includes("<AXValue ")
  );
}
export function diffAX(before: any, after: any) {
  if (comparisonIssue(before, after)) return [];
  const oldNodes: any[] = before.nodes ?? [],
    newNodes: any[] = after.nodes ?? [];
  const oldLeft = new Set(oldNodes),
    newLeft = new Set(newNodes);
  const pairs: { left: any; right: any; basis: string }[] = [];
  function match(key: (n: any) => string, basis: string) {
    const left = new Map<string, any[]>(),
      right = new Map<string, any[]>();
    for (const [nodes, map] of [
      [oldLeft, left],
      [newLeft, right],
    ] as const)
      for (const n of nodes) {
        const k = key(n);
        if (k) map.set(k, [...(map.get(k) ?? []), n]);
      }
    for (const [key, items] of left)
      if (items.length === 1 && right.get(key)?.length === 1) {
        const a = items[0],
          b = right.get(key)![0];
        oldLeft.delete(a);
        newLeft.delete(b);
        pairs.push({ left: a, right: b, basis });
      }
  }
  const role = (n: any) => attributeText(n, "AXRole");
  // 第一优先级是应用主动提供的唯一标识，绝不用顺序或焦点路径。
  match(
    (n) =>
      attributeText(n, "AXIdentifier")
        ? role(n) + ":" + attributeText(n, "AXIdentifier")
        : "",
    "应用唯一标识",
  );
  const oldById = new Map(oldNodes.map((n) => [n.id, n])),
    newById = new Map(newNodes.map((n) => [n.id, n]));
  match((n) => {
    const label =
      attributeText(n, "AXTitle") || attributeText(n, "AXDescription");
    if (!label) return "";
    const parent = (oldLeft.has(n) ? oldById : newById).get(n.parent);
    return [
      role(n),
      label,
      parent ? role(parent) : "",
      parent
        ? attributeText(parent, "AXIdentifier") ||
          attributeText(parent, "AXTitle")
        : "",
    ].join("|");
  }, "唯一角色与标签（候选）");
  // 无标签输入框只在同一已匹配父节点下角色唯一时匹配。
  for (let index = 0; index < pairs.length; index++) {
    const parent = pairs[index];
    for (const kind of ["AXTextField", "AXTextArea", "AXComboBox"]) {
      const a = [...oldLeft].filter(
        (n) => n.parent === parent.left.id && role(n) === kind,
      );
      const b = [...newLeft].filter(
        (n) => n.parent === parent.right.id && role(n) === kind,
      );
      if (a.length === 1 && b.length === 1) {
        oldLeft.delete(a[0]);
        newLeft.delete(b[0]);
        pairs.push({
          left: a[0],
          right: b[0],
          basis: "同父节点唯一输入控件（候选）",
        });
      }
    }
  }
  const changes: any[] = [];
  for (const { left, right, basis } of pairs)
    for (const name of new Set([
      ...Object.keys(left.attributes),
      ...Object.keys(right.attributes),
    ])) {
      const a = left.attributes[name],
        b = right.attributes[name];
      if (canonicalAX(a) === canonicalAX(b)) continue;
      const reliable = usable(a) && usable(b);
      if (!reliable && a?.status === "ok" && b?.status === "ok") continue;
      changes.push({
        node: right.id,
        beforeNode: left.id,
        kind: reliable ? "属性变化" : "读取状态变化",
        attribute: name,
        before: a,
        after: b,
        basis,
        uncertain: !reliable || basis.includes("候选"),
      });
    }
  // 未匹配不等于真实增删，保留原始两侧供人工核对。
  for (const node of oldLeft)
    changes.push({
      node: node.id,
      kind: "仅左侧观察到（未匹配）",
      before: node.attributes,
      after: undefined,
      uncertain: true,
    });
  for (const node of newLeft)
    changes.push({
      node: node.id,
      kind: "仅右侧观察到（未匹配）",
      before: undefined,
      after: node.attributes,
      uncertain: true,
    });
  return changes;
}
