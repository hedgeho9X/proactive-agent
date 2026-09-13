/** 监听系统输入并在输出前排除自身操作；重型截图和 AX 遍历交由宿主调度。 */
import AppKit
import ApplicationServices

// 监听只输出事件元数据，AX 遍历由宿主独立触发，不阻塞系统输入回调。
final class InputWatch {
    var tap: CFMachPort?
    var source: CFRunLoopSource?
    let session = UUID().uuidString
    lazy var editing = EditingWatch(session:session)
    var sequence = 0
    func start() {
        guard CGPreflightListenEventAccess() else { emit(["type":"watch_error","reason":"input_monitoring_required"]); exit(1) }
        let types: [CGEventType] = [.keyDown,.leftMouseDown,.rightMouseDown,.otherMouseDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        tap = CGEvent.tapCreate(tap:.cgSessionEventTap,place:.headInsertEventTap,options:.listenOnly,eventsOfInterest:mask,callback:{ _,type,event,info in
            if let info { Unmanaged<InputWatch>.fromOpaque(info).takeUnretainedValue().receive(type,event) }
            return Unmanaged.passUnretained(event)
        },userInfo:Unmanaged.passUnretained(self).toOpaque())
        guard let tap else { emit(["type":"watch_error","reason":"event_tap_unavailable"]); exit(1) }
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0)
        CFRunLoopAddSource(CFRunLoopGetMain(),source,.commonModes)
        CGEvent.tapEnable(tap:tap,enable:true)
        emit(["type":"watch_ready"])
        editing.start()
    }
    func receive(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { emit(["type":"watch_error","reason":"event_tap_disabled"]); exit(1) }
        var editingActivity = false
        if type == .keyDown {
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            editingActivity = editing.handlesKey(code,flags:event.flags)
            if !shouldRecordKey(code,flags:event.flags) { return }
        }
        if type == .leftMouseDown { editingActivity = editing.handlesClick(event.location) }
        let receivedAt = Date()
        var target = NSWorkspace.shared.frontmostApplication
        var targetBasis = "frontmost_at_event"
        let lookupAt = Date()
        let windows = onscreenCaptureWindows()
        var lockedWindow: CaptureWindowTarget?
        var targetError: String?
        var hitTestPid: pid_t?
        let nativePid = event.getIntegerValueField(.eventTargetUnixProcessID)
        if type != .keyDown {
            // 此事件阶段的 target PID 可能仍是旧前台，只作诊断，不过滤真实点击目标。
            lockedWindow = windows.flatMap { clickedWindow($0,point:event.location) }
            if let window = lockedWindow {
                if let owner = NSRunningApplication(processIdentifier:window.pid) { target = owner; targetBasis = window.source }
                else { lockedWindow = nil; targetError = "clicked_window_owner_unavailable" }
                // 有可读 AX 时交叉核对，透明/点击穿透窗口冲突时明确报错，不猜测。
                let system = AXUIElementCreateSystemWide(); AXUIElementSetMessagingTimeout(system,0.005)
                var hit: AXUIElement?
                if AXUIElementCopyElementAtPosition(system,Float(event.location.x),Float(event.location.y),&hit) == .success, let hit {
                    var actual: pid_t = 0
                    if AXUIElementGetPid(hit,&actual) == .success { hitTestPid = actual }
                    if actual > 0 && actual != window.pid { targetError = "click_window_owner_ambiguous" }
                }
            }
            else { targetError = windows == nil ? "window_server_unavailable":"no_window_at_click" }
            if isOwnClick(windows:windows ?? [],point:event.location,selected:lockedWindow,
                          hitPid:hitTestPid,nativePid:nativePid,ownPid:getppid(),
                          selectedIsDock:target?.bundleIdentifier == "com.apple.dock") { return }
        } else if let app = target {
            let application = AXUIElementCreateApplication(app.processIdentifier); AXUIElementSetMessagingTimeout(application,0.005)
            let focused = attribute(application,kAXFocusedWindowAttribute)
            let frame = focused.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? bounds($0 as! AXUIElement) : nil }
            lockedWindow = windows.flatMap { keyboardWindow($0,pid:app.processIdentifier,focusedBounds:frame) }
            if let window = lockedWindow { targetBasis = window.source }
            else { targetError = windows == nil ? "window_server_unavailable":"keyboard_window_not_found" }
        }
        guard let app = target, app.processIdentifier != getppid(), app.processIdentifier != getpid(), app.bundleIdentifier != "io.github.hedgeho9x.proactive-agent" else { return }
        let keyNames: [Int64:String] = [0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",28:"8",29:"0",30:"]",31:"O",32:"U",33:"[",34:"I",35:"P",36:"Enter",37:"L",38:"J",39:"Quote",40:"K",41:";",42:"Backslash",43:",",44:"/",45:"N",46:"M",47:".",48:"Tab",49:"Space",50:"Backquote",51:"Backspace",53:"Escape",55:"Command",56:"Shift",57:"CapsLock",58:"Option",59:"Control",60:"RightShift",61:"RightOption",62:"RightControl",63:"Fn",76:"NumpadEnter",82:"Numpad0",83:"Numpad1",84:"Numpad2",85:"Numpad3",86:"Numpad4",87:"Numpad5",88:"Numpad6",89:"Numpad7",91:"Numpad8",92:"Numpad9",96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",101:"F9",103:"F11",109:"F10",111:"F12",115:"Home",116:"PageUp",117:"Delete",118:"F4",119:"End",120:"F2",121:"PageDown",122:"F1",123:"Left",124:"Right",125:"Down",126:"Up"]
        let keyboard = type == .keyDown || type == .keyUp || type == .flagsChanged
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        var modifiers = [String]()
        for (flag,name) in [(CGEventFlags.maskCommand,"Cmd"),(.maskShift,"Shift"),(.maskAlternate,"Option"),(.maskControl,"Ctrl"),(.maskSecondaryFn,"Fn")] { if event.flags.contains(flag) { modifiers.append(name) } }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        sequence += 1
        var value: [String:Any] = ["id":"ax-" + UUID().uuidString.lowercased(),"session":session,"sequence":sequence,"occurredAt":formatter.string(from:receivedAt),"monotonicNs":String(event.timestamp),"pid":Int(app.processIdentifier),"app":app.localizedName ?? "","bundleId":app.bundleIdentifier ?? "","appLaunchedAt":app.launchDate.map { formatter.string(from:$0) } ?? "","kind":type == .keyDown ? "key_down" : "click","phase":"down","modifiers":modifiers,"targetBasis":targetBasis]
        if keyboard { value["keyCode"] = code; value["key"] = keyNames[code] ?? "Key\(code)"; value["repeat"] = event.getIntegerValueField(.keyboardEventAutorepeat) != 0 }
        else { value["button"] = event.getIntegerValueField(.mouseEventButtonNumber); value["x"] = event.location.x; value["y"] = event.location.y; value["clickCount"] = event.getIntegerValueField(.mouseEventClickState) }
        value["targetWindow"] = lockedWindow?.json as Any? ?? NSNull()
        value["editingSessionId"] = editing.reference(pid:app.processIdentifier)
        value["editingActivity"] = editingActivity
        value["nativeEventWindowId"] = NSEvent(cgEvent:event)?.windowNumber ?? 0
        value["nativeEventTargetPid"] = nativePid
        value["targetResolution"] = ["status":lockedWindow == nil || targetError != nil ? "failed":"resolved","reason":targetError as Any? ?? NSNull(),"stage":"event_window_lookup","hitTestPid":hitTestPid.map {Int($0)} as Any? ?? NSNull(),"lookupAt":preciseTimestamp(lookupAt),"elapsedMs":Int(Date().timeIntervalSince(lookupAt)*1000)]
        emit(["type":"input_event","event":value])
    }
}
