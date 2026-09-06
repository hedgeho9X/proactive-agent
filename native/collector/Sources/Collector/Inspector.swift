import AppKit
import ApplicationServices
import ScreenCaptureKit

// 观测台使用独立的一次性进程，不接入事件队列或模型。
func inspectorApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
        ["pid": Int($0.processIdentifier), "name": $0.localizedName ?? "未知应用", "bundleId": $0.bundleIdentifier ?? ""]
    }
}

func inspectAX(_ pid: pid_t) async -> [String: Any] {
    let began = Date()
    guard let app = NSRunningApplication(processIdentifier: pid) else { return ["error":"目标应用已退出"] }
    let requireForeground = CommandLine.arguments.contains("--require-foreground")
    if requireForeground && NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { return ["error":"foreground_changed_before_capture"] }
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
    AXUIElementSetMessagingTimeout(application, 0.03)
    let (windowError, windowValue) = read(application, kAXFocusedWindowAttribute)
    let window = windowValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    let (focusError, focusValue) = read(application, kAXFocusedUIElementAttribute)
    let focus = focusValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    // 焦点优先独立读取，避免大树耗尽预算后丢失输入框。
    if let focus { visit(focus, parent:nil, path:"focus", depth:0, walkChildren:false) }
    visit(window ?? application, parent:nil, path:"window", depth:0)
    var screenshot: [String: Any] = ["status":"unavailable"]
    var windowId: UInt32?
    if protectedFound { screenshot = ["status":"excluded", "reason":"protected_input"] }
    else {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly:true)
            let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
            let expected = window.flatMap { bounds($0) }
            let matches = windows.filter { candidate in
                guard let expected else { return true }
                return abs(candidate.frame.minX - expected.minX) < 2 && abs(candidate.frame.minY - expected.minY) < 2 && abs(candidate.frame.width - expected.width) < 2 && abs(candidate.frame.height - expected.height) < 2
            }
            if matches.count == 1, let target = matches.first {
                windowId = target.windowID
                let config = SCStreamConfiguration()
                config.width = min(1600, Int(target.frame.width)); config.height = max(1, Int(Double(config.width) * target.frame.height / max(1,target.frame.width))); config.showsCursor = false
                // 去掉窗口阴影，让图像边界和窗口 frame 对齐，缩放后也可准确叠加。
                config.ignoreShadowsSingleWindow = true
                let overlayBefore = probeFocusRegions(application)
                let overlayWindowBefore = window.flatMap { bounds($0) }
                if overlayBefore.protected { screenshot = ["status":"excluded","reason":"protected_focus_changed"] }
                else {
                    let image = try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:target), configuration:config)
                    let overlayAfter = probeFocusRegions(application)
                    let windowStable = overlayWindowBefore == window.flatMap { bounds($0) } && overlayWindowBefore == expected
                    let stable = stableFocusRegions(overlayBefore,overlayAfter) && windowStable
                    let noFocus = overlayBefore.element == nil && overlayAfter.element == nil
                    let regions: [String:Any] = stable || noFocus ? overlayBefore.regions : ["focus":["status":"unavailable","reason":"focus_or_selection_or_window_changed"],"selection":["status":"unavailable","reason":"focus_or_selection_or_window_changed"]]
                    if overlayAfter.protected { screenshot = ["status":"excluded","reason":"protected_focus_changed"] }
                    else if let png = NSBitmapImageRep(cgImage:image).representation(using:.png, properties:[:]) {
                        screenshot = ["status":"captured", "data":png.base64EncodedString(), "selection":expected == nil ? "single_window_fallback" : "ax_bounds", "capturedAt":iso(),"frame":regionRect(target.frame),"pixelWidth":image.width,"pixelHeight":image.height,"coordinateSpace":"screen_top_left_points","shadowsExcluded":true,"regions":regions]
                    }
                }
            } else { screenshot = ["status":"unavailable", "reason":"window_match_ambiguous_or_missing", "candidates":matches.count] }
        } catch { screenshot = ["status":"error", "code":(error as NSError).code] }
    }
    if requireForeground {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { return ["error":"foreground_changed_during_capture"] }
        if let window, let current = attribute(application,kAXFocusedWindowAttribute), CFGetTypeID(current) == AXUIElementGetTypeID(), !CFEqual(window,current) { return ["error":"window_changed_during_capture"] }
    }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
    return ["captureSchema":2,"appLaunchedAt":app.launchDate.map { formatter.string(from:$0) } ?? "","windowId":windowId as Any? ?? NSNull(),"pid":Int(pid), "app":app.localizedName ?? "", "bundleId":app.bundleIdentifier ?? "", "capturedAt":formatter.string(from:began), "elapsedMs":Int(Date().timeIntervalSince(began)*1000), "nodes":nodes, "partial":partial, "limits":["nodes":800,"depth":20,"milliseconds":3000,"textCharacters":8000], "windowCode":windowError.rawValue, "focusCode":focusError.rawValue, "focusId":focus.map { identifier($0) } as Any? ?? NSNull(), "permissions":permissions(), "screenshot":screenshot]
}
