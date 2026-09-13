# 自身操作排除

输入监听先根据 AX 命中 PID 和窗口 PID 排除宿主自身。Dock 全屏覆盖层可能先于实际窗口命中；AX 缺失时，只有原生事件目标为宿主且点击位置最前普通窗口也属于宿主，才排除这一覆盖层误归属。

原生事件目标 PID 可能仍是旧前台，因此不能单独用于过滤。其他 Electron 应用也不能按通用 Bundle ID 排除。点击穿透的自身弹幕仍不参与窗口命中。

宿主 AXRecorder 在截图、保存和理解投递前，再检查事件、目标窗口和 AX 命中 PID，以及专用打包身份。历史记录不会因此删除。

验证：`bun test --timeout 15000 tests/window-target.test.ts tests/ax-recorder.test.ts`。原生测试覆盖 Dock 遮罩、AX 缺失、真实 Dock 命中及切换外部窗口；宿主测试覆盖零截图、零落盘、零投递以及外部 Electron 不受影响。

修改原生监听后需退出旧应用，再运行 `bun run desktop` 构建并启动。自动化策略测试不等同于真实桌面点击验收。
