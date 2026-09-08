const messages: Record<string, string> = {
  no_window_at_click: "点击坐标下没有可识别的应用窗口（可能是桌面区域）。",
  event_target_window_not_found:
    "系统已指定点击接收进程，但在点击位置找不到它的可见窗口；可能已关闭，未改拍其他应用。",
  click_window_owner_ambiguous:
    "窗口层级与 AX 命中所属应用不一致，可能有透明覆盖层；已拒绝猜测截图目标。",
  clicked_window_owner_unavailable:
    "点击窗口的所属进程不可用，未改拍其他窗口。",
  keyboard_window_not_found: "已识别键盘所在应用，但没有找到它可见的目标窗口。",
  window_server_unavailable: "无法读取当前图形会话的窗口列表。",
  event_window_id_missing_or_invalid:
    "事件没有有效的窗口 ID，可能仍在使用旧采集器；请停止观察并重启应用。",
  manual_window_not_found: "指定应用没有可定位的可见窗口。",
  target_application_exited: "事件对应的应用已经退出。",
  target_window_closed:
    "事件锁定的窗口已不在 Window Server 中，窗口可能已关闭；没有改拍其他窗口。",
  target_window_not_on_screen:
    "事件锁定的窗口当前不在屏幕上（已隐藏、最小化或切到其他桌面），没有改拍其他窗口。",
  target_window_not_shareable:
    "窗口仍在 Window Server 中，但 ScreenCaptureKit 未将它列为可截图窗口，无法取得图片。",
  target_window_state_unavailable:
    "系统未返回该窗口的状态，无法确认它是否仍存在；已停止截图，不猜测目标。",
  target_process_replaced: "目标进程已被重新启动，拒绝把新进程当作原事件目标。",
  target_window_not_shareable_or_closed:
    "事件锁定的窗口已关闭、隐藏，或系统未将它列为可截图窗口；没有改拍其他窗口。",
  target_window_owner_mismatch:
    "窗口 ID 的所属进程与事件目标不一致，已阻止截图。",
  screen_recording_permission_denied:
    "实际采集进程没有屏幕录制权限，请在设置中检查并授权。",
  window_enumeration_failed: "ScreenCaptureKit 获取窗口列表失败。",
  screenshot_api_failed: "已经确定目标窗口，但系统截图 API 调用失败。",
  invalid_window_dimensions: "目标窗口尺寸无效，无法生成图片。",
  png_encoding_failed: "系统返回了图像，但 PNG 编码失败。",
  screenshot_required: "本次没有成功的截图，因此不会交给 AI 理解。",
  protected_input: "目标包含受保护输入，按隐私策略不保留图片。",
  protected_node_in_tree: "目标窗口含受保护的 AX 控件，按隐私策略不保留图片。",
  inspection_timeout: "采集器在 15 秒内没有返回，已终止该采集进程。",
  inspector_exited: "采集进程退出，未能完成这次截图。",
  inspector_write_failed: "向采集进程发送事件失败。",
  skipped_busy: "采集并发已满，本次明确跳过；不会延迟拍摄一张过时画面。",
  pending: "正在采集事件锁定的窗口。",
  foreground_changed_before_capture:
    "旧版采集器的前台校验拒绝了事件，请升级后重新采集。",
  foreground_changed_during_capture:
    "旧版采集器在采集后因前台变化丢弃了结果，请升级后重新采集。",
  window_match_ambiguous_or_missing:
    "旧版窗口匹配没有得到唯一目标，请升级为窗口 ID 定位后重新采集。",
};
export function captureDiagnostic(snapshot: any) {
  const screenshot = snapshot.screenshot ?? {};
  const detail = { ...snapshot.captureDiagnostics, ...screenshot.diagnostics };
  const reason =
    snapshot.captureError ??
    screenshot.reason ??
    (!screenshot.data ? "screenshot_required" : null);
  const target = detail.target ?? snapshot.trigger?.targetWindow;
  return {
    reason,
    message: reason
      ? (messages[reason] ?? `采集失败：${reason}`)
      : "已取得目标窗口图片。",
    stage: screenshot.stage ?? detail.stage ?? "未知阶段",
    targetId: target?.id ?? screenshot.windowId ?? snapshot.windowId,
    targetPid: target?.pid ?? snapshot.pid,
    detail,
  };
}
