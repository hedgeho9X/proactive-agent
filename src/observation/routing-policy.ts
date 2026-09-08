export const routingOptions = [
  { id: "enter", label: "Enter（含小键盘）", keys: ["Enter", "NumpadEnter"] },
  { id: "space", label: "空格", keys: ["Space"] },
  { id: "tab", label: "Tab", keys: ["Tab"] },
  { id: "escape", label: "Esc", keys: ["Escape"] },
  { id: "delete", label: "退格／删除", keys: ["Backspace", "Delete"] },
  { id: "arrows", label: "方向键", keys: ["Left", "Right", "Up", "Down"] },
  { id: "shortcuts", label: "组合快捷键", keys: [] },
  { id: "click", label: "鼠标点击", keys: [] },
];
export const defaultRouting = ["enter", "space", "click"];
export function matchesRouting(trigger: any, selected: string[]) {
  if (!trigger) return false;
  if (["click", "mouse_down"].includes(trigger.kind))
    return selected.includes("click");
  if (trigger.kind !== "key_down") return false;
  if (
    selected.includes("shortcuts") &&
    Array.isArray(trigger.modifiers) &&
    trigger.modifiers.some((value: string) =>
      ["Cmd", "Ctrl", "Option", "Fn"].includes(value),
    )
  )
    return true;
  return routingOptions.some(
    (option) =>
      selected.includes(option.id) && option.keys.includes(trigger.key),
  );
}
export function snapshotRoutingReason(snapshot: any, selected: string[]) {
  if (!matchesRouting(snapshot.trigger, selected))
    return "trigger_not_selected";
  if (snapshot.captureStatus !== "captured") return "capture_not_ready";
  if (snapshot.alignment?.sameWindow === false)
    return "evidence_window_mismatch";
  if (
    snapshot.screenshot?.status === "excluded" ||
    snapshot.nodes?.some((node: any) => node.protected)
  )
    return "protected_evidence";
  if (snapshot.screenshot?.status !== "captured" || !snapshot.screenshot?.data)
    return snapshot.screenshot?.reason ?? "screenshot_required";
  return undefined;
}
