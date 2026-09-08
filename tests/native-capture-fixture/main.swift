import AppKit
import ApplicationServices

// 手动/自动验收专用窗口，输入只改变测试日志，不发送消息或修改用户文件。
func report(_ value:[String:Any]) { let data = try! JSONSerialization.data(withJSONObject:value); FileHandle.standardOutput.write(data + Data([10])) }
final class FixtureView: NSView {
    let name: String
    let color: NSColor
    init(_ name:String,_ color:NSColor) { self.name=name;self.color=color;super.init(frame:.zero) }
    required init?(coder:NSCoder) { fatalError() }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event:NSEvent?) -> Bool { true }
    override func draw(_ dirtyRect:NSRect) {
        color.setFill(); bounds.fill()
        ("CAPTURE FIXTURE " + name as NSString).draw(at:NSPoint(x:40,y:160),withAttributes:[.font:NSFont.boldSystemFont(ofSize:30),.foregroundColor:NSColor.black])
    }
    override func mouseDown(with event:NSEvent) { window?.makeFirstResponder(self);report(["received":"click","windowId":event.windowNumber,"name":name]) }
    override func rightMouseDown(with event:NSEvent) { report(["received":"right_click","windowId":event.windowNumber,"name":name]) }
    override func keyDown(with event:NSEvent) { report(["received":"key","windowId":event.windowNumber,"keyCode":Int(event.keyCode),"name":name]) }
}
let app = NSApplication.shared
let originalPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
let backgroundOnly = CommandLine.arguments.contains("--background")
app.setActivationPolicy(backgroundOnly ? .accessory:.regular)
var windows=[String:NSWindow]()
let screenHeight = NSScreen.screens.first!.frame.height
for (name,x,y,color) in [("A",130.0,150.0,NSColor.systemOrange),("B",450.0,190.0,NSColor.systemTeal)] {
    let window=NSWindow(contentRect:NSRect(x:x,y:screenHeight-y-360,width:640,height:360),styleMask:[.titled,.closable],backing:.buffered,defer:false)
    window.title="Capture Fixture " + name; window.isReleasedWhenClosed=false
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
    window.contentView=FixtureView(name,color)
    if backgroundOnly {window.orderFrontRegardless()} else {window.makeKeyAndOrderFront(nil);window.makeFirstResponder(window.contentView)}
    windows[name]=window
}
if !backgroundOnly {app.activate(ignoringOtherApps:true)}
DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
    let list=CGWindowListCopyWindowInfo([.optionOnScreenOnly],kCGNullWindowID) as? [[String:Any]] ?? []
    report(["ready":true,"pid":Int(getpid()),"originalPid":originalPid.map {Int($0)} as Any? ?? NSNull(),"windows":windows.mapValues { window in ["id":window.windowNumber,"frame":list.first(where: {($0[kCGWindowNumber as String] as? Int) == window.windowNumber})?[kCGWindowBounds as String] as Any? ?? NSNull()] }])
}
DispatchQueue.global().async {
    while let line=readLine(),let data=line.data(using:.utf8),let command=try? JSONSerialization.jsonObject(with:data) as? [String:Any] {
        DispatchQueue.main.async {
            switch command["kind"] as? String {
            case "front": if let name=command["name"] as? String,let window=windows[name] {window.makeKeyAndOrderFront(nil);window.orderFrontRegardless();window.makeFirstResponder(window.contentView);app.activate(ignoringOtherApps:true)}
            case "click":
                guard let x=command["x"] as? Double,let y=command["y"] as? Double else {return}
                let list=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
                let top=list.first { info in
                    guard let raw=info[kCGWindowBounds as String] as? [String:Any],let frame=CGRect(dictionaryRepresentation:raw as CFDictionary) else {return false}
                    return (info[kCGWindowAlpha as String] as? Double ?? 1)>0 && frame.contains(CGPoint(x:x,y:y))
                }
                guard top?[kCGWindowOwnerPID as String] as? Int32 == getpid() else {report(["refused":"point_not_fixture"]);return}
                let right=command["right"] as? Bool ?? false
                CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseDown:.leftMouseDown,mouseCursorPosition:CGPoint(x:x,y:y),mouseButton:right ? .right:.left)?.post(tap:.cghidEventTap)
                CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseUp:.leftMouseUp,mouseCursorPosition:CGPoint(x:x,y:y),mouseButton:right ? .right:.left)?.post(tap:.cghidEventTap)
            case "key":
                guard NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid() else {report(["refused":"fixture_not_frontmost"]);return}
                let code=CGKeyCode(command["code"] as? Int ?? 36)
                CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true)?.post(tap:.cghidEventTap)
                CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:false)?.post(tap:.cghidEventTap)
            case "close": if let name=command["name"] as? String,let window=windows.removeValue(forKey:name) {window.close()}
            case "other": if let pid=originalPid {NSRunningApplication(processIdentifier:pid)?.activate(options:[])}
            case "quit":app.terminate(nil)
            default:break
            }
        }
    }
    DispatchQueue.main.async {app.terminate(nil)}
}
app.run()
