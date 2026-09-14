/** 只为既有截图添加区域标记，不执行 OCR 或重新抓屏。 */
import AppKit

/** 输出与原截图同尺寸的标注 PNG。 */
func prepareEvidence() {
    guard let line = readLine(), let json = line.data(using:.utf8), let input = try? JSONSerialization.jsonObject(with:json) as? [String:Any], let encoded = input["data"] as? String, let data = Data(base64Encoded:encoded), let rep = NSBitmapImageRep(data:data), let image = rep.cgImage else { emit(["error":"invalid_source_image"]); return }
    let width = CGFloat(image.width), height = CGFloat(image.height)
    guard let context = CGContext(data:nil,width:image.width,height:image.height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { emit(["error":"image_context_failed"]); return }
    context.draw(image,in:CGRect(x:0,y:0,width:width,height:height))
    context.setLineWidth(2)
    let colors: [String:CGColor] = ["focus":NSColor.systemBlue.cgColor,"selection":NSColor.systemOrange.cgColor,"click":NSColor.systemGreen.cgColor]
    for layer in input["layers"] as? [[String:Any]] ?? [] {
        guard let left = layer["left"] as? Double, let top = layer["top"] as? Double, let w = layer["width"] as? Double, let h = layer["height"] as? Double else { continue }
        context.setStrokeColor(colors[layer["kind"] as? String ?? ""] ?? NSColor.systemGreen.cgColor)
        context.stroke(CGRect(x:width*left/100,y:height*(1-(top+h)/100),width:width*w/100,height:height*h/100).insetBy(dx:-1,dy:-1))
    }
    if let point = input["point"] as? [String:Double], let left = point["left"], let top = point["top"] {
        context.setStrokeColor(NSColor.systemGreen.cgColor)
        context.strokeEllipse(in:CGRect(x:width*left/100-7,y:height*(1-top/100)-7,width:14,height:14))
    }
    guard let annotated = context.makeImage(), let png = NSBitmapImageRep(cgImage:annotated).representation(using:.png,properties:[:]) else { emit(["error":"png_encoding_failed"]);return }
    emit(["data":png.base64EncodedString(),"annotationVersion":1])
}
