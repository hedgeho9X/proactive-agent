import CoreGraphics

// 普通字母、主键盘数字和小键盘数字不触发记录；Shift 大写仍算普通输入。
func shouldRecordKey(_ code: Int64, flags: CGEventFlags) -> Bool {
    let letters: Set<Int64> = [0,1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,31,32,34,35,37,38,40,45,46]
    let numbers: Set<Int64> = [18,19,20,21,22,23,25,26,28,29,82,83,84,85,86,87,88,89,91,92]
    let shortcut = flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate) || flags.contains(.maskSecondaryFn)
    return shortcut || (!letters.contains(code) && !numbers.contains(code))
}
