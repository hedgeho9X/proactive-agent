# Proactive Lab

独立 macOS 主动式 Agent 实验应用：原生动作与证据采集、React 调试工作台、DSH 主子代理，以及可配置的 Gemini 事实理解。默认采集关闭，无模型凭证时显示 unavailable；Fixture 演示不调用真实模型。

使用 Bun 1.3.14+、macOS Swift 工具链。安装执行 `bun install --frozen-lockfile`；`bun run desktop` 编译并启动；`bun run package:mac` 生成独立 `.app`。桌面使用 Electron 自身的 Node 运行编译JS sidecar，不依赖用户机器上的系统 Node。

`bun run typecheck`、`bun run format:check`、`bun run test` 验证代码。运行时测试包含真正20秒后台子任务。`bun run demo` 是无桌面采集、无真实模型的短命令行演示。

API Key 仅保留在本次进程内存；本应用不读取旧应用配置。文件工具只读取用户选定目录，所有外部业务写工具仅生成 not_executed 提案。`send_danmaku` 是真实执行的本地桌面展示工具，不修改业务数据。Web / 日程读取 provider 尚未配置。跨重启任务业务索引、正式签名、公证及完整PRD验收仍未完成。

## 桌面弹幕与详情侧栏

- 点击详情侧栏外部或切换到桌面、其他应用时自动收起；截图放大与右键复制菜单仍可正常使用。
- 设置 →「测试桌面弹幕」无需模型即可预览。也可以清除弹幕或关闭弹幕；开关只对本次启动生效，重启默认开启。
- 配置好主 Agent 后，可在底部输入「请发一条弹幕提醒我休息」。Agent 可调用 `send_danmaku`，参数为 `text`（1–80 字）与可选的 `duration_seconds`（4–12 秒，默认 8 秒）。工具是否被调用由模型决定。
- 弹幕在鼠标所在显示器的工作区上方从右向左飘过，透明窗口不抢焦点、鼠标点击穿透。系统开启减少动态效果时改为短暂静态展示。
- 同时最多一条，两次开始展示间隔至少 5 秒；忙碌时返回 `rate_limited`，不排队刷旧提醒。关闭后返回 `disabled`；渲染确认后才返回 `shown`，该状态不等于用户已经阅读。
- 屏幕/AX/OCR 内容仍是不可信证据，不能指令 Agent 发弹幕；提示词要求普通操作保持安静，不展示凭证或完整聊天正文。弹幕可能被旁人看到，敏感场景请关闭。

实现与验收边界见 [桌面弹幕验证](docs/DANMAKU-VERIFICATION.md)。

## 清空全部本地历史

主页面「清空全部本地历史」会在确认后自动停止采集和 Agent，清空截图/AX、旧观察流水、理解缓存、待处理队列和 Agent 会话，保留模型配置及系统权限。旧数据整体移到废纸篓，可恢复。界面显示清理阶段、完成结果；移入废纸篓失败时可重试，重试不会删除新记录。详见 [清空验证与恢复方式](docs/CLEAR-HISTORY-VERIFICATION.md)。

- [需求](docs/PRD.md)
- [实施进度](docs/IMPLEMENTATION-STATUS.md)
- [S0 验证](docs/S0-RUNTIME-VERIFICATION.md)
- [桌面与模型验证](docs/DESKTOP-MODEL-VERIFICATION.md)
- [原生采集验证](docs/S1-CAPTURE-VERIFICATION.md)
