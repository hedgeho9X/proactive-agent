import CoreGraphics
let letters:[Int64] = [0,1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,31,32,34,35,37,38,40,45,46]
let numbers:[Int64] = [18,19,20,21,22,23,25,26,28,29,82,83,84,85,86,87,88,89,91,92]
for key in letters + numbers {
    precondition(!shouldRecordKey(key,flags:[]))
    precondition(!shouldRecordKey(key,flags:.maskShift))
    precondition(shouldRecordKey(key,flags:.maskCommand))
    precondition(shouldRecordKey(key,flags:.maskControl))
}
for key:Int64 in [36,49,48,51,53,76,117,123,124,125,126,122,24,27,41,43,44] {
    precondition(shouldRecordKey(key,flags:[]))
}
for key:Int64 in [0,18,24,30,41,43,49,51,65,82,115,117,119,123,124,125,126] {
    precondition(isEditingKey(key,flags:[]))
    precondition(isEditingKey(key,flags:.maskShift))
    for flags:CGEventFlags in [.maskCommand,.maskControl,.maskAlternate] { precondition(!isEditingKey(key,flags:flags)) }
    precondition(isEditingKey(key,flags:.maskSecondaryFn) == [115,117,119,123,124,125,126].contains(key))
}
precondition(isEditingKey(36,flags:.maskShift))
for key:Int64 in [36,48,53,76,122] { precondition(!isEditingKey(key,flags:[])) }
print("PASS")
