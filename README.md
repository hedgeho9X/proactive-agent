# Proactive Agent

macOS 主动式 Agent 实验项目，采用 [Apache-2.0](LICENSE) 许可证。当前是开发原型，不是完整生产产品。

## 从源码运行

需要 macOS 15+、Xcode Command Line Tools / Swift 和 Bun 1.3.14+。

```bash
git clone https://github.com/hedgeho9X/proactive-agent.git # 获取源码
cd proactive-agent # 进入项目
bun install --frozen-lockfile # 安装依赖
bun run desktop # 构建并启动桌面应用
```

启动后在设置里填写自己的模型服务地址、Model ID 和 API Key，并由你在 macOS 中授权辅助功能、输入监控和屏幕录制。默认服务地址与模型名是开发配置，不代表公开免费服务，请按自己可用的接口修改。Tavily 为可选配置；没有配置时不开放 Web 工具。

## 数据与隐私

启动观察后会采集其他应用的窗口截图、AX 和输入活动，编辑会话可能保存应用暴露的输入框全文。数据默认保存在本机 Application Support/Proactive Agent 中，不属于 Git 仓库；开启 AI 理解后，选中的截图和文字会发往你配置的模型服务，Web 工具会向配置的搜索服务发送查询。

安全输入与 AX 安全文本控件会被排除，但这不是完整的敏感信息检测器。请勿在处理敏感信息时开启观察，也不要把自己的历史数据、配置文件或包含正文的 Trace 上传到 issue。问题反馈优先使用合成数据和脱敏错误码。详情见 [安全说明](SECURITY.md)。

本轮详情结构为「截图 / 原始输入 Prompt / 观测 / AX 树」，观测提供运行、轮次与工具的 Span 树；截图优先使用实际模型输入图。编辑过程持续保存证据，但不逐条触发理解，见 [编辑会话边界](docs/EDITING-SESSIONS.md)。AX 能力和截图可用性依赖目标应用；发送成功确认、可靠跨应用最终行为归并仍未完成。

屏幕理解支持有界 Agentic 取证：历史标题、动作详情、图片、AX/OCR 和应用背景；设置中配置 Tavily Key 后启用网页搜索和提取。调用步骤可在 AI 请求详情中查看，见 [Agentic Understanding](docs/AGENTIC-UNDERSTANDING.md)。

所有项目自有静态 Prompt 集中在 [prompts/](prompts/README.md)，角色、动作模板与工具说明分文件管理。

独立 macOS 主动式 Agent 实验应用：原生动作与证据采集、React 调试工作台、DSH 主子代理，以及基于 Vercel AI SDK 的屏幕事实理解。默认采集关闭，无模型凭证时显示 unavailable；Fixture 演示不调用真实模型。

使用 Bun 1.3.14+、macOS Swift 工具链。安装执行 `bun install --frozen-lockfile`；`bun run desktop` 编译并启动；`bun run package:mac` 生成独立 `.app`。桌面使用 Electron 自身的 Node 运行编译JS sidecar，不依赖用户机器上的系统 Node。

`bun run typecheck`、`bun run format:check`、`bun run test` 验证代码。运行时测试包含真正20秒后台子任务。`bun run demo` 是无桌面采集、无真实模型的短命令行演示。

列表与状态刷新只读取轻量摘要，完整 AX、Prompt 和图片仍可在详情中按需查看。性能瓶颈、实测数据和复测方式见 [性能验证](docs/PERFORMANCE.md)。

屏幕理解使用 `ai` 的 `generateText + Output.object`，OpenAI-compatible 通过 `@ai-sdk/openai-compatible`，Gemini 原生协议通过 `@ai-sdk/google`。现有模型、Base URL、加密凭证及中文 Prompt 不变；主 Agent/Sub-agent 继续使用 DeepSeek Harness。详见 [屏幕理解 SDK 边界与验证](docs/UNDERSTANDING-SDK.md)。

API Key 在本机通过 Electron safeStorage（macOS 系统钥匙串）加密保存，重启后恢复三个角色各自的凭证；不写入源码、Git、明文配置或界面快照。系统加密不可用时保存报错，不降级为明文。设置中的「清除 Key」同时删除对应角色的本地密文；清空历史保留配置和凭证。本应用不读取旧应用配置。文件工具只读取用户选定目录，所有外部业务写工具仅生成 not_executed 提案。`send_danmaku` 是真实执行的本地桌面展示工具，不修改业务数据。Web / 日程读取 provider 尚未配置。跨重启任务业务索引、正式签名、公证及完整PRD验收仍未完成。

## 桌面弹幕与详情侧栏

详情顶部展示 AI 理解，截图与 Prompt、观测分 Tab；AX 和采集诊断默认折叠，截图标注固定默认显示，无需配置颜色或透明度。当前结构见 [理解追踪](docs/UNDERSTANDING-TRACE.md)。

- 点击详情侧栏外部或切换到桌面、其他应用时自动收起；截图放大与右键复制菜单仍可正常使用。
- 设置 →「测试桌面弹幕」无需模型即可预览。也可以清除弹幕或关闭弹幕；开关只对本次启动生效，重启默认开启。
- 配置好主 Agent 后，可在底部输入「请发一条弹幕提醒我休息」。Agent 可调用 `send_danmaku`，参数为 `text`（1–80 字）与可选的 `duration_seconds`（4–12 秒，默认 8 秒）。工具是否被调用由模型决定。
- 弹幕在鼠标所在显示器的工作区上方从右向左飘过，透明窗口不抢焦点、鼠标点击穿透。系统开启减少动态效果时改为短暂静态展示。
- 同时最多一条，两次开始展示间隔至少 5 秒；忙碌时返回 `rate_limited`，不排队刷旧提醒。关闭后返回 `disabled`；渲染确认后才返回 `shown`，该状态不等于用户已经阅读。
- 屏幕/AX/OCR 内容仍是不可信证据，不能指令 Agent 发弹幕；提示词要求普通操作保持安静，不展示凭证或完整聊天正文。弹幕可能被旁人看到，敏感场景请关闭。

实现与验收边界见 [桌面弹幕验证](docs/DANMAKU-VERIFICATION.md)。

## 清空全部本地历史

主页面「清空全部本地历史」会在确认后自动停止采集和 Agent，清空截图/AX、旧观察流水、理解缓存、待处理队列和 Agent 会话，保留模型配置及系统权限。旧数据整体移到废纸篓，可恢复。界面显示清理阶段、完成结果；移入废纸篓失败时可重试，重试不会删除新记录。详见 [清空验证与恢复方式](docs/CLEAR-HISTORY-VERIFICATION.md)。

## 当前动作理解与 Agent 轨迹

主列表仅展示理解完成的 `Action title / Action detail`；「队列／原始记录」查看处理中、失败和未选中的原始证据，「主 Agent／工具」查看主动提议与工具轨迹。侧栏的「AI 理解追踪」展示实际中文 Prompt、模型输入图片、完整输入和输出。前后 Diff 已移除，跨卡片直接切换侧栏，图片默认适应窗口。

设置中可编辑三角色中文 Prompt，理解并发默认 10。主 Agent 按批次接收带时间和 Action ID 的摘要，可按 ID 取 AX/OCR/标注图，并通过弹幕提出建议。默认新触发配置包含 Enter、空格与点击，已有自定义配置不会覆盖。完整行为和验证边界见 [当前动作理解](docs/ACTION-UNDERSTANDING.md)。

采集现在按事件锁定窗口 ID，不再要求 AX 尺寸唯一匹配；前台状态在主线程读取，之后切换应用不会改拍新前台。只有真正取得图片才算成功并允许 AI 理解，无图或系统错误会在侧栏显示具体原因、阶段和目标窗口。详见 [窗口截图规则与验证](docs/WINDOW-CAPTURE.md)。旧失败记录无法补造当时图片，需要重启后重新操作采集。

- [需求](docs/PRD.md)
- [实施进度](docs/IMPLEMENTATION-STATUS.md)
- [S0 验证](docs/S0-RUNTIME-VERIFICATION.md)
- [桌面与模型验证](docs/DESKTOP-MODEL-VERIFICATION.md)
- [原生采集验证](docs/S1-CAPTURE-VERIFICATION.md)
