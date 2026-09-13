/** 轻量编辑会话：只读取已确认非安全焦点的 AX 值和选区，不读取键盘字符或截图。 */
import AppKit
import ApplicationServices
import Carbon

/** 每个连续焦点会话使用独立 ID；定时合并 AX 状态变化，不让每次按键产生动作。 */
final class EditingWatch {
    private var element: AXUIElement?
    private var app: NSRunningApplication?
    private var id: String?
    private var window: AXUIElement?
    private var revision = 0
    private var lastState: NSDictionary?
    private var timer: Timer?
    private var session: String

    init(session: String) { self.session = session }

    /** 监听期间每 150ms 读取一次活动焦点，捕获输入法落字和鼠标选区更新。 */
    func start() {
        timer = Timer.scheduledTimer(withTimeInterval:0.15,repeats:true) { [weak self] _ in self?.sample() }
        if let timer { RunLoop.main.add(timer,forMode:.common) }
    }

    /** 只标记归并候选，不抑制原始采集；未知焦点沿用原动作策略。 */
    func handlesKey(_ code: Int64, flags: CGEventFlags) -> Bool {
        guard refresh() else { return false }
        if !isEditingKey(code,flags:flags) { sampleValue(); return false }
        return id != nil
    }

    /** 左键在同一输入控件内仅改变光标或选区；右键和外部控件仍作为独立动作。 */
    func handlesClick(_ point: CGPoint) -> Bool {
        guard refresh(), let element else { return false }
        let system = AXUIElementCreateSystemWide(); AXUIElementSetMessagingTimeout(system,0.005)
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system,Float(point.x),Float(point.y),&hit) == .success else { return false }
        for _ in 0..<5 {
            guard let current = hit else { break }
            if CFEqual(current,element) { return true }
            AXUIElementSetMessagingTimeout(current,0.005)
            hit = axElement(current,kAXParentAttribute)
        }
        return false
    }

    /** 引用仅包含会话 ID，正文由独立编辑状态通道传输，不能进入事件元数据。 */
    func reference(pid: pid_t) -> String? { app?.processIdentifier == pid ? id : nil }

    /** 停止时发布最后一次状态并明确结束会话。 */
    func stop() { sample(); close("observation_stopped"); timer?.invalidate(); timer = nil }

    private func sample() { if refresh() { sampleValue() } }

    /** 使用 AX 对象等价性判断身份，不用可能重复的 title 或路径合并输入框。 */
    private func refresh() -> Bool {
        guard !IsSecureEventInputEnabled(), let foreground = NSWorkspace.shared.frontmostApplication,
              foreground.processIdentifier != getppid(), foreground.processIdentifier != getpid(), foreground.bundleIdentifier != "io.github.hedgeho9x.proactive-agent" else { close("protected_or_excluded_focus"); return false }
        let root = AXUIElementCreateApplication(foreground.processIdentifier); AXUIElementSetMessagingTimeout(root,0.005)
        guard let focus = axElement(root,kAXFocusedUIElementAttribute) else { close("focus_unavailable"); return false }
        AXUIElementSetMessagingTimeout(focus,0.005)
        var owner: pid_t = 0
        guard AXUIElementGetPid(focus,&owner) == .success, owner == foreground.processIdentifier,
              let role = attribute(focus,kAXRoleAttribute) as? String, ["AXTextField","AXTextArea","AXComboBox"].contains(role),
              attribute(focus,kAXSubroleAttribute) as? String != "AXSecureTextField",
              let focusedWindow = axElement(focus,kAXWindowAttribute) else { close("focus_not_editable_or_unavailable"); return false }
        if role == "AXComboBox" {
            var editable: DarwinBoolean = false
            guard AXUIElementIsAttributeSettable(focus,kAXValueAttribute as CFString,&editable) == .success, editable.boolValue else { close("combobox_not_editable"); return false }
        }
        if let element, let window, app?.processIdentifier == owner, app?.launchDate == foreground.launchDate,
           CFEqual(element,focus), CFEqual(window,focusedWindow) { return true }
        close("focus_changed")
        element = focus; window = focusedWindow; app = foreground; id = "ax-" + UUID().uuidString.lowercased()
        revision = 0; lastState = nil
        sampleValue()
        return id != nil
    }

    /** 一次样本是 AX 当前暴露的值，不承诺应用暴露了完整正文。 */
    private func sampleValue() {
        guard let element, let id, let app else { return }
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element,kAXValueAttribute as CFString,&value)
        guard result == .success, let text = value as? String else { close("ax_value_unavailable_\(result.rawValue)"); return }
        var selection: [String:Any] = ["status":"unavailable"]
        var selected: CFTypeRef?
        if AXUIElementCopyAttributeValue(element,kAXSelectedTextRangeAttribute as CFString,&selected) == .success,
           let selected, CFGetTypeID(selected) == AXValueGetTypeID(), AXValueGetType(selected as! AXValue) == .cfRange {
            var range = CFRange()
            if AXValueGetValue(selected as! AXValue,.cfRange,&range) { selection = ["status":"available","location":range.location,"length":range.length,"unit":"utf16"] }
        }
        let state: [String:Any] = ["text":text,"selection":selection]
        if lastState?.isEqual(to:state) == true { return }
        lastState = state as NSDictionary; revision += 1
        emit(["type":"input_event","event":["id":id,"session":session,"revision":revision,"kind":"editing_update","pid":Int(app.processIdentifier),"app":app.localizedName ?? "","bundleId":app.bundleIdentifier ?? "","occurredAt":preciseTimestamp(),"editing":["text":text,"selection":selection,"role":attribute(element,kAXRoleAttribute) as? String ?? "","source":"AXValue","completeness":"application_exposed","state":"editing"]]])
    }

    /** 结束原因不携带正文，宿主保留最后一次成功的 AX 观察。 */
    private func close(_ reason: String) {
        if let id, let app { revision += 1; emit(["type":"input_event","event":["id":id,"session":session,"revision":revision,"kind":"editing_closed","pid":Int(app.processIdentifier),"app":app.localizedName ?? "","bundleId":app.bundleIdentifier ?? "","occurredAt":preciseTimestamp(),"reason":reason]]) }
        element = nil; window = nil; app = nil; id = nil; lastState = nil
    }

    private func axElement(_ source: AXUIElement, _ name: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(source,name as CFString,&value) == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }
}
