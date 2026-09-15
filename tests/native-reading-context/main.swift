/** 用受控 AX 数据源验证范围取文、局部边界、深层节点和敏感数据隔离，不查询真实应用。 */
import AppKit
import ApplicationServices

/** 与生产格式一致的时间编码，仅用于本地合成证据。 */
func preciseTimestamp(_ date: Date = Date()) -> String { ISO8601DateFormatter().string(from:date) }
/** 原生 adapter 仅参与编译，受控数据源不查询真实 AX 范围。 */
func bounds(_ element: AXUIElement) -> CGRect? { nil }

/** 保存确定性树及查询记录，便于确认敏感属性没有被请求。 */
final class FixtureAX: ReadingAXSource {
    var nodes = [Int:[String:Any]]()
    var links = [Int:[Int]]()
    var parents = [Int:Int]()
    var foreign = Set<Int>()
    var broad = Set<Int>()
    var ranges = [Int:String]()
    var failures = [String:AXError]()
    var reads = [(Int,String)]()
    func same(_ a: Int, _ b: Int) -> Bool { a == b }
    func read(_ element: Int, _ name: String) -> (AXError, Any?) {
        reads.append((element,name))
        if let code = failures["\(element):\(name)"] { return (code,nil) }
        guard let value = nodes[element]?[name] else { return (.attributeUnsupported,nil) }
        return (.success,value)
    }
    func children(_ element: Int, limit: Int) -> (AXError, [Int], Int) {
        let children = links[element] ?? []
        return (.success,Array(children.prefix(limit)),children.count)
    }
    func parent(_ element: Int) -> Int? { parents[element] }
    func owns(_ element: Int) -> Bool { !foreign.contains(element) }
    func localContainer(_ element: Int) -> Bool { !broad.contains(element) }
    func string(_ element: Int, range: CFRange) -> (AXError, String?) {
        reads.append((element,"AXStringForRange"))
        guard let text = ranges[element] as NSString?, range.location + range.length <= text.length else { return (.illegalArgument,nil) }
        return (.success,text.substring(with:NSRange(location:range.location,length:range.length)))
    }
    /** 添加节点及稳定父子关系。 */
    func add(_ id: Int, role: String, parent: Int? = nil, value: String? = nil) {
        nodes[id] = [kAXRoleAttribute:role]
        if let value { nodes[id]?[kAXValueAttribute] = value }
        if let parent { parents[id] = parent; links[parent,default:[]].append(id) }
    }
}

let fixture = FixtureAX()
fixture.add(0,role:"AXWindow")
fixture.add(1,role:"AXScrollArea",parent:0)
fixture.add(2,role:"AXGroup",parent:1)
fixture.add(3,role:"AXStaticText",parent:2,value:"选中的段落")
fixture.add(4,role:"AXStaticText",parent:2,value:"此段在视口外，但由相同局部容器暴露。")
fixture.add(5,role:"AXGroup",parent:1)
fixture.add(6,role:"AXStaticText",parent:5,value:"不相关侧栏内容")
fixture.nodes[3]?[kAXSelectedTextAttribute] = "段落"
fixture.nodes[3]?[kAXSelectedTextRangeAttribute] = CFRange(location:3,length:2)
let first = ReadingContextReader(source:fixture).capture(focus:3,click:3)
precondition(first["status"] as? String == "available")
precondition((first["selectedText"] as? [String:Any])?["text"] as? String == "段落")
let context = first["context"] as! [String:Any]
precondition((context["text"] as! String).contains("视口外"))
precondition(!(context["text"] as! String).contains("侧栏"))
precondition(context["scope"] as? String == "related_subtree")
precondition(context["visibility"] as? String == "not_verified")
precondition(context["truncated"] as? Bool == false)
precondition(first["selectionAnchor"] as? String == "focus")
precondition(context["selectionRelation"] as? String == "same_subtree")
precondition((context["fragments"] as! [[String:Any]]).allSatisfy {$0["text"] == nil})

let ranged = FixtureAX()
ranged.add(1,role:"AXTextArea")
ranged.ranges[1] = "屏幕以外的全文测试"
ranged.nodes[1]?[kAXNumberOfCharactersAttribute] = NSNumber(value:ranged.ranges[1]!.utf16.count)
ranged.nodes[1]?[kAXSelectedTextRangeAttribute] = CFRange(location:2,length:2)
let rangeResult = ReadingContextReader(source:ranged).capture(focus:1,click:nil)
precondition((rangeResult["selectedText"] as? [String:Any])?["text"] as? String == "以外")
precondition((rangeResult["context"] as? [String:Any])?["source"] as? String == "AXStringForRange")
precondition((rangeResult["context"] as? [String:Any])?["scope"] as? String == "text_control_range")
let caret = FixtureAX()
caret.add(1,role:"AXTextArea",value:"输入正文")
caret.nodes[1]?[kAXSelectedTextRangeAttribute] = CFRange(location:2,length:0)
caret.nodes[1]?[kAXSelectedTextAttribute] = "过期的选区文字"
precondition(ReadingContextReader(source:caret).capture(focus:1,click:nil)["selectedText"] == nil)

// 整窗深度很大时，点击锚点下面的局部树仍可独立遍历。
let deep = FixtureAX()
deep.add(0,role:"AXWindow")
for id in 1...35 { deep.add(id,role:"AXGroup",parent:id-1) }
deep.add(36,role:"AXStaticText",parent:35,value:"深层正文")
let deepResult = ReadingContextReader(source:deep).capture(focus:nil,click:36)
precondition((deepResult["context"] as? [String:Any])?["text"] as? String == "深层正文")
fixture.broad.insert(2)
let broad = ReadingContextReader(source:fixture).capture(focus:nil,click:2)
precondition(broad["context"] == nil)
precondition(((broad["diagnostics"] as? [String:Any])?["reasons"] as? [String])?.contains("context_anchor_not_local_text") == true)
let layout = FixtureAX()
layout.add(0,role:"AXWindow")
layout.add(1,role:"AXWebArea",parent:0)
layout.add(2,role:"AXGroup",parent:1)
layout.broad.insert(2)
layout.nodes[2]?[kAXSelectedTextAttribute] = "局部段落"
layout.add(3,role:"AXGroup",parent:2)
layout.add(4,role:"AXStaticText",parent:3,value:"当前的局部段落")
layout.add(5,role:"AXGroup",parent:2)
layout.add(6,role:"AXStaticText",parent:5,value:"不相关会话侧栏")
let selectedLayout = ReadingContextReader(source:layout).capture(focus:2,click:3)
precondition((selectedLayout["selectedText"] as? [String:Any])?["text"] as? String == "局部段落")
precondition((selectedLayout["context"] as? [String:Any])?["text"] as? String == "当前的局部段落")
precondition((selectedLayout["context"] as? [String:Any])?["anchor"] as? String == "click")
precondition((selectedLayout["context"] as? [String:Any])?["selectionRelation"] as? String == "selected_text_found_in_context")
layout.add(7,role:"AXTextArea",parent:2,value:"输入框内的另一份草稿")
layout.nodes[7]?[kAXSelectedTextAttribute] = "草稿"
let unrelatedSelection = ReadingContextReader(source:layout).capture(focus:7,click:3)
precondition(unrelatedSelection["selectionAnchor"] as? String == "focus")
precondition((unrelatedSelection["context"] as? [String:Any])?["anchor"] as? String == "click")
precondition((unrelatedSelection["context"] as? [String:Any])?["text"] as? String == "当前的局部段落")
precondition((unrelatedSelection["context"] as? [String:Any])?["selectionRelation"] as? String == "unverified_different_anchors")
let selectedOnly = ReadingContextReader(source:layout).capture(focus:2,click:nil)
precondition(selectedOnly["selectedText"] != nil && selectedOnly["context"] == nil)
let windowRect = CGRect(x:0,y:0,width:1920,height:1050)
precondition(!isLocalReadingContainer(windowRect,window:windowRect))
precondition(isLocalReadingContainer(CGRect(x:600,y:600,width:453,height:35),window:windowRect))

let secure = FixtureAX()
secure.add(1,role:"AXGroup")
secure.add(2,role:"AXTextField",parent:1,value:"MUST_NOT_READ")
secure.nodes[2]?[kAXSubroleAttribute] = "AXSecureTextField"
let secured = ReadingContextReader(source:secure).capture(focus:2,click:1)
precondition(secured["status"] as? String == "excluded")
precondition(secured["selectedText"] == nil && secured["context"] == nil)
precondition(!secure.reads.contains {$0.0 == 2 && [kAXValueAttribute,kAXSelectedTextAttribute,"AXStringForRange"].contains($0.1)})
secure.add(3,role:"AXStaticText",parent:2,value:"CHILD_MUST_NOT_READ")
let secureChild = ReadingContextReader(source:secure).capture(focus:nil,click:3)
precondition(secureChild["status"] as? String == "excluded")
precondition(!secure.reads.contains {$0.0 == 3 && $0.1 == kAXValueAttribute})
let uncertain = FixtureAX()
uncertain.add(1,role:"AXTextField",value:"UNKNOWN_PRIVACY_MUST_NOT_READ")
uncertain.failures["1:AXSubrole"] = .cannotComplete
let privacyUnknown = ReadingContextReader(source:uncertain).capture(focus:1,click:nil)
precondition(privacyUnknown["context"] == nil)
precondition(!uncertain.reads.contains {$0.1 == kAXValueAttribute})

var limits = ReadingLimits()
limits.characters = 4
let clipped = ReadingContextReader(source:ranged,limits:limits).capture(focus:1,click:nil)
precondition((clipped["context"] as? [String:Any])?["truncated"] as? Bool == true)
precondition(((clipped["context"] as? [String:Any])?["text"] as? String)?.count == 4)
limits.depth = 2
let depthClipped = ReadingContextReader(source:deep,limits:limits).capture(focus:nil,click:36)
precondition(depthClipped["context"] == nil)
precondition(((depthClipped["diagnostics"] as? [String:Any])?["reasons"] as? [String])?.contains("depth_budget") == true)
fixture.foreign.insert(3)
let foreign = ReadingContextReader(source:fixture).capture(focus:3,click:3)
precondition(foreign["selectedText"] == nil && foreign["context"] == nil)
limits.milliseconds = 0
let timedOut = ReadingContextReader(source:fixture,limits:limits).capture(focus:4,click:nil)
precondition(timedOut["context"] == nil)
precondition(((timedOut["diagnostics"] as? [String:Any])?["reasons"] as? [String])?.contains("time_budget") == true)
print("PASS")
