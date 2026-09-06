import AppKit
import ApplicationServices
// 仅测试几何与选区判断，不请求真实应用内容。
func bounds(_ element:AXUIElement)->CGRect? { nil }
func attribute(_ element:AXUIElement,_ name:String)->AnyObject? { nil }
let element=AXUIElementCreateApplication(getpid())
let frame=CGRect(x:0,y:0,width:100,height:20)
var a=CFRange(location:1,length:0),b=CFRange(location:2,length:0)
let regions:[String:Any]=["focus":["status":"available","rect":regionRect(frame)],"selection":["status":"no_selection"]]
let first=FocusRegionProbe(element:element,frame:frame,range:AXValueCreate(.cfRange,&a),protected:false,regions:regions)
let moved=FocusRegionProbe(element:element,frame:frame,range:AXValueCreate(.cfRange,&b),protected:false,regions:regions)
precondition(stableFocusControl(first,moved))
precondition(!stableFocusRegions(first,moved))
let other=FocusRegionProbe(element:AXUIElementCreateApplication(getpid()+1),frame:frame,range:nil,protected:false,regions:regions)
precondition(!stableFocusControl(first,other))
print("PASS")
