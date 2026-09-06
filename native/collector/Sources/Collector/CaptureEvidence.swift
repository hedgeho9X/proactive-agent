import AppKit
import ScreenCaptureKit
import ApplicationServices

func preciseTimestamp(_ date: Date = Date()) -> String {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
    return formatter.string(from:date)
}
struct CapturedEvidence {
    var screenshot: [String:Any]
    var focus: FocusRegionProbe?
    var click: FocusRegionProbe?
    var windowId: UInt32?
}
// 与 AX 全树遍历并行执行，截图不再等待整棵树返回。
func captureEventEvidence(_ pid: pid_t, trigger: [String:Any]?, requested: @Sendable () -> Void = {}) async -> CapturedEvidence {
    var result = CapturedEvidence(screenshot:["status":"unavailable"])
    let application = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(application,0.015)
    let firstClick = probeClickRegion(pid,trigger)
    let windowValue = firstClick.element.flatMap { attribute($0,kAXWindowAttribute) } ?? attribute(application,kAXFocusedWindowAttribute)
    let window = windowValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    let expected = window.flatMap { bounds($0) }
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
        let candidates = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
        let matches = candidates.filter { candidate in
            guard let expected else { return true }
            return abs(candidate.frame.minX-expected.minX)<2 && abs(candidate.frame.minY-expected.minY)<2 && abs(candidate.frame.width-expected.width)<2 && abs(candidate.frame.height-expected.height)<2
        }
        guard matches.count == 1, let target = matches.first else { result.screenshot = ["status":"unavailable","reason":"window_match_ambiguous_or_missing","candidates":matches.count]; return result }
        result.windowId = target.windowID
        let focusBefore = probeFocusRegions(application), clickBefore = probeClickRegion(pid,trigger)
        result.focus = focusBefore; result.click = clickBefore
        let sampledAt = preciseTimestamp()
        guard !focusBefore.protected, !clickBefore.protected else { result.screenshot = ["status":"excluded","reason":"protected_input"]; return result }
        let config = SCStreamConfiguration(); config.width = min(1600,Int(target.frame.width));config.height = max(1,Int(Double(config.width)*target.frame.height/max(1,target.frame.width)));config.showsCursor = false;config.ignoreShadowsSingleWindow = true
        let requestTime = Date()
        requested()
        let image = try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:target),configuration:config)
        let completeTime = Date()
        let focusAfter = probeFocusRegions(application), clickAfter = probeClickRegion(pid,trigger)
        guard !focusAfter.protected, !clickAfter.protected else { result.screenshot = ["status":"excluded","reason":"protected_input"];return result }
        let windowStable = expected == window.flatMap { bounds($0) }
        var regions = focusBefore.regions
        if !windowStable {
            regions = ["focus":["status":"unavailable","reason":"window_bounds_changed"],"selection":["status":"unavailable","reason":"window_bounds_changed"],"click":["status":"unavailable","reason":"window_bounds_changed"]]
        } else {
            if !stableFocusControl(focusBefore,focusAfter), focusBefore.element != nil { regions["focus"] = ["status":"unavailable","reason":"focus_or_bounds_changed"] }
            if !stableFocusRegions(focusBefore,focusAfter), focusBefore.element != nil { regions["selection"] = ["status":"unavailable","reason":"selection_changed"] }
            regions["click"] = clickBefore.regions["click"]
            if clickBefore.element != nil && !stableFocusControl(clickBefore,clickAfter) { regions["click"] = ["status":"unavailable","reason":"hit_target_changed"] }
        }
        guard let png = NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:]) else { result.screenshot=["status":"error","reason":"png_encoding_failed"];return result }
        result.screenshot = ["status":"captured","data":png.base64EncodedString(),"selection":expected == nil ? "single_window_fallback":"ax_bounds","requestedAt":preciseTimestamp(requestTime),"capturedAt":preciseTimestamp(completeTime),"regionsSampledAt":sampledAt,"frame":regionRect(target.frame),"pixelWidth":image.width,"pixelHeight":image.height,"coordinateSpace":"screen_top_left_points","shadowsExcluded":true,"regions":regions,"nonAtomic":true]
    } catch { result.screenshot = ["status":"error","code":(error as NSError).code] }
    return result
}
