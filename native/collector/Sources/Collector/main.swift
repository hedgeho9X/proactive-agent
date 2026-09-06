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
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? { var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil }
final class Collector {
    var tap: CFMachPort?; var source: CFRunLoopSource?; var sequence: UInt64 = 0
    let epoch = UUID().uuidString; var session = UUID().uuidString; var allowed = Set<String>(); var busy = false
    let worker = DispatchQueue(label: "proactive.capture"); var activation: NSObjectProtocol?
    func stop() { if let tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }; tap = nil; if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }; source = nil; if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }; activation = nil; emit(["type":"status","state":"stopped"]) }
    func start(_ bundles: [String]) {
        guard tap == nil else { return }; allowed = Set(bundles)
        guard !allowed.isEmpty, permissions().values.allSatisfy({$0}) else { emit(["type":"status","state":"unavailable","reason":"permissions_or_allowlist_missing","permissions":permissions()]); return }
        session = UUID().uuidString
        let types: [CGEventType] = [.leftMouseDown,.leftMouseUp,.rightMouseDown,.rightMouseUp,.otherMouseDown,.otherMouseUp,.leftMouseDragged,.rightMouseDragged,.otherMouseDragged,.keyDown,.keyUp,.flagsChanged,.scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, info in
            if let info { Unmanaged<Collector>.fromOpaque(info).takeUnretainedValue().receive(type, event) }; return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap else { emit(["type":"status","state":"unavailable","reason":"event_tap_unavailable"]); return }
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0); CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes); CGEvent.tapEnable(tap: tap, enable: true)
        activation = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.record("app_activated", input: [:], point: nil) }
        emit(["type":"status","state":"running","permissions":permissions()])
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
        sequence += 1; let id = UUID().uuidString; let time = iso(); let permitted = allowed.contains(app.bundleIdentifier ?? "")
        emit(["type":"action","action":["schema_version":"1","action_id":id,"capture_session_id":session,"collector_epoch":epoch,"source_sequence":String(sequence),"occurred_at":time,"received_at":time,"monotonic_ns":String(DispatchTime.now().uptimeNanoseconds),"timezone":TimeZone.current.identifier,"kind":kind,"actor":"unknown","origin":"native_observation","trust_class":"untrusted_observation","app":["pid":app.processIdentifier,"bundle_id":app.bundleIdentifier ?? "","name":app.localizedName ?? ""],"input":input,"policy_status":permitted ? "allowed":"excluded","reason_codes":permitted ? []:["app_not_allowlisted"]]])
        guard permitted else { for kind in ["ax","screenshot","ocr"] { missing(id, kind, "excluded", "app_not_allowlisted") }; return }
        guard !busy else { for kind in ["ax","screenshot","ocr"] { missing(id, kind, "dropped_by_backpressure", "heavy_capture_busy") }; return }
        busy = true
        worker.async { self.capture(id, app.processIdentifier, point: point) }
    }
    func missing(_ id: String, _ kind: String, _ status: String, _ reason: String) { emit(["type":"artifact","action_id":id,"kind":kind,"status":status,"capturedAt":iso(),"reason":reason]) }
    func capture(_ id: String, _ pid: pid_t, point: CGPoint?) {
        let started = iso(); let root = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(root, 0.05)
        var target: AXUIElement?; if let point { AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &target) }
        let focus = attribute(root,kAXFocusedUIElementAttribute) as! AXUIElement?
        if let focus, attribute(focus,kAXSubroleAttribute) as? String == "AXSecureTextField" { for kind in ["ax","screenshot","ocr"] { missing(id,kind,"excluded","protected_input") }; DispatchQueue.main.async { self.busy = false }; return }
        var nodes = [[String:Any]](); var truncated = false; let deadline = Date().addingTimeInterval(0.35)
        func visit(_ element: AXUIElement, parent: String?, depth: Int) { guard nodes.count < 250 && depth < 12 && Date() < deadline else { truncated = true; return }; let nodeId = String(nodes.count); let secure = attribute(element,kAXSubroleAttribute) as? String == "AXSecureTextField"; var node: [String:Any] = ["node_id":nodeId,"parent_id":parent as Any? ?? NSNull(),"role":attribute(element,kAXRoleAttribute) as? String ?? "unknown","focused":focus.map { CFEqual($0,element) } ?? false,"clicked":target.map { CFEqual($0,element) } ?? false,"protected":secure]; if !secure { node["title"] = attribute(element,kAXTitleAttribute) as? String; if let value = attribute(element,kAXValueAttribute) as? String { node["value"] = String(value.prefix(4000)) } }; nodes.append(node); for child in attribute(element,kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child,parent:nodeId,depth:depth+1); if Date() >= deadline { break } } }
        visit(root,parent:nil,depth:0)
        // 命中目标即使在预算外也单独保存，不用前台应用替代命中进程。
        if let target, !nodes.contains(where: {$0["clicked"] as? Bool == true}) { var targetPid: pid_t = 0; AXUIElementGetPid(target,&targetPid); nodes.append(["node_id":"target","parent_id":NSNull(),"role":attribute(target,kAXRoleAttribute) as? String ?? "unknown","clicked":true,"pid":targetPid]) }
        if nodes.contains(where: {$0["protected"] as? Bool == true}) { for kind in ["ax","screenshot","ocr"] { missing(id,kind,"excluded","protected_node_in_window") }; DispatchQueue.main.async { self.busy = false }; return }
        let stable = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
        emit(["type":"artifact","action_id":id,"kind":"ax","status":"captured","capturedAt":iso(),"payload":["nodes":nodes,"coverage":["started_at":started,"ended_at":iso(),"visited":nodes.count,"total":NSNull(),"partial":truncated,"target_pid":pid,"stable":stable]]])
        guard stable else { missing(id,"screenshot","unavailable","foreground_changed"); missing(id,"ocr","unavailable","no_source_screenshot"); DispatchQueue.main.async { self.busy = false }; return }
        Task { defer { DispatchQueue.main.async { self.busy = false } }; do {
            let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
            guard let window = content.windows.first(where: {$0.owningApplication?.processID == pid && $0.windowLayer == 0}) else { throw NSError(domain:"no_window",code:1) }
            let filter = SCContentFilter(desktopIndependentWindow:window); let config = SCStreamConfiguration(); config.width = Int(window.frame.width * 2); config.height = Int(window.frame.height * 2); config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter:filter,configuration:config)
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { throw NSError(domain:"foreground_changed",code:2) }
            let rep = NSBitmapImageRep(cgImage:image); guard let png = rep.representation(using:.png,properties:[:]) else { throw NSError(domain:"png",code:3) }
            emit(["type":"artifact","action_id":id,"kind":"screenshot","status":"captured","capturedAt":iso(),"bytes":png.base64EncodedString(),"metadata":["mime_type":"image/png","window_id":window.windowID,"width":image.width,"height":image.height,"phase":"after","selection":"first_on_screen_window_for_pid","overlay_supported":false]])
            let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate; request.recognitionLanguages = ["en-US","zh-Hans"]; try VNImageRequestHandler(cgImage:image).perform([request]); let blocks = (request.results ?? []).compactMap { result -> [String:Any]? in guard let candidate = result.topCandidates(1).first else { return nil }; return ["text":candidate.string,"confidence":candidate.confidence,"bounds":[result.boundingBox.origin.x,result.boundingBox.origin.y,result.boundingBox.width,result.boundingBox.height]] }
            emit(["type":"artifact","action_id":id,"kind":"ocr","status":"captured","capturedAt":iso(),"payload":["blocks":blocks,"engine":"Apple Vision","coordinate_space":"normalized_bottom_left"]])
        } catch { missing(id,"screenshot","unavailable",String(describing:error)); missing(id,"ocr","unavailable","capture_or_ocr_failed") } }
    }
}
let collector = Collector()
DispatchQueue.global().async { while let line = readLine() { guard let data = line.data(using:.utf8), let command = try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { continue }; DispatchQueue.main.async { switch command["command"] as? String { case "permissions": emit(["type":"permissions","permissions":permissions()]); case "start": collector.start(command["allowedBundleIds"] as? [String] ?? []); case "stop": collector.stop(); case "shutdown": collector.stop(); exit(0); default: emit(["type":"error","reason":"unknown_command"]) }; if let requestId = command["request_id"] as? String { emit(["type":"ack","request_id":requestId]) } } }; DispatchQueue.main.async { collector.stop(); exit(0) } }
emit(["type":"status","state":"stopped"])
RunLoop.main.run()
