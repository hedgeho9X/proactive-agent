/** 键盘物理事件分类；编辑归并必须另外确认焦点是可编辑控件。 */
import CoreGraphics

/** 普通字符、标点、光标编辑和 Shift+Enter 属于编辑候选；组合快捷键保持独立。 */
func isEditingKey(_ code: Int64, flags: CGEventFlags) -> Bool {
    if flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate) { return false }
    // macOS 可能给方向键附加 secondaryFn，即使用户没有按 Fn；它不应把光标移动变成独立快捷键。
    let navigation: Set<Int64> = [115,117,119,123,124,125,126]
    if flags.contains(.maskSecondaryFn) && !navigation.contains(code) { return false }
    if code == 36 || code == 76 { return flags.contains(.maskShift) }
    let editing: Set<Int64> = [0,1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,37,38,39,40,41,42,43,44,45,46,47,49,50,51,65,67,69,75,78,81,82,83,84,85,86,87,88,89,91,92,115,117,119,123,124,125,126]
    return editing.contains(code)
}

// 普通字母、主键盘数字和小键盘数字不触发记录；Shift 大写仍算普通输入。
func shouldRecordKey(_ code: Int64, flags: CGEventFlags) -> Bool {
    let letters: Set<Int64> = [0,1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,31,32,34,35,37,38,40,45,46]
    let numbers: Set<Int64> = [18,19,20,21,22,23,25,26,28,29,82,83,84,85,86,87,88,89,91,92]
    let shortcut = flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate) || flags.contains(.maskSecondaryFn)
    return shortcut || (!letters.contains(code) && !numbers.contains(code))
}
