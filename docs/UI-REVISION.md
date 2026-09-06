# 紧凑事件流 UI 修订

## 视图

主视图为 36px 单行事件流，时间使用 MM-DD HH:mm:ss.SSS；正文单行省略，Action 使用观察绿色，Agent 与 Sub-agent 使用暖色。移除侧导航、统计卡、大聊天卡和常驻检查器。底部左侧设置与观察开关，底部紧凑输入。空态仅一行“暂无事件”。

子会话按 childId 聚合到父任务，默认折叠，父行状态同步真实 agent.status；展开后显示模型输入、输出、工具调用及工具结果。工具调用与结果各自独立；not_executed 从协议 JSON 状态判定，isError 显示失败，不以摘要文字猜测执行结果。

选中事件后才打开右侧 Sheet。详情包含事实/输入输出、AX 折叠树、Raw/Context、Before/After 截图与实际时间差、OCR、理解及队列状态、原始 JSON 与复制。选择保持稳定；异步观察返回按 actionId 校验，避免旧响应覆盖新选择。向上滚动暂停跟随。

设置使用三个 Tabs：屏幕理解 / 主 Agent / Sub-agent。每组独立 protocol、Base URL、Model ID、API Key；空白 Key 保存保留已有 Key，清除按钮显式清除。模型名不做 Gemini 特例校验。采集 Bundle IDs、开关、权限为简短字段组，Fixture 明确标“合成”。

## 组件来源与构建

使用官方 shadcn CLI 执行 info、search @shadcn、docs 和 add @shadcn；components.json 指定 Radix/new-york，Tailwind v4，别名 @ 指向 src/renderer。正式添加 Sheet、Dialog、Tabs、Button、Field、Select、Input、Badge、Collapsible、Separator、Alert、Empty 及 Label，逐个阅读核对。CLI 输出的 cn 包导入统一改成本项目 @/lib/utils；没有仿造对应组件。

scripts/build.ts 在 esbuild JS 打包之后运行 Tailwind CLI，编译 src/renderer/style.css 到 dist/renderer/app.css。macOS 包包含已编译 CSS 与 JS，不依赖运行时 CDN。scripts/package.ts 支持可选 PROACTIVE_ELECTRON_ZIP_DIR；首次下载遇到 ECONNRESET 后，复用本机同版本 44.1.1 ZIP 成功打包。

## 验证

类型检查通过；新增四项投影测试覆盖：工具调用/结果与未执行提案/错误、子代理归组、statement 提取与月日毫秒、live/final 去重。全套21项测试通过，含后端三角色与队列测试。Swift、Tailwind、Electron 构建与 macOS 打包已执行。交互/视觉验收由主 Agent 使用真实窗口进一步核验，本 Agent 未自行启动或操作 GUI。
