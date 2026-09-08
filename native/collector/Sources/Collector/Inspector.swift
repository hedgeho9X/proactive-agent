import AppKit
import ApplicationServices
import ScreenCaptureKit

// 观测台使用独立的一次性进程，不接入事件队列或模型。
func inspectorApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
        ["pid": Int($0.processIdentifier), "name": $0.localizedName ?? "未知应用", "bundleId": $0.bundleIdentifier ?? ""]
    }
}

func inspectAX(_ pid: pid_t, trigger: [String:Any]? = nil, progress: @escaping @Sendable ([String:Any]) -> Void = {_ in}) async -> [String: Any] {
    let began = Date()
    progress(["component":"target","stage":"foreground_read","state":"running","at":preciseTimestamp()])
    let foregroundBefore = await foregroundState()
    func failure(_ reason: String, stage: String) -> [String:Any] {
        let diagnostic: [String:Any] = ["stage":stage,"reason":reason,"expectedPid":Int(pid),"foregroundBefore":foregroundBefore,"target":trigger?["targetWindow"] as Any? ?? NSNull(),"eventResolution":trigger?["targetResolution"] as Any? ?? NSNull(),"requestReceivedAt":preciseTimestamp(began)]
        return ["error":reason,"pid":Int(pid),"nodes":[],"partial":true,"captureDiagnostics":diagnostic,"screenshot":["status":"error","reason":reason,"stage":stage,"diagnostics":diagnostic],"elapsedMs":Int(Date().timeIntervalSince(began)*1000)]
    }
    if let resolution = trigger?["targetResolution"] as? [String:Any], resolution["status"] as? String == "failed" {
        return failure(resolution["reason"] as? String ?? "event_window_lookup_failed",stage:"event_window_lookup")
    }
    let selected: CaptureWindowTarget?
    if let trigger {
        guard let value = trigger["targetWindow"] as? [String:Any], let window = CaptureWindowTarget(value), window.pid == pid else { return failure("event_window_id_missing_or_invalid",stage:"event_target_validation") }
        selected = window
    } else { selected = await manualCaptureTarget(pid) }
    guard let target = selected else { return failure("manual_window_not_found",stage:"manual_window_lookup") }
    guard let app = NSRunningApplication(processIdentifier: pid) else { return failure("target_application_exited",stage:"application_validation") }
    progress(["component":"target","stage":"target_locked","state":"complete","target":target.json,"at":preciseTimestamp()])
    var warnings = [String]()
    if trigger != nil && foregroundBefore["pid"] as? Int != Int(pid) { warnings.append("foreground_changed_since_event_target_kept") }
    let captureGate = AsyncStream<Void>.makeStream()
    let captureTask = Task.detached {
        defer { captureGate.continuation.finish() }
        return await captureEventEvidence(pid,target:target,trigger:trigger,progress:progress,requested:{ captureGate.continuation.yield(());captureGate.continuation.finish() })
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
    progress(["component":"ax","stage":"ax_traversal","state":"running","at":axStartedAt])
    AXUIElementSetMessagingTimeout(application, 0.03)
    let (windowError, _) = read(application, kAXWindowsAttribute)
    let window = axWindowForTarget(application,target)
    let (focusError, focusValue) = read(application, kAXFocusedUIElementAttribute)
    let focus = focusValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    // 焦点优先读取，完整树与截图任务并行；分别保存实际采样时间。
    if let window {
        if let focus, let owner = attribute(focus,kAXWindowAttribute), CFGetTypeID(owner) == AXUIElementGetTypeID(), CFEqual(owner,window) { visit(focus,parent:nil,path:"focus",depth:0,walkChildren:false) }
        visit(window,parent:nil,path:"window",depth:0)
    } else { partial = true; warnings.append("target_ax_window_unavailable_image_only") }
    let axCompletedAt = preciseTimestamp()
    progress(["component":"ax","stage":"ax_traversal","state":"complete","at":axCompletedAt])
    var capture = await captureTask.value
    if protectedFound { capture.screenshot.removeValue(forKey:"data"); capture.screenshot["status"] = "excluded"; capture.screenshot["reason"] = "protected_node_in_tree"; capture.screenshot["stage"] = "privacy_check_ax_tree" }
    var screenshot = capture.screenshot
    let windowId = capture.windowId
    // 截图区域绑定它自己采样的元素，禁止复用较早的 treeFocusId。
    func attachRegionNode(_ probe: FocusRegionProbe?, path: String, region: String) -> String? {
        guard let regions = screenshot["regions"] as? [String:Any], let info = regions[region] as? [String:Any], info["status"] as? String == "available" else { return nil }
        guard let probe, let element = probe.element, !probe.protected else { return nil }
        let id = identifier(element)
        if !nodes.contains(where: { $0["id"] as? String == id }) {
            nodes.append(["id":id,"parent":NSNull(),"path":path,"protected":false,"attributes":probe.attributes,"actions":[],"parameterizedAttributes":[],"source":"screenshot_region_probe"])
        }
        return id
    }
    let aligned = window != nil && capture.axWindow != nil ? CFEqual(window!,capture.axWindow!) : nil
    if aligned == false { nodes.removeAll(); partial = true; warnings.append("ax_window_mismatch_discarded") }
    let screenshotFocusId = attachRegionNode(capture.focus,path:"screenshot-focus",region:"focus")
    let clickedId = attachRegionNode(capture.click,path:"screenshot-click",region:"click")
    if var regions = screenshot["regions"] as? [String:Any] {
        for (name,id,probe) in [("focus",screenshotFocusId,capture.focus),("selection",screenshotFocusId,capture.focus),("click",clickedId,capture.click)] {
            if var region = regions[name] as? [String:Any] {
                region["nodeId"] = id as Any? ?? NSNull()
                region["sampledAttributes"] = region["status"] as? String == "available" ? (probe?.attributes ?? [:]):[:]
                region["sampledAt"] = probe.map { preciseTimestamp($0.sampledAt) } as Any? ?? NSNull()
                regions[name] = region
            }
        }
        screenshot["regions"] = regions
    }
    let foregroundAfter = await foregroundState()
    if trigger != nil && foregroundAfter["pid"] as? Int != Int(pid) { warnings.append("foreground_changed_during_capture_target_kept") }
    let hasImage = screenshot["status"] as? String == "captured" && screenshot["data"] as? String != nil
    let diagnostic: [String:Any] = ["target":target.json,"foregroundBefore":foregroundBefore,"foregroundAfter":foregroundAfter,"warnings":warnings,"windowListCode":windowError.rawValue,"focusCode":focusError.rawValue,"axWindowResolved":window != nil,"stage":hasImage ? "complete":(screenshot["stage"] as? String ?? "screenshot"),"reason":screenshot["reason"] as Any? ?? NSNull()]
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
    var output: [String:Any] = ["captureSchema":5,"captureStatus":hasImage ? "captured":"failed","captureDiagnostics":diagnostic,"alignment":["sameWindow":aligned == true ? true as Any:NSNull(),"axDiscarded":aligned == false],"axRootScope":window == nil ? "unavailable" : "window","timing":["eventAt":trigger?["occurredAt"] as Any? ?? NSNull(),"requestReceivedAt":preciseTimestamp(began),"axStartedAt":axStartedAt,"axCompletedAt":axCompletedAt,"screenshotRequestedAt":screenshot["requestedAt"] as Any? ?? NSNull(),"screenshotCompletedAt":screenshot["capturedAt"] as Any? ?? NSNull(),"nonAtomic":true],"treeFocusId":focus.map { identifier($0) } as Any? ?? NSNull(),"clickedId":clickedId as Any? ?? NSNull(),"appLaunchedAt":app.launchDate.map { formatter.string(from:$0) } ?? "","windowId":windowId as Any? ?? NSNull(),"pid":Int(pid), "app":app.localizedName ?? "", "bundleId":app.bundleIdentifier ?? "", "capturedAt":formatter.string(from:began), "elapsedMs":Int(Date().timeIntervalSince(began)*1000), "nodes":nodes, "partial":partial, "limits":["nodes":800,"depth":20,"milliseconds":3000,"textCharacters":8000], "windowCode":windowError.rawValue, "focusCode":focusError.rawValue, "focusId":screenshotFocusId as Any? ?? NSNull(), "permissions":permissions(), "screenshot":screenshot]
    if !hasImage { output["error"] = screenshot["reason"] as? String ?? "screenshot_missing" }
    return output
}
