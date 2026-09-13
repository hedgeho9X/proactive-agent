/** 按本机应用身份读取小尺寸图标，不读取应用数据或发起网络请求。 */
import AppKit

/** 解析 Bundle ID 并返回 PNG；应用未安装时明确返回空值。 */
func applicationIcon(_ bundleId: String) -> [String:Any] {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundleId) else { return ["data":NSNull()] }
    let original = NSWorkspace.shared.icon(forFile:url.path)
    let icon = NSImage(size:NSSize(width:32,height:32))
    icon.lockFocus(); original.draw(in:NSRect(x:0,y:0,width:32,height:32)); icon.unlockFocus()
    guard let tiff = icon.tiffRepresentation, let bitmap = NSBitmapImageRep(data:tiff), let data = bitmap.representation(using:.png,properties:[:]) else { return ["data":NSNull()] }
    return ["data":data.base64EncodedString()]
}
