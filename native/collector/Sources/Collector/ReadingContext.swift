/** 定向读取选区及其关联文本容器；不滚动界面，不声明整段回复或屏幕可见性。 */
import AppKit
import ApplicationServices

/** 隔离 AX 系统调用，使同一取证策略可在受控树中验证。 */
protocol ReadingAXSource {
    associatedtype Element
    /** 比较同一次查询中的元素身份。 */
    func same(_ a: Element, _ b: Element) -> Bool
    /** 读取单个属性并保留系统状态。 */
    func read(_ element: Element, _ name: String) -> (AXError, Any?)
    /** 返回有上限的直接子节点及原始数量。 */
    func children(_ element: Element, limit: Int) -> (AXError, [Element], Int)
    /** 读取当前父节点，不跨越应用补查。 */
    func parent(_ element: Element) -> Element?
    /** 校验元素是否属于锁定窗口。 */
    func owns(_ element: Element) -> Bool
    /** 校验非文本容器是否仅占据局部区域。 */
    func localContainer(_ element: Element) -> Bool
    /** 按 UTF-16 范围读取同一元素的文本。 */
    func string(_ element: Element, range: CFRange) -> (AXError, String?)
}

/** 局部容器须具有可校验的范围；整窗和大布局容器不能作为一段正文的边界。 */
func isLocalReadingContainer(_ rect: CGRect?, window: CGRect?) -> Bool {
    guard let rect, let window, rect.width > 0, rect.height > 0, window.width > 0, window.height > 0 else { return false }
    return rect.width * rect.height < window.width * window.height * 0.6 && rect.width <= window.width
}

/** 仅接受已确认目标窗口的 AX 元素；子节点分页读取以限制单次返回规模。 */
struct NativeReadingAXSource: ReadingAXSource {
    let window: AXUIElement
    /** 使用 CoreFoundation 身份比较，避免哈希碰撞合并不同元素。 */
    func same(_ a: AXUIElement, _ b: AXUIElement) -> Bool { CFEqual(a,b) }
    /** 每次系统调用使用短超时，错误由策略层分类保存。 */
    func read(_ element: AXUIElement, _ name: String) -> (AXError, Any?) {
        AXUIElementSetMessagingTimeout(element,0.01)
        var value: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(element,name as CFString,&value)
        return (code,value)
    }
    /** 先查询子节点数量，再请求有限页，避免返回整份长列表。 */
    func children(_ element: AXUIElement, limit: Int) -> (AXError, [AXUIElement], Int) {
        var count: CFIndex = 0
        let countCode = AXUIElementGetAttributeValueCount(element,kAXChildrenAttribute as CFString,&count)
        guard countCode == .success, count > 0 else { return (countCode,[],count) }
        var values: CFArray?
        let code = AXUIElementCopyAttributeValues(element,kAXChildrenAttribute as CFString,0,min(count,limit),&values)
        return (code,values as? [AXUIElement] ?? [],count)
    }
    /** 仅接受 AX 元素类型的父引用。 */
    func parent(_ element: AXUIElement) -> AXUIElement? {
        guard let value = read(element,kAXParentAttribute).1 else { return nil }
        let object = value as CFTypeRef
        return CFGetTypeID(object) == AXUIElementGetTypeID() ? (object as! AXUIElement) : nil
    }
    /** 无窗口归属证据时返回 false，不以当前前台窗口替代。 */
    func owns(_ element: AXUIElement) -> Bool {
        if same(element,window) { return true }
        guard let value = read(element,kAXWindowAttribute).1 else { return false }
        let object = value as CFTypeRef
        return CFGetTypeID(object) == AXUIElementGetTypeID() && CFEqual(object,window)
    }
    /** 使用同一逻辑坐标系比较容器与目标窗口范围。 */
    func localContainer(_ element: AXUIElement) -> Bool { isLocalReadingContainer(bounds(element),window:bounds(window)) }
    /** 范围由调用方限制；不会设置选区或滚动页面。 */
    func string(_ element: AXUIElement, range: CFRange) -> (AXError, String?) {
        var range = range
        guard let parameter = AXValueCreate(.cfRange,&range) else { return (.illegalArgument,nil) }
        var value: CFTypeRef?
        let code = AXUIElementCopyParameterizedAttributeValue(element,kAXStringForRangeParameterizedAttribute as CFString,parameter,&value)
        return (code,value as? String)
    }
}

/** 限制局部取证的时间、节点和正文规模，独立于全窗口遍历的深度预算。 */
struct ReadingLimits {
    var milliseconds = 650
    var nodes = 96
    var depth = 24
    var ancestors = 8
    var children = 40
    var characters = 24000
    var selectedCharacters = 8000
}

/** 按当前选区优先选择局部锚点；错误和截断保留在证据中，不从其他窗口补全。 */
final class ReadingContextReader<Source: ReadingAXSource> {
    let source: Source
    let limits: ReadingLimits
    let began = Date()
    var errors = [[String:Any]]()
    var reasons = Set<String>()
    var seen = [Source.Element]()
    var protectedFound = false
    private let boundaries: Set<String> = ["AXApplication","AXWindow","AXScrollArea","AXWebArea","AXSplitGroup","AXTabGroup","AXList","AXTable","AXOutline","AXToolbar","AXMenuBar"]
    private let textRoles: Set<String> = ["AXStaticText","AXTextArea","AXTextField","AXParagraph","AXHeading","AXLink"]

    /** 使用注入的数据源执行取证；不会改变源应用状态。 */
    init(source: Source, limits: ReadingLimits = ReadingLimits()) { self.source = source; self.limits = limits }

    /** 所有查询前检查软时限；单次原生调用另受 10 ms 消息超时约束。 */
    func available() -> Bool {
        guard Date().timeIntervalSince(began)*1000 < Double(limits.milliseconds) else { reasons.insert("time_budget"); return false }
        return true
    }

    /** 保留系统错误分类，但不把属性正文写进诊断。 */
    func read(_ element: Source.Element, _ name: String) -> Any? {
        guard available() else { return nil }
        let (code,value) = source.read(element,name)
        if code != .success && code != .noValue && code != .attributeUnsupported && errors.count < 24 {
            errors.append(["attribute":name,"code":code.rawValue]); reasons.insert("ax_read_error")
        }
        return code == .success ? value : nil
    }

    /** 读取正文前检查受保护类型；无法确认角色的节点不继续取文本。 */
    func role(_ element: Source.Element) -> String? {
        guard let role = read(element,kAXRoleAttribute) as? String else { reasons.insert("role_unavailable"); return nil }
        guard available() else { return nil }
        let (code,value) = source.read(element,kAXSubroleAttribute)
        guard code == .success || code == .attributeUnsupported || code == .noValue else {
            reasons.insert("privacy_check_failed"); errors.append(["attribute":kAXSubroleAttribute,"code":code.rawValue]); return nil
        }
        guard available() else { return nil }
        let (protectedCode,protectedValue) = source.read(element,"AXProtectedContent")
        guard protectedCode == .success || protectedCode == .attributeUnsupported || protectedCode == .noValue else {
            reasons.insert("privacy_check_failed"); errors.append(["attribute":"AXProtectedContent","code":protectedCode.rawValue]); return nil
        }
        if role == "AXSecureTextField" || value as? String == "AXSecureTextField" || protectedValue as? Bool == true {
            protectedFound = true; reasons.insert("protected_input"); return nil
        }
        return role
    }

    /** 点击可能命中输入框的子节点，先沿有限祖先链检查敏感容器，再允许读取正文。 */
    func safeAnchor(_ element: Source.Element) -> Bool {
        guard available(), source.owns(element) else { reasons.insert("element_window_unverified"); return false }
        guard role(element) != nil else { return false }
        var current = element, visited = [element]
        for _ in 0..<limits.ancestors {
            guard available() else { return false }
            guard let parent = source.parent(current) else { return true }
            guard !visited.contains(where:{source.same($0,parent)}), source.owns(parent), let kind = role(parent) else { return false }
            if boundaries.contains(kind) { return true }
            current = parent; visited.append(parent)
        }
        return true
    }

    /** 从 AX 范围对象提取 UTF-16 范围，保留零长度以区分插入光标与范围缺失。 */
    func selectedRange(_ element: Source.Element) -> CFRange? {
        guard let value = read(element,kAXSelectedTextRangeAttribute) else { return nil }
        if let range = value as? CFRange { return range.location >= 0 && range.length >= 0 ? range : nil }
        let object = value as CFTypeRef
        guard CFGetTypeID(object) == AXValueGetTypeID(), AXValueGetType(object as! AXValue) == .cfRange else { return nil }
        var range = CFRange()
        return AXValueGetValue(object as! AXValue,.cfRange,&range) && range.location >= 0 && range.length >= 0 ? range : nil
    }

    /** 优先直接读取选区，缺失时使用同一元素的 AXStringForRange。 */
    func selection(_ element: Source.Element, id: String) -> [String:Any]? {
        guard safeAnchor(element) else { return nil }
        let sampled = preciseTimestamp()
        let range = selectedRange(element)
        if range?.length == 0 { return nil }
        var name = "AXSelectedText"
        var value = read(element,kAXSelectedTextAttribute) as? String
        if (value?.isEmpty ?? true), let range, available() {
            let result = source.string(element,range:CFRange(location:range.location,length:min(range.length,limits.selectedCharacters)))
            name = "AXStringForRange"; value = result.1
            if result.0 != .success { errors.append(["attribute":name,"code":result.0.rawValue]); reasons.insert("selection_text_unavailable") }
        }
        guard let value, !value.isEmpty else { return nil }
        var result: [String:Any] = ["text":String(value.prefix(limits.selectedCharacters)),"source":name,"nodeId":id,"sampledAt":sampled,"status":"available","truncated":value.count > limits.selectedCharacters || (name == "AXStringForRange" && (range?.length ?? 0) > limits.selectedCharacters)]
        if let range { result["range"] = ["location":range.location,"length":range.length,"unit":"utf16"] }
        return result
    }

    /** 最近有分支的文本容器作为上下文边界；不越过滚动区、整个文档或导航容器。 */
    func contextRoot(_ seed: Source.Element) -> (Source.Element, String) {
        var current = seed
        var visited = [seed]
        for distance in 0..<limits.ancestors {
            guard available(), let parent = source.parent(current), !visited.contains(where: {source.same($0,parent)}), source.owns(parent),
                  let kind = role(parent), !boundaries.contains(kind) else { break }
            if textRoles.contains(kind) { return (parent,"reading:ancestor:\(distance + 1)") }
            guard available(), source.localContainer(parent) else { break }
            guard available() else { break }
            let (code,_,count) = source.children(parent,limit:1)
            if code == .success, count > 1 { return count <= limits.children ? (parent,"reading:ancestor:\(distance + 1)") : (current,"reading:anchor") }
            current = parent; visited.append(parent)
        }
        return (current,"reading:anchor")
    }

    /** 输出可追溯的局部正文；fragments 仅保存定位，避免把正文重复写两次。 */
    func capture(focus: Source.Element?, click: Source.Element?) -> [String:Any] {
        var result: [String:Any] = ["status":"unavailable","sampledAt":preciseTimestamp(began),"nonAtomic":true]
        let seed = click ?? focus
        var selectedElement: Source.Element?
        for (element,id,anchor) in [(focus,"reading:focus","focus"),(click,"reading:click","click")] {
            if let element, let selected = selection(element,id:id) {
                result["selectedText"] = selected; result["selectionAnchor"] = anchor; selectedElement = element; break
            }
        }
        guard let seed, safeAnchor(seed), let seedRole = role(seed), !boundaries.contains(seedRole) else { return finish(result) }
        // 选区可能挂在全屏 AXGroup 上；它只证明选择文本，不能使整个 Group 成为正文根。
        guard textRoles.contains(seedRole) || (click != nil && available() && source.localContainer(seed)) else { reasons.insert("context_anchor_not_local_text"); return finish(result) }
        let (root,rootId) = contextRoot(seed)
        var text = "", fragments = [[String:Any]](), unique = Set<String>()
        var contextElements = [Source.Element]()
        var sources = Set<String>()
        let contextSampledAt = preciseTimestamp()
        /** 按原文去重并记录 UTF-16 定位，不在 fragments 中复制正文。 */
        func append(_ value: String, source: String, path: String) {
            let value = value.trimmingCharacters(in:.whitespacesAndNewlines)
            guard !value.isEmpty, unique.insert(value).inserted else { return }
            let remaining = limits.characters - text.count - (text.isEmpty ? 0 : 1)
            guard remaining > 0 else { reasons.insert("text_budget"); return }
            let part = String(value.prefix(remaining))
            if part.count < value.count { reasons.insert("text_budget") }
            if !text.isEmpty { text += "\n" }
            fragments.append(["nodeId":path,"source":source,"start":text.utf16.count,"length":part.utf16.count,"unit":"utf16"])
            text += part; sources.insert(source)
        }
        /** 只遍历所选局部根，逐节点执行归属与隐私检查。 */
        func visit(_ element: Source.Element, path: String, depth: Int) {
            guard available() else { return }
            guard depth < limits.depth, seen.count < limits.nodes, text.count < limits.characters else { reasons.insert(depth >= limits.depth ? "depth_budget":seen.count >= limits.nodes ? "node_budget":"text_budget"); return }
            guard !seen.contains(where: {source.same($0,element)}) else { return }
            seen.append(element)
            guard source.owns(element) else { reasons.insert("element_window_unverified"); return }
            guard let kind = role(element), !boundaries.contains(kind) else { return }
            contextElements.append(element)
            if textRoles.contains(kind) {
                var content = read(element,kAXValueAttribute) as? String
                var origin = "AXValue"
                if content?.isEmpty ?? true { content = read(element,kAXTitleAttribute) as? String; origin = "AXTitle" }
                if content?.isEmpty ?? true, let count = read(element,kAXNumberOfCharactersAttribute) as? NSNumber, count.intValue > 0, available() {
                    let size = min(count.intValue,limits.characters-text.count)
                    let response = source.string(element,range:CFRange(location:0,length:size))
                    content = response.1; origin = "AXStringForRange"
                    if count.intValue > size { reasons.insert("text_budget") }
                    if response.0 != .success { errors.append(["attribute":origin,"code":response.0.rawValue]); reasons.insert("ax_read_error") }
                }
                if content?.isEmpty ?? true { content = read(element,kAXDescriptionAttribute) as? String; origin = "AXDescription" }
                if let content, !content.isEmpty { append(content,source:origin,path:path) }
            }
            guard available() else { return }
            let (code,children,total) = source.children(element,limit:limits.children)
            if total > children.count { reasons.insert("children_budget") }
            if code != .success && code != .attributeUnsupported && code != .noValue { reasons.insert("children_unavailable"); errors.append(["attribute":"AXChildren","code":code.rawValue]) }
            for (index,child) in children.enumerated() { visit(child,path:"\(path)/\(index)",depth:depth+1) }
        }
        visit(root,path:rootId,depth:0)
        if !text.isEmpty {
            var relation = "no_selection"
            if let selectedElement, let selected = result["selectedText"] as? [String:Any] {
                if contextElements.contains(where:{source.same($0,selectedElement)}) { relation = "same_subtree" }
                else if selected["truncated"] as? Bool != true, let selectedText = selected["text"] as? String, text.contains(selectedText) { relation = "selected_text_found_in_context" }
                else { relation = "unverified_different_anchors" }
            }
            result["context"] = ["text":text,"source":sources.count == 1 && sources.contains("AXStringForRange") ? "AXStringForRange":"AXRelatedSubtree","scope":sources.count == 1 && sources.contains("AXStringForRange") && seen.count == 1 ? "text_control_range":"related_subtree","anchor":click == nil ? "focus":"click","selectionRelation":relation,"nodeId":rootId,"sampledAt":contextSampledAt,"truncated":!reasons.isEmpty,"reason":reasons.isEmpty ? "subtree_only_not_complete_reply":reasons.sorted().joined(separator:","),"visibility":"not_verified","fragments":fragments]
        }
        return finish(result)
    }

    /** 受保护内容不输出正文；缺失、软时限和系统错误分别保留。 */
    func finish(_ value: [String:Any]) -> [String:Any] {
        var result = value
        if protectedFound { result.removeValue(forKey:"selectedText"); result.removeValue(forKey:"context"); result["status"] = "excluded"; result["reason"] = "protected_input" }
        else { result["status"] = result["selectedText"] != nil || result["context"] != nil ? (reasons.isEmpty ? "available":"partial") : "unavailable" }
        if result["reason"] == nil, result["status"] as? String == "unavailable" { result["reason"] = reasons.sorted().first ?? "no_related_text" }
        result["completedAt"] = preciseTimestamp()
        result["diagnostics"] = ["nodes":seen.count,"elapsedMs":Int(Date().timeIntervalSince(began)*1000),"reasons":reasons.sorted(),"errors":Array(errors.prefix(24)),"limits":["milliseconds":limits.milliseconds,"nodes":limits.nodes,"depth":limits.depth,"characters":limits.characters]]
        return result
    }
}
