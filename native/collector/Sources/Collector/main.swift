import AppKit
import ApplicationServices
import ScreenCaptureKit
import Vision
import ImageIO

// stdout 只承载逐行协议，采集必须收到显式 start。
let outputLock = NSLock()
func emit(_ value: [String: Any]) { outputLock.lock(); defer { outputLock.unlock() }; if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) } }
func iso() -> String { ISO8601DateFormatter().string(from: Date()) }
func permissions() -> [String: Bool] { ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "inputMonitoring": CGPreflightListenEventAccess()] }
// 先确认收到命令，再在主线程发起系统授权，避免用户响应弹窗期间触发协议超时。
func requestPermission(_ name: String) {
    DispatchQueue.main.async {
        let pane: String
        switch name {
        case "accessibility":
            _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            pane = "Privacy_Accessibility"
        case "screenRecording":
            _ = CGRequestScreenCaptureAccess()
            pane = "Privacy_ScreenCapture"
        case "inputMonitoring":
            _ = CGRequestListenEventAccess()
            pane = "Privacy_ListenEvent"
        default: return
        }
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
        emit(["type":"permissions","permissions":permissions()])
    }
}
func bounds(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element,kAXPositionAttribute), let size = attribute(element,kAXSizeAttribute), CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var extent = CGSize.zero
    guard AXValueGetValue(position as! AXValue,.cgPoint,&point), AXValueGetValue(size as! AXValue,.cgSize,&extent) else { return nil }
    return CGRect(origin:point,size:extent)
}
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? { var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil }
// 可变控制状态仅主线程访问；跨线程缓存由独立锁保护。后台捕获只读取局部不可变参数。
final class Collector: @unchecked Sendable {
    struct CachedFrame { let pid: pid_t; let windowId: CGWindowID; let frame: CGRect; let png: Data; let capturedAt: String; let captured: Date; let sourceActionId: String }
    let cacheLock = NSLock(); var cache: CachedFrame?
    func saveCache(_ value: CachedFrame) { cacheLock.lock(); cache = value; cacheLock.unlock() }
    func before(_ id: String, pid: pid_t, point: CGPoint?, expectedBounds: CGRect) {
        cacheLock.lock(); let cached = cache; cacheLock.unlock()
        guard let cached, cached.pid == pid, cached.frame == expectedBounds, Date().timeIntervalSince(cached.captured) <= 2, point.map({cached.frame.contains($0)}) ?? true else { emit(["type":"artifact","action_id":id,"kind":"screenshot","slot":"screenshot_before","status":"unavailable","capturedAt":iso(),"reason":"no_matching_recent_before_frame"]); return }
        emit(["type":"artifact","action_id":id,"kind":"screenshot","slot":"screenshot_before","status":"shared","capturedAt":cached.capturedAt,"bytes":cached.png.base64EncodedString(),"metadata":["mime_type":"image/png","phase":"before","window_id":cached.windowId,"source_action_id":cached.sourceActionId,"selection":"recent_same_pid_and_ax_window_bounds_cache","overlay_supported":false]])
    }

    var tap: CFMachPort?; var source: CFRunLoopSource?; var sequence: UInt64 = 0
    let epoch = UUID().uuidString; var session = UUID().uuidString; var allowed = Set<String>(); var busy = false; var suspended = false
    let worker = DispatchQueue(label: "proactive.capture"); var activation: NSObjectProtocol?; var observer: AXObserver?; var observedRoot: AXUIElement?; var systemObservers = [NSObjectProtocol]()
    func stop() { cacheLock.lock(); cache = nil; cacheLock.unlock(); if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),.commonModes) }; observer = nil; observedRoot = nil; for token in systemObservers { NSWorkspace.shared.notificationCenter.removeObserver(token) }; systemObservers.removeAll(); if let tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }; tap = nil; if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }; source = nil; if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }; activation = nil; emit(["type":"status","state":"stopped"]) }
    var allApps = false
    // 所有应用模式只跟随前台窗口；空白名单仍需显式选择所有应用才可启动。
    func allows(_ app: NSRunningApplication) -> Bool { app.processIdentifier != getpid() && app.processIdentifier != getppid() && app.bundleIdentifier != "io.github.hedgeho9x.proactive-agent" && (allApps || allowed.contains(app.bundleIdentifier ?? "")) }
    func start(_ bundles: [String], allApps: Bool = false) {
        guard tap == nil else { return }; allowed = Set(bundles)
        self.allApps = allApps
        guard allApps || !allowed.isEmpty, permissions().values.allSatisfy({$0}) else { emit(["type":"status","state":"unavailable","reason":"permissions_or_allowlist_missing","permissions":permissions()]); return }
        session = UUID().uuidString
        let types: [CGEventType] = [.leftMouseDown,.leftMouseUp,.rightMouseDown,.rightMouseUp,.otherMouseDown,.otherMouseUp,.leftMouseDragged,.rightMouseDragged,.otherMouseDragged,.keyDown,.keyUp,.flagsChanged,.scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, info in
            if let info { Unmanaged<Collector>.fromOpaque(info).takeUnretainedValue().receive(type, event) }; return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap else { emit(["type":"status","state":"unavailable","reason":"event_tap_unavailable"]); return }
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0); CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes); CGEvent.tapEnable(tap: tap, enable: true)
        activation = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.attachAX(); self?.record("app_activated", input: [:], point: nil) }
        attachAX()
        for notification in [NSWorkspace.willSleepNotification,NSWorkspace.didWakeNotification,NSWorkspace.sessionDidResignActiveNotification,NSWorkspace.sessionDidBecomeActiveNotification] {
            systemObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName:notification,object:nil,queue:.main) { [weak self] note in self?.suspended = note.name == NSWorkspace.willSleepNotification || note.name == NSWorkspace.sessionDidResignActiveNotification; self?.record("system_state",input:["notification":note.name.rawValue],point:nil) })
        }
        emit(["type":"status","state":"running","permissions":permissions()])
    }
    func attachAX() {
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),.commonModes) }; observer = nil
        guard let app = NSWorkspace.shared.frontmostApplication, allows(app) else { return }
        let root = AXUIElementCreateApplication(app.processIdentifier); observedRoot = root
        let result = AXObserverCreate(app.processIdentifier, { _, _, notification, info in
            if let info { Unmanaged<Collector>.fromOpaque(info).takeUnretainedValue().record("ax_notification",input:["notification":notification as String],point:nil) }
        }, &observer)
        guard result == .success, let observer else { emit(["type":"capability","name":"ax_observer","status":"unavailable","code":result.rawValue]); return }
        var coverage = [[String:Any]]()
        for name in [kAXFocusedWindowChangedNotification,kAXFocusedUIElementChangedNotification,kAXWindowCreatedNotification,kAXUIElementDestroyedNotification,kAXTitleChangedNotification,kAXValueChangedNotification,kAXSelectedTextChangedNotification] {
            let result = AXObserverAddNotification(observer,root,name as CFString,Unmanaged.passUnretained(self).toOpaque())
            coverage.append(["notification":name,"result":result.rawValue])
        }
        CFRunLoopAddSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),.commonModes)
        emit(["type":"capability","name":"ax_observer","subscriptions":coverage])
    }
    func receive(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { emit(["type":"status","state":"unavailable","reason":"event_tap_disabled"]); return }
        let kind: String
        switch type { case .keyDown: kind = "key_down"; case .keyUp: kind = "key_up"; case .flagsChanged: kind = "modifiers_changed"; case .scrollWheel: kind = "scroll"; case .leftMouseDown,.rightMouseDown,.otherMouseDown: kind = "mouse_down"; case .leftMouseUp,.rightMouseUp,.otherMouseUp: kind = "mouse_up"; default: kind = "drag" }
        var input: [String: Any] = ["modifiers": String(event.flags.rawValue)]
        if kind.hasPrefix("key") { let code = event.getIntegerValueField(.keyboardEventKeycode); let special: [Int64:String] = [36:"Enter",48:"Tab",49:"Space",53:"Escape"]; input["key_category"] = special[code] == nil ? "ordinary" : "special"; input["key_name"] = special[code]; input["repeat"] = event.getIntegerValueField(.keyboardEventAutorepeat) != 0 }
        else { input["x"] = event.location.x; input["y"] = event.location.y; input["button"] = event.getIntegerValueField(.mouseEventButtonNumber); input["click_count"] = event.getIntegerValueField(.mouseEventClickState); if kind == "scroll" { input["delta_y"] = event.getIntegerValueField(.scrollWheelEventDeltaAxis1); input["delta_x"] = event.getIntegerValueField(.scrollWheelEventDeltaAxis2); input["phase"] = event.getIntegerValueField(.scrollWheelEventScrollPhase); input["momentum"] = event.getIntegerValueField(.scrollWheelEventMomentumPhase) } }
        record(kind, input: input, point: kind.hasPrefix("mouse") ? event.location : nil)
    }
    func record(_ kind: String, input: [String:Any], point: CGPoint?) {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        // 自身窗口操作不进入证据流水，避免拖动和输入在观察界面刷屏。
        guard app.processIdentifier != getpid(), app.processIdentifier != getppid(), app.bundleIdentifier != "io.github.hedgeho9x.proactive-agent" else { return }
        sequence += 1; let id = UUID().uuidString; let time = iso(); let permitted = !suspended && allows(app)
        emit(["type":"action","action":["schema_version":"1","action_id":id,"capture_session_id":session,"collector_epoch":epoch,"source_sequence":String(sequence),"occurred_at":time,"received_at":time,"monotonic_ns":String(DispatchTime.now().uptimeNanoseconds),"timezone":TimeZone.current.identifier,"kind":kind,"actor":"unknown","origin":"native_observation","trust_class":"untrusted_observation","app":["pid":app.processIdentifier,"bundle_id":app.bundleIdentifier ?? "","name":app.localizedName ?? ""],"input":input,"policy_status":permitted ? "allowed":"excluded","reason_codes":permitted ? []:["app_not_allowlisted"]]])
        if !permitted { emit(["type":"artifact","action_id":id,"kind":"screenshot","slot":"screenshot_before","status":"excluded","capturedAt":time,"reason":"app_not_allowlisted"]) }
        guard permitted else { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id, kind, "excluded", "app_not_allowlisted") }; return }
        guard !busy else { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id, kind, "dropped_by_backpressure", "heavy_capture_busy") }; return }
        busy = true
        worker.async { self.capture(id, app.processIdentifier, point: point) }
    }
    func missing(_ id: String, _ kind: String, _ status: String, _ reason: String) { emit(["type":"artifact","action_id":id,"kind":kind == "screenshot_before" ? "screenshot" : kind,"slot":kind,"status":status,"capturedAt":iso(),"reason":reason]) }
    func capture(_ id: String, _ pid: pid_t, point: CGPoint?) {
        let started = iso(); let application = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(application, 0.025)
        guard let windowValue = attribute(application,kAXFocusedWindowAttribute), CFGetTypeID(windowValue) == AXUIElementGetTypeID() else { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id,kind,"unavailable","focused_window_unavailable") }; DispatchQueue.main.async { self.busy = false }; return }
        let root = windowValue as! AXUIElement; AXUIElementSetMessagingTimeout(root,0.025)
        guard let windowBounds = bounds(root) else { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id,kind,"unavailable","focused_window_bounds_unavailable") }; DispatchQueue.main.async { self.busy = false }; return }
        var target: AXUIElement?; if let point { AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &target) }
        let focus = attribute(application,kAXFocusedUIElementAttribute) as! AXUIElement?
        if let focus, attribute(focus,kAXSubroleAttribute) as? String == "AXSecureTextField" { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id,kind,"excluded","protected_input") }; DispatchQueue.main.async { self.busy = false }; return }
        if let target { var targetPid: pid_t = 0; AXUIElementGetPid(target,&targetPid); if targetPid != pid { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id,kind,"unavailable","clicked_background_process_requires_separate_snapshot") }; DispatchQueue.main.async { self.busy = false }; return } }
        var nodes = [[String:Any]](); var truncated = false; let deadline = Date().addingTimeInterval(0.35)
        func visit(_ element: AXUIElement, parent: String?, depth: Int) { guard nodes.count < 250 && depth < 12 && Date() < deadline else { truncated = true; return }; let nodeId = String(nodes.count); let secure = attribute(element,kAXSubroleAttribute) as? String == "AXSecureTextField"; var node: [String:Any] = ["node_id":nodeId,"parent_id":parent as Any? ?? NSNull(),"role":attribute(element,kAXRoleAttribute) as? String ?? "unknown","focused":focus.map { CFEqual($0,element) } ?? false,"clicked":target.map { CFEqual($0,element) } ?? false,"protected":secure]; if !secure { node["title"] = attribute(element,kAXTitleAttribute) as? String; if let value = attribute(element,kAXValueAttribute) as? String { node["value"] = String(value.prefix(4000)) } }; nodes.append(node); for child in attribute(element,kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child,parent:nodeId,depth:depth+1); if Date() >= deadline { break } } }
        visit(root,parent:nil,depth:0)
        // 命中目标即使在预算外也单独保存，不用前台应用替代命中进程。
        if let target, !nodes.contains(where: {$0["clicked"] as? Bool == true}) { var targetPid: pid_t = 0; AXUIElementGetPid(target,&targetPid); nodes.append(["node_id":"target","parent_id":NSNull(),"role":attribute(target,kAXRoleAttribute) as? String ?? "unknown","clicked":true,"pid":targetPid]) }
        if nodes.contains(where: {$0["protected"] as? Bool == true}) { for kind in ["ax","screenshot","ocr","screenshot_before"] { missing(id,kind,"excluded","protected_node_in_window") }; DispatchQueue.main.async { self.busy = false }; return }
        before(id,pid:pid,point:point,expectedBounds:windowBounds)
        let stable = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
        emit(["type":"artifact","action_id":id,"kind":"ax","status":"captured","capturedAt":iso(),"payload":["nodes":nodes,"coverage":["started_at":started,"ended_at":iso(),"visited":nodes.count,"total":NSNull(),"partial":truncated,"target_pid":pid,"stable":stable]]])
        guard stable else { missing(id,"screenshot","unavailable","foreground_changed"); missing(id,"ocr","unavailable","no_source_screenshot"); DispatchQueue.main.async { self.busy = false }; return }
        Task { var screenshotEmitted = false; defer { DispatchQueue.main.async { self.busy = false } }; do {
            let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
            let matches = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && abs($0.frame.minX-windowBounds.minX)<2 && abs($0.frame.minY-windowBounds.minY)<2 && abs($0.frame.width-windowBounds.width)<2 && abs($0.frame.height-windowBounds.height)<2 }
            guard matches.count == 1, let window = matches.first else { throw NSError(domain:"focused_window_match_ambiguous_or_missing",code:1) }
            guard let currentWindowValue = attribute(application,kAXFocusedWindowAttribute), CFGetTypeID(currentWindowValue) == AXUIElementGetTypeID(), CFEqual(currentWindowValue,root) else { throw NSError(domain:"focused_window_changed",code:2) }
            let filter = SCContentFilter(desktopIndependentWindow:window); let config = SCStreamConfiguration(); config.width = Int(window.frame.width * 2); config.height = Int(window.frame.height * 2); config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter:filter,configuration:config)
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, let finalWindow = attribute(application,kAXFocusedWindowAttribute), CFEqual(finalWindow,root), bounds(root) == windowBounds else { throw NSError(domain:"foreground_or_window_changed",code:2) }
            if let finalFocus = attribute(application,kAXFocusedUIElementAttribute), CFGetTypeID(finalFocus) == AXUIElementGetTypeID(), attribute(finalFocus as! AXUIElement,kAXSubroleAttribute) as? String == "AXSecureTextField" { throw NSError(domain:"protected_focus_changed",code:4) }
            let rep = NSBitmapImageRep(cgImage:image); guard let png = rep.representation(using:.png,properties:[:]) else { throw NSError(domain:"png",code:3) }
            let screenshotTime = iso()
            saveCache(CachedFrame(pid:pid,windowId:window.windowID,frame:window.frame,png:png,capturedAt:screenshotTime,captured:Date(),sourceActionId:id))
            emit(["type":"artifact","action_id":id,"kind":"screenshot","status":"captured","capturedAt":screenshotTime,"bytes":png.base64EncodedString(),"metadata":["mime_type":"image/png","window_id":window.windowID,"width":image.width,"height":image.height,"phase":"after","selection":"unique_ax_focused_window_bounds_match","overlay_supported":false]])
            screenshotEmitted = true
            let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate; request.recognitionLanguages = ["en-US","zh-Hans"]; try VNImageRequestHandler(cgImage:image).perform([request]); let blocks = (request.results ?? []).compactMap { result -> [String:Any]? in guard let candidate = result.topCandidates(1).first else { return nil }; return ["text":candidate.string,"confidence":candidate.confidence,"bounds":[result.boundingBox.origin.x,result.boundingBox.origin.y,result.boundingBox.width,result.boundingBox.height]] }
            emit(["type":"artifact","action_id":id,"kind":"ocr","status":"captured","capturedAt":iso(),"payload":["blocks":blocks,"engine":"Apple Vision","coordinate_space":"normalized_bottom_left"]])
        } catch { if !screenshotEmitted { missing(id,"screenshot","unavailable",String(describing:error)) }; missing(id,"ocr","unavailable","capture_or_ocr_failed") } }
    }
}
if CommandLine.arguments.contains("--prepare-evidence") { prepareEvidence(); exit(0) }
if CommandLine.arguments.contains("--inspect-apps") { emit(["apps":inspectorApps()]); exit(0) }
if CommandLine.arguments.contains("--inspect-stream") {
    _ = NSApplication.shared
    DispatchQueue.global().async {
        while let line = readLine() {
            guard let data = line.data(using:.utf8), let message = try? JSONSerialization.jsonObject(with:data) as? [String:Any], let event = message["event"] as? [String:Any], let pid = event["pid"] as? Int32, let requestId = message["requestId"] as? String else { continue }
            Task {
                let result = await inspectAX(pid,trigger:event,progress:{ value in emit(["type":"inspection_progress","progressFor":requestId,"progress":value]) })
                emit(["type":"inspection_progress","progressFor":requestId,"progress":["component":"response","stage":"result_serialization","state":"running"]])
                emit(["type":"inspection","requestId":requestId,"result":result])
            }
        }
        exit(0)
    }
    emit(["type":"inspector_ready"])
    RunLoop.main.run();exit(0)
}
if CommandLine.arguments.contains("--watch-input") {
    _ = NSApplication.shared
    let watcher = InputWatch(); watcher.start()
    // 父进程退出或停止时关闭 stdin，避免孤儿监听进程继续记录。
    DispatchQueue.global().async { while readLine() != nil {} ; exit(0) }
    RunLoop.main.run(); exit(0)
}
if let index = CommandLine.arguments.firstIndex(of:"--inspect"), CommandLine.arguments.count > index + 1, let pid = Int32(CommandLine.arguments[index + 1]) {
    // 一次性命令也需初始化 AppKit 的窗口服务连接，供 ScreenCaptureKit 使用。
    _ = NSApplication.shared
    Task { emit(await inspectAX(pid)); exit(0) }
    RunLoop.main.run()
    exit(0)
}
let collector = Collector()
DispatchQueue.global().async { while let line = readLine() { guard let data = line.data(using:.utf8), let command = try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { continue }; DispatchQueue.main.async { switch command["command"] as? String { case "permissions": emit(["type":"permissions","permissions":permissions()]); case "permission.request": requestPermission(command["permission"] as? String ?? ""); case "start": collector.start(command["allowedBundleIds"] as? [String] ?? [], allApps: command["allApps"] as? Bool ?? false); case "stop": collector.stop(); case "shutdown": collector.stop(); exit(0); default: emit(["type":"error","reason":"unknown_command"]) }; if let requestId = command["request_id"] as? String { emit(["type":"ack","request_id":requestId]) } } }; DispatchQueue.main.async { collector.stop(); exit(0) } }
emit(["type":"status","state":"stopped"])
RunLoop.main.run()
