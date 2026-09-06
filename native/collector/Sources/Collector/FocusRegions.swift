import AppKit
import ApplicationServices

// AX 与 ScreenCaptureKit 的窗口 frame 均使用屏幕左上角坐标，单位为逻辑点。
func regionRect(_ rect: CGRect) -> [String: Double] {
    ["x":rect.minX,"y":rect.minY,"width":rect.width,"height":rect.height]
}
struct FocusRegionProbe {
    let element: AXUIElement?
    let frame: CGRect?
    let range: CFTypeRef?
    let protected: Bool
    let regions: [String: Any]
    var attributes: [String: Any] = [:]
    var sampledAt: Date = Date()
}
func probeFocusRegions(_ application: AXUIElement) -> FocusRegionProbe {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(application,kAXFocusedUIElementAttribute as CFString,&value)
    guard error == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
        return FocusRegionProbe(element:nil,frame:nil,range:nil,protected:false,regions:["focus":["status":"unavailable","code":error.rawValue],"selection":["status":"unavailable","reason":"focus_unavailable"]])
    }
    let element = value as! AXUIElement
    AXUIElementSetMessagingTimeout(element,0.03)
    let secure = attribute(element,kAXSubroleAttribute) as? String == "AXSecureTextField"
    if secure { return FocusRegionProbe(element:element,frame:nil,range:nil,protected:true,regions:["focus":["status":"excluded","reason":"protected_input"],"selection":["status":"excluded","reason":"protected_input"]]) }
    let frame = bounds(element)
    var selection: [String:Any] = ["status":"unavailable"]
    var rangeValue: CFTypeRef?
    let rangeError = AXUIElementCopyAttributeValue(element,kAXSelectedTextRangeAttribute as CFString,&rangeValue)
    if rangeError == .success, let rangeValue, CFGetTypeID(rangeValue) == AXValueGetTypeID(), AXValueGetType(rangeValue as! AXValue) == .cfRange {
        var range = CFRange()
        AXValueGetValue(rangeValue as! AXValue,.cfRange,&range)
        if range.length == 0 { selection = ["status":"no_selection","reason":"caret_only"] }
        else {
            var rectangle: CFTypeRef?
            let result = AXUIElementCopyParameterizedAttributeValue(element,kAXBoundsForRangeParameterizedAttribute as CFString,rangeValue,&rectangle)
            if result == .success, let rectangle, CFGetTypeID(rectangle) == AXValueGetTypeID(), AXValueGetType(rectangle as! AXValue) == .cgRect {
                var rect = CGRect.zero
                AXValueGetValue(rectangle as! AXValue,.cgRect,&rect)
                selection = ["status":"available","rect":regionRect(rect),"range":["location":range.location,"length":range.length],"source":"AXBoundsForRange","shape":"bounding_rectangle"]
            } else { selection = ["status":"unavailable","code":result.rawValue,"reason":"selection_bounds_unavailable"] }
        }
    } else { selection = ["status":"unavailable","code":rangeError.rawValue,"reason":"selected_range_unavailable"] }
    let focus: [String:Any] = frame.map { ["status":"available","rect":regionRect($0),"source":"AXPosition+AXSize"] } ?? ["status":"unavailable","reason":"focus_bounds_unavailable"]
    var probe = FocusRegionProbe(element:element,frame:frame,range:rangeValue,protected:false,regions:["focus":focus,"selection":selection])
    for name in [kAXRoleAttribute,kAXTitleAttribute,kAXIdentifierAttribute,kAXDescriptionAttribute] {
        if let text = attribute(element,name) as? String { probe.attributes[name] = ["status":"ok","value":["text":String(text.prefix(4000)),"truncated":text.count>4000]] }
    }
    if let frame { probe.attributes[kAXPositionAttribute] = ["status":"ok","value":["x":frame.minX,"y":frame.minY]]; probe.attributes[kAXSizeAttribute] = ["status":"ok","value":["width":frame.width,"height":frame.height]] }
    probe.sampledAt = Date()
    return probe
}
func stableFocusControl(_ before: FocusRegionProbe, _ after: FocusRegionProbe) -> Bool {
    guard let a = before.element, let b = after.element, CFEqual(a,b), before.frame == after.frame, !after.protected else { return false }
    return true
}
func stableFocusRegions(_ before: FocusRegionProbe, _ after: FocusRegionProbe) -> Bool {
    guard stableFocusControl(before,after) else { return false }
    let a = before.regions["selection"] as? [String:Any] ?? [:]
    let b = after.regions["selection"] as? [String:Any] ?? [:]
    guard NSDictionary(dictionary:a).isEqual(to:b) else { return false }
    switch (before.range,after.range) {
    case (nil,nil): return true
    case let (a?,b?): return CFEqual(a,b)
    default: return false
    }
}

// 点击命中独立于键盘焦点；只接受属于目标进程的 AX 元素。
func probeClickRegion(_ pid: pid_t, _ trigger: [String:Any]?) -> FocusRegionProbe {
    guard trigger?["kind"] as? String == "click", let x = trigger?["x"] as? Double, let y = trigger?["y"] as? Double else { return FocusRegionProbe(element:nil,frame:nil,range:nil,protected:false,regions:["click":["status":"not_applicable"]]) }
    let system = AXUIElementCreateSystemWide(); AXUIElementSetMessagingTimeout(system,0.015)
    var element: AXUIElement?
    let error = AXUIElementCopyElementAtPosition(system,Float(x),Float(y),&element)
    guard error == .success, let element else { return FocusRegionProbe(element:nil,frame:nil,range:nil,protected:false,regions:["click":["status":"unavailable","reason":"hit_test_failed","code":error.rawValue]]) }
    var actual:pid_t = 0; AXUIElementGetPid(element,&actual)
    guard actual == pid else { return FocusRegionProbe(element:nil,frame:nil,range:nil,protected:false,regions:["click":["status":"unavailable","reason":"hit_target_changed"]]) }
    AXUIElementSetMessagingTimeout(element,0.015)
    let secure = attribute(element,kAXSubroleAttribute) as? String == "AXSecureTextField"
    let frame = secure ? nil : bounds(element)
    var probe = FocusRegionProbe(element:element,frame:frame,range:nil,protected:secure,regions:["click":frame.map { ["status":"available","rect":regionRect($0),"source":"AXHitTest"] } ?? ["status":secure ? "excluded":"unavailable","reason":secure ? "protected_input":"hit_bounds_unavailable"]])
    if !secure { for name in [kAXRoleAttribute,kAXTitleAttribute,kAXIdentifierAttribute] { if let text = attribute(element,name) as? String { probe.attributes[name] = ["status":"ok","value":["text":String(text.prefix(4000))]] } } }
    probe.sampledAt = Date()
    return probe
}
