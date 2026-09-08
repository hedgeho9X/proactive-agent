import AppKit
import ApplicationServices
// 只验证选择策略，不操作真实窗口。
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? { nil }
func bounds(_ element: AXUIElement) -> CGRect? { nil }
func preciseTimestamp() -> String { "fixture" }
func regionRect(_ rect: CGRect) -> [String:Double] { ["x":rect.minX,"y":rect.minY,"width":rect.width,"height":rect.height] }
let a = CaptureWindowTarget(id:12,pid:42,frame:CGRect(x:200,y:100,width:400,height:300),source:"fixture")
let b = CaptureWindowTarget(id:11,pid:42,frame:CGRect(x:100,y:100,width:400,height:300),source:"fixture")
let other = CaptureWindowTarget(id:21,pid:43,frame:CGRect(x:800,y:100,width:300,height:300),source:"fixture")
precondition(clickedWindow([a,b,other],point:CGPoint(x:250,y:200))?.id == 12)
precondition(clickedWindow([a,b,other],point:CGPoint(x:150,y:200))?.id == 11)
precondition(clickedWindow([a,b,other],point:CGPoint(x:850,y:200))?.pid == 43)
precondition(clickedWindow([a,b],point:CGPoint(x:0,y:0)) == nil)
let equal = CaptureWindowTarget(id:13,pid:42,frame:a.frame,source:"fixture")
precondition(clickedWindow([equal,a,b],point:CGPoint(x:250,y:200))?.id == 13)
precondition(keyboardWindow([a,b,other],pid:42,focusedBounds:b.frame)?.id == 11)
precondition(keyboardWindow([a,b,other],pid:43,focusedBounds:nil)?.id == 21)
let negative = CaptureWindowTarget(id:31,pid:42,frame:CGRect(x:-500,y:-300,width:400,height:200),source:"fixture")
precondition(clickedWindow([negative],point:CGPoint(x:-400,y:-200))?.id == 31)
let json = try! JSONSerialization.jsonObject(with:JSONSerialization.data(withJSONObject:a.json)) as! [String:Any]
precondition(CaptureWindowTarget(json)?.id == 12)
precondition(CaptureWindowTarget(["id":0,"pid":42,"frame":regionRect(a.frame)]) == nil)
precondition(unavailableWindowReason(a,info:[]) == "target_window_closed")
precondition(unavailableWindowReason(a,info:nil) == "target_window_state_unavailable")
let hidden: [String:Any] = [kCGWindowNumber as String:NSNumber(value:a.id),kCGWindowOwnerPID as String:NSNumber(value:a.pid),kCGWindowIsOnscreen as String:false]
precondition(unavailableWindowReason(a,info:[hidden]) == "target_window_not_on_screen")
print("PASS")
