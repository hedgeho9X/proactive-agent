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
    var axWindow: AXUIElement?
}
// 与 AX 全树遍历并行执行，截图不再等待整棵树返回。
func captureEventEvidence(_ pid: pid_t, target: CaptureWindowTarget, trigger: [String:Any]?, progress: @escaping @Sendable ([String:Any]) -> Void = {_ in}, requested: @Sendable () -> Void = {}) async -> CapturedEvidence {
    var result = CapturedEvidence(screenshot:["status":"unavailable"])
    result.windowId = target.id
    var stage = "screen_permission"
    var diagnostics: [String:Any] = ["target":target.json,"selection":"event_window_id","startedAt":preciseTimestamp()]
    func report(_ state: String = "running") { progress(["component":"screenshot","stage":stage,"state":state,"at":preciseTimestamp(),"target":target.json]) }
    func fail(_ reason: String, _ extra: [String:Any] = [:], excluded: Bool = false) -> CapturedEvidence {
        report("failed")
        var copy = result
        copy.screenshot = ["status":excluded ? "excluded":"error","reason":reason,"stage":stage,"diagnostics":diagnostics.merging(extra,uniquingKeysWith: {_,new in new}),"requestedAt":diagnostics["requestedAt"] as Any? ?? NSNull()]
        return copy
    }
    report()
    guard CGPreflightScreenCaptureAccess() else { return fail("screen_recording_permission_denied") }
    let application = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(application,0.015)
    do {
        stage = "shareable_content"
        report()
        let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
        stage = "target_window_validation"
        report()
        diagnostics["availableWindows"] = content.windows.filter {$0.owningApplication?.processID == pid}.prefix(20).map { ["id":Int($0.windowID),"frame":regionRect($0.frame),"layer":$0.windowLayer] as [String:Any] }
        guard let selected = content.windows.first(where: {$0.windowID == target.id}) else {
            let info = CGWindowListCopyWindowInfo(.optionIncludingWindow,target.id) as? [[String:Any]]
            return fail(unavailableWindowReason(target,info:info))
        }
        guard selected.owningApplication?.processID == pid else { return fail("target_window_owner_mismatch",["actualPid":selected.owningApplication.map {Int($0.processID)} as Any? ?? NSNull()]) }
        guard selected.frame.width > 0, selected.frame.height > 0 else { return fail("invalid_window_dimensions") }
        stage = "ax_window_association"; report()
        let window = axWindowForTarget(application,CaptureWindowTarget(id:target.id,pid:pid,frame:selected.frame,source:target.source))
        result.axWindow = window
        func withinTarget(_ probe: FocusRegionProbe) -> FocusRegionProbe {
            guard let window, let element = probe.element else { return probe }
            let role = (probe.attributes[kAXRoleAttribute] as? [String:Any])?["value"] as? [String:Any]
            let value = role?["text"] as? String == "AXWindow" ? element : attribute(element,kAXWindowAttribute)
            if let value, CFGetTypeID(value) == AXUIElementGetTypeID(), !CFEqual(value,window) {
                return FocusRegionProbe(element:nil,frame:nil,range:nil,protected:false,regions:probe.regions.mapValues {_ in ["status":"unavailable","reason":"region_window_mismatch"]})
            }
            return probe
        }
        diagnostics["axWindowResolved"] = window != nil
        diagnostics["frameAtCapture"] = regionRect(selected.frame)
        diagnostics["frameChangedSinceEvent"] = !sameWindowBounds(target.frame,selected.frame)
        stage = "privacy_check"
        report()
        let focusBefore = withinTarget(probeFocusRegions(application)), clickBefore = withinTarget(probeClickRegion(pid,trigger))
        result.focus = focusBefore; result.click = clickBefore
        let sampledAt = preciseTimestamp()
        guard !focusBefore.protected, !clickBefore.protected else { return fail("protected_input",excluded:true) }
        let factor = min(1,1600/selected.frame.width,8192/selected.frame.height)
        let config = SCStreamConfiguration(); config.width = max(1,Int(selected.frame.width*factor));config.height = max(1,Int(selected.frame.height*factor));config.showsCursor = false;config.ignoreShadowsSingleWindow = true
        let requestTime = Date()
        stage = "screenshot_capture"
        report()
        diagnostics["requestedAt"] = preciseTimestamp(requestTime)
        requested()
        let image = try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:selected),configuration:config)
        let completeTime = Date()
        let focusAfter = withinTarget(probeFocusRegions(application)), clickAfter = withinTarget(probeClickRegion(pid,trigger))
        stage = "privacy_check_after_capture"
        report()
        guard !focusAfter.protected, !clickAfter.protected else { return fail("protected_input",excluded:true) }
        let currentFrame = onscreenCaptureWindows()?.first(where: {$0.id == target.id && $0.pid == pid})?.frame
        let windowStable = currentFrame.map {sameWindowBounds($0,selected.frame)} ?? false
        diagnostics["frameStableDuringCapture"] = windowStable
        var regions = focusBefore.regions
        if !windowStable {
            regions = ["focus":["status":"unavailable","reason":"window_bounds_changed"],"selection":["status":"unavailable","reason":"window_bounds_changed"],"click":["status":"unavailable","reason":"window_bounds_changed"]]
        } else {
            if !stableFocusControl(focusBefore,focusAfter), focusBefore.element != nil { regions["focus"] = ["status":"unavailable","reason":"focus_or_bounds_changed"] }
            if !stableFocusRegions(focusBefore,focusAfter), focusBefore.element != nil { regions["selection"] = ["status":"unavailable","reason":"selection_changed"] }
            regions["click"] = clickBefore.regions["click"]
            if clickBefore.element != nil && !stableFocusControl(clickBefore,clickAfter) { regions["click"] = ["status":"unavailable","reason":"hit_target_changed"] }
        }
        // 弹窗可能在并行查询期间出现，不能把它的控件框画到旧主窗口上。
        for (name,probe) in [("focus",focusBefore),("selection",focusBefore),("click",clickBefore)] {
            guard let element = probe.element, let current = regions[name] as? [String:Any], current["status"] as? String == "available" else { continue }
            let role = attribute(element,kAXRoleAttribute) as? String
            let ownerValue = role == "AXWindow" ? element : attribute(element,kAXWindowAttribute)
            let owner = ownerValue.flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
            if let owner, let window {
                if !CFEqual(owner,window) { regions[name] = ["status":"unavailable","reason":"region_window_mismatch"] }
            } else { regions[name] = ["status":"unavailable","reason":"region_window_unverified"] }
        }
        stage = "png_encoding"
        report()
        guard let png = NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:]) else { return fail("png_encoding_failed") }
        result.screenshot = ["status":"captured","data":png.base64EncodedString(),"selection":target.source,"windowId":Int(target.id),"ownerPid":Int(pid),"requestedAt":preciseTimestamp(requestTime),"capturedAt":preciseTimestamp(completeTime),"regionsSampledAt":sampledAt,"frame":regionRect(selected.frame),"pixelWidth":image.width,"pixelHeight":image.height,"coordinateSpace":windowStable ? "screen_top_left_points":"unverified_window_bounds","shadowsExcluded":true,"regions":regions,"nonAtomic":true,"diagnostics":diagnostics]
        report("complete")
    } catch {
        let error = error as NSError
        return fail(stage == "shareable_content" ? "window_enumeration_failed":"screenshot_api_failed",["domain":error.domain,"code":error.code,"message":String(error.localizedDescription.prefix(500))])
    }
    return result
}
