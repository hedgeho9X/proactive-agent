import AppKit
import ApplicationServices

// 监听只输出事件元数据，AX 遍历由宿主独立触发，不阻塞系统输入回调。
final class InputWatch {
    var tap: CFMachPort?
    var source: CFRunLoopSource?
    let session = UUID().uuidString
    var sequence = 0
    func start() {
        guard CGPreflightListenEventAccess() else { emit(["type":"watch_error","reason":"input_monitoring_required"]); exit(1) }
        let types: [CGEventType] = [.keyDown,.leftMouseUp,.rightMouseUp,.otherMouseUp]
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
    }
    func receive(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { emit(["type":"watch_error","reason":"event_tap_disabled"]); exit(1) }
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getppid(), app.processIdentifier != getpid(), app.bundleIdentifier != "io.github.hedgeho9x.proactive-agent" else { return }
        let keyNames: [Int64:String] = [0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",28:"8",29:"0",30:"]",31:"O",32:"U",33:"[",34:"I",35:"P",36:"Enter",37:"L",38:"J",39:"Quote",40:"K",41:";",42:"Backslash",43:",",44:"/",45:"N",46:"M",47:".",48:"Tab",49:"Space",50:"Backquote",51:"Backspace",53:"Escape",55:"Command",56:"Shift",57:"CapsLock",58:"Option",59:"Control",60:"RightShift",61:"RightOption",62:"RightControl",63:"Fn",76:"NumpadEnter",96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",101:"F9",103:"F11",109:"F10",111:"F12",115:"Home",116:"PageUp",117:"Delete",118:"F4",119:"End",120:"F2",121:"PageDown",122:"F1",123:"Left",124:"Right",125:"Down",126:"Up"]
        let keyboard = type == .keyDown || type == .keyUp || type == .flagsChanged
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        var modifiers = [String]()
        for (flag,name) in [(CGEventFlags.maskCommand,"Cmd"),(.maskShift,"Shift"),(.maskAlternate,"Option"),(.maskControl,"Ctrl"),(.maskSecondaryFn,"Fn")] { if event.flags.contains(flag) { modifiers.append(name) } }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        sequence += 1
        var value: [String:Any] = ["id":"ax-" + UUID().uuidString.lowercased(),"session":session,"sequence":sequence,"occurredAt":formatter.string(from:Date()),"monotonicNs":String(event.timestamp),"pid":Int(app.processIdentifier),"app":app.localizedName ?? "","bundleId":app.bundleIdentifier ?? "","appLaunchedAt":app.launchDate.map { formatter.string(from:$0) } ?? "","kind":type == .keyDown ? "key_down" : type == .keyUp ? "key_up" : type == .flagsChanged ? "modifiers_changed" : "click","modifiers":modifiers,"targetBasis":"frontmost_at_event"]
        if keyboard { value["keyCode"] = code; value["key"] = keyNames[code] ?? "Key\(code)"; value["repeat"] = event.getIntegerValueField(.keyboardEventAutorepeat) != 0 }
        else { value["button"] = event.getIntegerValueField(.mouseEventButtonNumber); value["x"] = event.location.x; value["y"] = event.location.y; value["clickCount"] = event.getIntegerValueField(.mouseEventClickState) }
        emit(["type":"input_event","event":value])
    }
}
