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
    return FocusRegionProbe(element:element,frame:frame,range:rangeValue,protected:false,regions:["focus":focus,"selection":selection])
}
func stableFocusRegions(_ before: FocusRegionProbe, _ after: FocusRegionProbe) -> Bool {
    guard let a = before.element, let b = after.element, CFEqual(a,b), before.frame == after.frame, !after.protected else { return false }
    guard NSDictionary(dictionary:before.regions).isEqual(to:after.regions) else { return false }
    switch (before.range,after.range) {
    case (nil,nil): return true
    case let (a?,b?): return CFEqual(a,b)
    default: return false
    }
}
