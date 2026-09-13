// 日常视图以一次按下或一次点击为单位，历史松开和修饰键仅作诊断保留。
export function meaningfulAXEvent(item: any) {
  if (!item.trigger || ["click", "editing_session"].includes(item.trigger.kind))
    return true;
  if (item.trigger.kind !== "key_down") return false;
  const modifiers = Array.isArray(item.trigger.modifiers)
    ? item.trigger.modifiers
    : [];
  if (
    modifiers.some((name: string) =>
      ["Cmd", "Ctrl", "Option", "Fn"].includes(name),
    )
  )
    return true;
  const plain = /^[A-Z0-9]$|^Numpad[0-9]$/.test(item.trigger.key ?? "");
  const legacyNumpad = [82, 83, 84, 85, 86, 87, 88, 89, 91, 92].includes(
    item.trigger.keyCode,
  );
  return !plain && !legacyNumpad;
}
export function hasAXEvidence(item: any) {
  return (
    meaningfulAXEvent(item) &&
    (item.captureStatus === "captured" ||
      (!item.captureStatus &&
        (Array.isArray(item.nodes) ? item.nodes.length > 0 : item.nodes > 0)))
  );
}
export function eventOrder(a: any, b: any) {
  const time = (item: any) =>
    Date.parse(item.trigger?.occurredAt ?? item.capturedAt ?? item.savedAt) ||
    0;
  const delta = time(b) - time(a);
  if (delta) return delta;
  if (a.trigger?.session && a.trigger.session === b.trigger?.session)
    return (b.trigger.sequence ?? 0) - (a.trigger.sequence ?? 0);
  return (b.savedAt ?? "").localeCompare(a.savedAt ?? "");
}
export function precedingAXEvent(current: any, history: any[]) {
  const id = current.snapshotId ?? current.id;
  const ordered = history.filter(meaningfulAXEvent).sort(eventOrder);
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return { previous: null, missing: 0 };
  let missing = 0;
  for (const candidate of ordered.slice(index + 1)) {
    if (
      candidate.pid !== current.pid ||
      candidate.bundleId !== current.bundleId
    )
      continue;
    const launchA = current.appLaunchedAt ?? current.trigger?.appLaunchedAt;
    const launchB = candidate.appLaunchedAt ?? candidate.trigger?.appLaunchedAt;
    if (launchA && launchB && launchA !== launchB) continue;
    if (hasAXEvidence(candidate)) return { previous: candidate, missing };
    missing++;
  }
  return { previous: null, missing };
}
