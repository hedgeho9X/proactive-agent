import AppKit
import ApplicationServices
import ScreenCaptureKit

// 观测台使用独立的一次性进程，不接入事件队列或模型。
func inspectorApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
        ["pid": Int($0.processIdentifier), "name": $0.localizedName ?? "未知应用", "bundleId": $0.bundleIdentifier ?? ""]
    }
}

func inspectAX(_ pid: pid_t, trigger: [String:Any]? = nil) async -> [String: Any] {
    let began = Date()
    guard let app = NSRunningApplication(processIdentifier: pid) else { return ["error":"目标应用已退出"] }
    let requireForeground = trigger?["kind"] as? String != "click" && (trigger != nil || CommandLine.arguments.contains("--require-foreground"))
    if requireForeground && NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { return ["error":"foreground_changed_before_capture"] }
    let captureGate = AsyncStream<Void>.makeStream()
    let captureTask = Task.detached {
        defer { captureGate.continuation.finish() }
        return await captureEventEvidence(pid,trigger:trigger,requested:{ captureGate.continuation.yield(());captureGate.continuation.finish() })
    }
    let application = AXUIElementCreateApplication(pid)
    var nodes = [[String: Any]]()
    var refs = [AXUIElement]()
    var partial = false
    var protectedFound = false
    let deadline = began.addingTimeInterval(3)
    func identifier(_ element: AXUIElement) -> String {
        if let index = refs.firstIndex(where: { CFEqual($0, element) }) { return "n\(index)" }
        refs.append(element)
        return "n\(refs.count - 1)"
    }
    func serialize(_ value: Any, depth: Int = 0) -> Any {
        if depth > 3 { return ["truncated":true] }
        let object = value as CFTypeRef
        if CFGetTypeID(object) == AXUIElementGetTypeID() { return ["nodeRef":identifier(object as! AXUIElement)] }
        if let string = value as? String { return ["text":String(string.prefix(8000)), "truncated":string.count > 8000] }
        if let array = value as? [Any] { return ["items":array.prefix(100).map { serialize($0, depth:depth + 1) }, "total":array.count, "truncated":array.count > 100] }
        if let number = value as? NSNumber { return number }
        if CFGetTypeID(object) == AXValueGetTypeID() {
            let ax = object as! AXValue
            switch AXValueGetType(ax) {
            case .cgPoint:
                var v = CGPoint.zero; AXValueGetValue(ax,.cgPoint,&v); return ["x":v.x,"y":v.y]
            case .cgSize:
                var v = CGSize.zero; AXValueGetValue(ax,.cgSize,&v); return ["width":v.width,"height":v.height]
            case .cgRect:
                var v = CGRect.zero; AXValueGetValue(ax,.cgRect,&v); return ["x":v.minX,"y":v.minY,"width":v.width,"height":v.height]
            case .cfRange:
                var v = CFRange(); AXValueGetValue(ax,.cfRange,&v); return ["location":v.location,"length":v.length]
            default: return ["type":"AXValue", "status":"unserialized"]
            }
        }
        if let dictionary = value as? [String: Any] { return dictionary.mapValues { serialize($0, depth:depth + 1) } }
        return ["type":String(describing:type(of:value)), "status":"unserialized"]
    }
    func read(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return (error, value)
    }
    func visit(_ element: AXUIElement, parent: String?, path: String, depth: Int, walkChildren: Bool = true) {
        guard nodes.count < 800, depth < 20, Date() < deadline else { partial = true; return }
        let id = identifier(element)
        if let index = nodes.firstIndex(where: { $0["id"] as? String == id }) {
            // 焦点预读取不能改变节点在窗口树中的规范路径。
            if nodes[index]["path"] as? String == "focus" && path != "focus" {
                nodes[index]["path"] = path; nodes[index]["parent"] = parent as Any? ?? NSNull()
                if nodes[index]["protected"] as? Bool != true {
                    let (_, value) = read(element,kAXChildrenAttribute)
                    for (i, child) in (value as? [AXUIElement] ?? []).enumerated() { visit(child,parent:id,path:"\(path)/\(i)",depth:depth+1) }
                }
            }
            return
        }
        AXUIElementSetMessagingTimeout(element, 0.03)
        let (_, subrole) = read(element, kAXSubroleAttribute)
        let secure = subrole as? String == "AXSecureTextField"
        protectedFound = protectedFound || secure
        var attributes = [String: Any]()
        var names: CFArray?
        let listError = AXUIElementCopyAttributeNames(element, &names)
        var children = [AXUIElement]()
        if !secure {
            for name in names as? [String] ?? [] {
                if Date() >= deadline { partial = true; attributes[name] = ["status":"not_read", "reason":"time_budget"]; continue }
                let (error, value) = read(element, name)
                if error == .success, let value {
                    attributes[name] = ["status":"ok", "value":serialize(value)]
                    if name == kAXChildrenAttribute { children = value as? [AXUIElement] ?? [] }
                } else {
                    attributes[name] = ["status":error == .noValue ? "no_value" : error == .attributeUnsupported ? "unsupported" : "error", "code":error.rawValue]
                }
            }
        }
        var parameterized: CFArray?
        let parameterError = secure ? AXError.failure : AXUIElementCopyParameterizedAttributeNames(element, &parameterized)
        var actions: CFArray?
        let actionError = secure ? AXError.failure : AXUIElementCopyActionNames(element, &actions)
        nodes.append(["id":id, "parent":parent as Any? ?? NSNull(), "path":path, "protected":secure, "attributes":attributes, "attributeListCode":listError.rawValue, "parameterizedAttributes":parameterized as? [String] ?? [], "parameterizedCode":parameterError.rawValue, "actions":actions as? [String] ?? [], "actionsCode":actionError.rawValue])
        if walkChildren { for (index, child) in children.enumerated() { visit(child, parent:id, path:"\(path)/\(index)", depth:depth + 1) } }
    }
    // 截图请求发出后立即开始这次 AX 读取，根窗口和焦点也使用这个采样阶段。
    for await _ in captureGate.stream { break }
    let axStartedAt = preciseTimestamp()
    AXUIElementSetMessagingTimeout(application, 0.03)
    let (windowError, focusedWindowValue) = read(application, kAXFocusedWindowAttribute)
    let treeClick = probeClickRegion(pid,trigger)
    let windowValue = treeClick.element.flatMap { attribute($0,kAXWindowAttribute) } ?? focusedWindowValue
    let window = windowValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    let (focusError, focusValue) = read(application, kAXFocusedUIElementAttribute)
    let focus = focusValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    // 焦点优先读取，完整树与截图任务并行；分别保存实际采样时间。
    if let focus { visit(focus, parent:nil, path:"focus", depth:0, walkChildren:false) }
    visit(window ?? application, parent:nil, path:"window", depth:0)
    let axCompletedAt = preciseTimestamp()
    var capture = await captureTask.value
    if protectedFound { capture.screenshot = ["status":"excluded","reason":"protected_node_in_tree"] }
    var screenshot = capture.screenshot
    let windowId = capture.windowId
    // 截图区域绑定它自己采样的元素，禁止复用较早的 treeFocusId。
    func attachRegionNode(_ probe: FocusRegionProbe?, path: String) -> String? {
        guard let probe, let element = probe.element, !probe.protected else { return nil }
        let id = identifier(element)
        if !nodes.contains(where: { $0["id"] as? String == id }) {
            nodes.append(["id":id,"parent":NSNull(),"path":path,"protected":false,"attributes":probe.attributes,"actions":[],"parameterizedAttributes":[],"source":"screenshot_region_probe"])
        }
        return id
    }
    let screenshotFocusId = attachRegionNode(capture.focus,path:"screenshot-focus")
    let clickedId = attachRegionNode(capture.click,path:"screenshot-click")
    if var regions = screenshot["regions"] as? [String:Any] {
        for (name,id,probe) in [("focus",screenshotFocusId,capture.focus),("selection",screenshotFocusId,capture.focus),("click",clickedId,capture.click)] {
            if var region = regions[name] as? [String:Any] {
                region["nodeId"] = id as Any? ?? NSNull()
                region["sampledAttributes"] = probe?.attributes ?? [:]
                region["sampledAt"] = probe.map { preciseTimestamp($0.sampledAt) } as Any? ?? NSNull()
                regions[name] = region
            }
        }
        screenshot["regions"] = regions
    }
    if requireForeground {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { return ["error":"foreground_changed_during_capture"] }
        if let window, let current = attribute(application,kAXFocusedWindowAttribute), CFGetTypeID(current) == AXUIElementGetTypeID(), !CFEqual(window,current) { return ["error":"window_changed_during_capture"] }
    }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
    return ["captureSchema":3,"axRootScope":window == nil ? "application" : "window","timing":["eventAt":trigger?["occurredAt"] as Any? ?? NSNull(),"requestReceivedAt":preciseTimestamp(began),"axStartedAt":axStartedAt,"axCompletedAt":axCompletedAt,"screenshotRequestedAt":screenshot["requestedAt"] as Any? ?? NSNull(),"screenshotCompletedAt":screenshot["capturedAt"] as Any? ?? NSNull(),"nonAtomic":true],"treeFocusId":focus.map { identifier($0) } as Any? ?? NSNull(),"clickedId":clickedId as Any? ?? NSNull(),"appLaunchedAt":app.launchDate.map { formatter.string(from:$0) } ?? "","windowId":windowId as Any? ?? NSNull(),"pid":Int(pid), "app":app.localizedName ?? "", "bundleId":app.bundleIdentifier ?? "", "capturedAt":formatter.string(from:began), "elapsedMs":Int(Date().timeIntervalSince(began)*1000), "nodes":nodes, "partial":partial, "limits":["nodes":800,"depth":20,"milliseconds":3000,"textCharacters":8000], "windowCode":windowError.rawValue, "focusCode":focusError.rawValue, "focusId":screenshotFocusId as Any? ?? NSNull(), "permissions":permissions(), "screenshot":screenshot]
}
