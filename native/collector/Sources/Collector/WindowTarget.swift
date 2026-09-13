/** 根据窗口几何锁定采集目标，并提供自身点击排除策略；不执行截图。 */
import AppKit
import ApplicationServices

struct CaptureWindowTarget {
    let id: CGWindowID
    let pid: pid_t
    let frame: CGRect
    let layer: Int
    var source: String
    var json: [String:Any] { ["id":Int(id),"pid":Int(pid),"frame":regionRect(frame),"layer":layer,"source":source] }
    init(id: CGWindowID, pid: pid_t, frame: CGRect, layer: Int = 0, source: String) {
        self.id = id; self.pid = pid; self.frame = frame; self.layer = layer; self.source = source
    }
    init?(_ value: [String:Any]) {
        guard let id = value["id"] as? UInt32, id > 0, let pid = value["pid"] as? Int32, pid > 0,
              let rect = value["frame"] as? [String:Double], let x = rect["x"], let y = rect["y"], let w = rect["width"], let h = rect["height"],
              [x,y,w,h].allSatisfy({$0.isFinite}), w > 0, h > 0 else { return nil }
        self.init(id:id,pid:pid,frame:CGRect(x:x,y:y,width:w,height:h),layer:value["layer"] as? Int ?? 0,source:value["source"] as? String ?? "event_window_id")
    }
}

func sameWindowBounds(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX-b.minX)<2 && abs(a.minY-b.minY)<2 && abs(a.width-b.width)<2 && abs(a.height-b.height)<2
}

func unavailableWindowReason(_ target: CaptureWindowTarget, info: [[String:Any]]?) -> String {
    guard let info else { return "target_window_state_unavailable" }
    guard let item = info.first(where: {($0[kCGWindowNumber as String] as? UInt32) == target.id}) else { return "target_window_closed" }
    if let owner = item[kCGWindowOwnerPID as String] as? Int32, owner != target.pid { return "target_window_owner_mismatch" }
    if item[kCGWindowIsOnscreen as String] as? Bool == false { return "target_window_not_on_screen" }
    return "target_window_not_shareable"
}

// Quartz 的屏幕窗口列表按从前到后排序；不采集其他窗口标题到诊断记录。
func onscreenCaptureWindows() -> [CaptureWindowTarget]? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else { return nil }
    return list.compactMap { item in
        guard let id = item[kCGWindowNumber as String] as? UInt32, let pid = item[kCGWindowOwnerPID as String] as? Int32,
              let dictionary = item[kCGWindowBounds as String] as? [String:Any], let frame = CGRect(dictionaryRepresentation:dictionary as CFDictionary),
              (item[kCGWindowAlpha as String] as? Double ?? 1) > 0, frame.width > 0, frame.height > 0 else { return nil }
        // 自己的弹幕是点击穿透窗口，不能误认为用户点击了弹幕。
        if pid == getppid(), item[kCGWindowName as String] as? String == "Proactive Agent 桌面弹幕" { return nil }
        return CaptureWindowTarget(id:id,pid:pid,frame:frame,layer:item[kCGWindowLayer as String] as? Int ?? 0,source:"window_server")
    }
}

// 点击不先按前台 PID 过滤：点击后台窗口时，按下瞬间前台尚未切换。
func clickedWindow(_ windows: [CaptureWindowTarget], point: CGPoint) -> CaptureWindowTarget? {
    guard point.x.isFinite, point.y.isFinite else { return nil }
    guard var target = windows.first(where: {$0.frame.contains(point)}) else { return nil }
    target.source = "mouse_down_window_server_hit"; return target
}

/** 优先使用 AX 命中身份；AX 缺失时，仅在 Dock 遮罩、原生目标和最前普通窗口共同指向自身时排除。 */
func isOwnClick(windows: [CaptureWindowTarget], point: CGPoint, selected: CaptureWindowTarget?,
                hitPid: pid_t?, nativePid: Int64, ownPid: pid_t, selectedIsDock: Bool) -> Bool {
    if hitPid == ownPid || selected?.pid == ownPid { return true }
    // 原生 PID 可能滞后，不能单独用它排除点击其他应用的事件。
    if let hitPid, hitPid > 0 { return false }
    guard selectedIsDock, nativePid == Int64(ownPid),
          let normal = windows.first(where: { $0.layer == 0 && $0.frame.contains(point) }) else { return false }
    return normal.pid == ownPid
}

func keyboardWindow(_ windows: [CaptureWindowTarget], pid: pid_t, focusedBounds: CGRect?) -> CaptureWindowTarget? {
    let owned = windows.filter {$0.pid == pid}
    if let frame = focusedBounds, var target = owned.first(where: {sameWindowBounds($0.frame,frame)}) {
        target.source = "key_down_focused_window"; return target
    }
    guard var target = owned.first(where: {$0.layer == 0}) else { return nil }
    target.source = "key_down_front_window_ax_unavailable"; return target
}

// 所有调用方都到主线程读取，不在没有运行循环推进的后台缓存上做身份校验。
@MainActor func foregroundState() -> [String:Any] {
    let app = NSWorkspace.shared.frontmostApplication
    return ["pid":app.map {Int($0.processIdentifier)} as Any? ?? NSNull(),"bundleId":app?.bundleIdentifier as Any? ?? NSNull(),"at":preciseTimestamp(),"source":"main_actor_NSWorkspace"]
}

// AX 只作为窗口内的附加证据。无法唯一关联时不拿另一窗口的 AX 来补。
func axWindowForTarget(_ application: AXUIElement, _ target: CaptureWindowTarget) -> AXUIElement? {
    var list = attribute(application,kAXWindowsAttribute) as? [AXUIElement] ?? []
    if let value = attribute(application,kAXFocusedWindowAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() {
        let focused = value as! AXUIElement
        if !list.contains(where: {CFEqual($0,focused)}) { list.append(focused) }
    }
    let matches = list.filter { element in
        AXUIElementSetMessagingTimeout(element,0.015)
        return bounds(element).map {sameWindowBounds($0,target.frame)} ?? false
    }
    return matches.count == 1 ? matches[0] : nil
}

@MainActor func manualCaptureTarget(_ pid: pid_t) -> CaptureWindowTarget? {
    guard let windows = onscreenCaptureWindows() else { return nil }
    let application = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(application,0.015)
    let focused = attribute(application,kAXFocusedWindowAttribute)
    let frame = focused.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? bounds($0 as! AXUIElement) : nil }
    return keyboardWindow(windows,pid:pid,focusedBounds:frame)
}
