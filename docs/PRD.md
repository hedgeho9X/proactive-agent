# Proactive Lab：持续观察与异步行动 Agent

版本：v1.0，研究与实施交接稿
日期：2026-09-06，Asia/Shanghai
产品负责人：Jerry
交付性质：产品需求、技术决策、协议约束、调试设计与验收计划；本轮未实现、未启动屏幕采集、未调用付费模型。
工作名：Proactive Lab；最终产品名和仓库名不构成开工前置条件。

## 0. 阅读与决策约定

本文中的“必须”是首版验收要求；“建议默认值”是待基准测试调整的初值；“研究事实”有来源；“待验证”不能被实现 Agent 写成已经具备的能力。

配套文件：[调研依据](RESEARCH.md)提供源码与官方资料证据，[实施交接说明](IMPLEMENTATION-HANDOFF.md)提供实施边界和执行顺序。本文涉及的 service、方法和字段，除明确标注上游 API 外，均为**本项目拟定契约**，不能直接当成第三方 SDK 导出名称。

快速阅读：第0–4节看产品范围与选型；第5–9节看采集、过滤、SQLite和事实理解；第10–12节看Agent原子、工具Schema与事件；第13–17节看UI、调试和验收；第18–20节看实施切片与交付。准备交给实施Agent时先读配套交接说明。

### 0.1 已确认的用户要求

1. 新建独立包与独立桌面应用，尽量不受旧 Proactive Agent 代码结构约束。
2. 持续观测用户电脑行为，关联时间、action ID、AX、OCR、截图，并用 SQLite 存储证据。
3. 对行为产生简短、基于证据的事实摘要；重点验证 AI 能否读懂用户正在做什么。
4. 高频打字、重复窗口点击、冗余 AX 节点不能淹没 Agent；过滤本身必须可调试。
5. 长期主 Agent 接收新事件，复杂工作委派给子 Agent，并能持续纠正执行方向。
6. 尽可能复用 DeepSeek Harness 的同一套基础原子；首版不要求插件安装、市场或管理界面。
7. 界面简洁，但调试能力完整：事件流、可展开 AX 树、截图、OCR、事实摘要、主子 Agent 消息和工具调用。
8. 当前先实现运行闭环与工具 Schema，不要求所有业务工具真实连接外部服务。
9. 本轮只调研和产出详细 PRD，最终实现交给另一个 Agent。

### 0.2 本文采用的工程假设

| 项目 | 首版默认 | 修改条件 |
| --- | --- | --- |
| 操作系统 | macOS 15+、Apple Silicon | 跨平台另立范围；macOS 最低版本须由原生 spike 校验 |
| 使用方式 | 单用户、本机桌面实验应用 | 首版无登录、团队、多租户或云同步 |
| 界面 | Electron + React + TypeScript | 若原生 spike 证明不可行再评估其他壳，不同时实现两套 UI |
| 依赖管理 | Bun、单一 `bun.lock` | 上游运行时允许需要 Node；包管理工具与运行时分开 |
| 业务工具 | 外部写操作使用 proposal 模式 | 将来接真实工具时单独增加执行验收 |
| 模型 | 感知、主代理、子代理可分别配置 | 不用一个硬编码模型承担所有角色 |
| 研究产物位置 | 当前独立文档目录 | 实施时迁入新项目的文档目录 |

## 1. 产品目标与首版问题

产品目标：提供一个持续存在的主动式 Agent。它能依据用户活动和外部事件形成当前情况的理解，选择继续观察、查证、表达、委派、更新或停止任务；所有关键输入、决策和执行结果可回看。

首版用于回答四个问题：

1. **看得对吗？** 一次点击/按键/滚动关联的证据是否正确，摘要是否有事实依据？
2. **注意得对吗？** 哪些事件被合并、忽略或送入上下文，是否漏掉关键变化？
3. **协作得对吗？** 子代理执行时，主代理能否继续接收事件，并影响进行中的工作？
4. **能解释系统状态吗？** 从一个工具意图能否回到触发它的 action 和原始证据？

首版成功不以“主动弹了多少条建议”衡量。安静等待是合法决策；观察证据不足时，应能明确表达未知。

### 1.1 首个完整演示故事

在受控测试页面里，用户看到“周五评审改到周一”，系统记录动作及证据并形成事实摘要。主 Agent 结合显式关注事项“帮助跟进评审安排”派出日程子代理。子代理读取测试日程，生成修改意图。随后页面内容变成“仍然周五”，新事件进入主 Agent，旧任务被更新或作废。界面呈现两次观测、两次决策、任务版本变化及最终结果；真实日历没有被修改。

这条故事同时检验：信息获取、上下文连续性、异步委派、纠偏、Schema 校验、proposal 与真实结果的区别。

## 2. 范围与交付优先级

### 2.1 P0：首版必须实际可运行

| 编号 | 需求 | 可见交付 |
| --- | --- | --- |
| CAP-01 | 采集鼠标点击、按键、滚动、应用/焦点/窗口变化 | 每个已接收原始事件有 ID 和时间；可看过滤前记录 |
| CAP-02 | 关联 AX、截图、OCR | SQLite 中存在证据内容，或明确缺失/跳过状态 |
| CAP-03 | 高频合并、上下文过滤 | 原始流/语义流切换；每次处理有原因与规则版本 |
| PER-01 | 多模态事实摘要 | 简短陈述、证据引用、不确定性、模型与耗时 |
| AGT-01 | 长期主 Agent 与会话恢复 | 多批事件承接同一会话；重启后能回看并继续 |
| AGT-02 | 异步子 Agent | 派发立即返回；后续进展与结果独立回流 |
| AGT-03 | 任务更新/取消/版本失效 | 后来的事实可改变正在执行的任务 |
| ATM-01 | 统一原子与工具目录 | 工具 Schema、可用性、执行模式、事件来源可检查 |
| ATM-02 | 最小真实基础工具 | 读取观测/证据、检索本地记录、读取测试目录文件、任务管理 |
| ATM-03 | 业务工具 proposal | 日程 CRUD、记忆写入、文件写入的参数与意图可见 |
| UI-01 | 实时调试界面 | 时间线、证据检查器、主子代理轨迹、运行状态 |
| DBG-01 | 离线回放与受控评估 | 采集后可反复比较过滤和模型；不重复驱动系统鼠标 |
| EVT-01 | 定时与 Webhook 事件入口 | 本地测试事件可唤醒主 Agent，包含去重与来源标记 |

### 2.2 P1：P0 稳定后扩展

- 可配置真实 Web Search / Fetch Provider，支持引用来源；P0 已有相同 Schema 和显式 fixture 实现。
- 可编辑的观察关注事项与简单事件订阅；P0 先提供一份可见、可修改的关注配置。
- 更丰富的统计、模型对比报告、导出样例。
- 更长运行时间、更复杂多屏及更多应用适配。
- 真正的外部日程/文件写操作；须保留任务版本检查和结果归因。

### 2.3 本轮与首版不做

- 本轮不创建应用工程、不安装运行参考项目、不采集用户真实行为、不连接真实日历、不执行模型费用测试。
- 首版不做插件安装器、插件市场、动态下载第三方代码、自动写插件或自我修改。
- 不迁移 Proactive Agent 历史数据库、旧主动式建议链、账号、计费、Gateway 或生产部署。
- 不把每种主动式场景编码成一条固定业务 pipeline。
- 不引入通用 Shell、鼠标键盘自动控制、任意系统写入作为首版默认工具。
- 不承诺恢复操作系统未提供的事件、不承诺获取所有应用完整 AX、不把推测的用户意图标为事实。

## 3. 调研结论与复用策略

| 来源 | 确认的价值 | 本项目采用方式 | 不能直接继承的假设 |
| --- | --- | --- | --- |
| DeskLore | Swift 输入/AX 监听、结构化 tree/delta、SemanticFrame、重复事件处理、Pi 时间线 Agent | 参考实现与测试场景；必要的小段代码按许可迁入新项目 | 已核实 history 存储为文件模型；当前 Pi 时间线生成并非本需求的长期编排器 |
| DeepSeek Harness / Cordis | 服务与事件组合、Agent 会话/inbox、子代理、持久轨迹等原子 | 首选唯一 Agent runtime；增加小型内置主动式桥接模块 | 开发者预览；内部方法不一定已经暴露为桌面可用 IPC |
| Pi | 模型/Agent/编码工具分层，文件读取等工具原语 | 研究工具语义；DSH 已有等价工具时优先使用 DSH | 不额外再启一套 Pi 主代理、会话或调度器 |
| AI SDK ToolLoopAgent | 多步工具调用、结构化输出、流式与步骤控制 | 作为对照；只有 DSH 接入被实证阻断时才评估替代 | 基础子代理调用不自动满足异步委派；不能和 DSH 并列持有主 loop |

来源、版本、文件路径和具体差距见 `RESEARCH.md`。实施必须保留第三方许可证与归属，不能将“参考”写成“已完成集成”。

### 3.1 DeskLore 最新版本的具体借鉴点

当前远端固定 SHA 为 `8851346c7e544b6da07372d7a9a5aca9f81317f1`，比本地研究起点领先45次提交。以下采用最新10文件定向核实，不把旧版阈值当成当前事实：

- AX已经有结构化tree/delta，SemanticFrame将正文、导航和窗口控件分区；派生函数可对历史快照重跑。
- 恢复sibling文档顺序，优先最深focus，并对聊天/终端正文保留尾部；这些用于证据组织，不能直接证明用户意图或“刚新增”。
- 原生AX遍历有节点数/深度/总时限，tracker使用有限窗口基线缓存；缺少delta基线时不伪造完整frame。
- 已读输入mask仍不含scroll，普通字符不逐键形成历史事件；本项目必须补raw action层。
- 当前Pi具备step/continue/abort和按需读取证据，但任务仍是十分钟timeline；本项目持续inbox和任务纠偏优先使用DSH。

应复用上述处理思想及可验证的小组件，保留原始树、事件时序和裁剪理由。最新源码和旧版补证策略的证据分别列于研究附件。

## 4. 系统结构与责任边界

### 4.1 运行组件

| 组件 | 责任 | 不承担的责任 |
| --- | --- | --- |
| macOS Collector，独立 Swift 进程 | 被动监听、AX 读取、屏幕帧、OCR、时间与应用标识 | 不调用主模型，不做业务决策，不阻塞输入回调 |
| Observation Service | 原始事件归档、关联证据、合并、生成上下文视图、调度事实摘要 | 不根据固定场景直接创建日程等业务工作 |
| Evidence Store | SQLite 单一写入口、内容存储、版本、查询、保留与回放 | 不保存 API key，不直接作为模型消息协议 |
| Harness Sidecar | DeepSeek 主代理/子代理、会话、工具执行与流式事件 | 不承担高频原生捕获回调 |
| Proactive Bridge | 观察事件接入、受限 runtime 控制、工具目录和任务版本桥接 | 不重新实现 DSH Agent loop，不动态安装插件 |
| Electron 主进程 | 应用生命周期、进程监督、受限 IPC、窗口 | 不在 UI 主线程做 AX 遍历、OCR 或大量 BLOB 写入 |
| React 调试界面 | 时间线与检查器、控制、检索、回放 | 不持有模型凭证，不直连系统采集或数据库 |

建议由独立存储 worker/服务串行写 SQLite，Collector 和 Harness 通过协议提交数据；具体驱动由 Electron/Node ABI spike 选择。Bun 用于工程依赖与脚本，不因此强迫 Electron 主进程使用 `bun:sqlite`。

这些组件是责任分工。它们可以并行工作：AX 失败不阻止截图落库，摘要延迟不阻止后续原始事件到达，子代理运行不阻止新观测入队。

### 4.2 新项目布局建议

独立仓库建议名 `proactive-agent`，与现有业务仓库并列。未在本轮创建。

| 路径 | 所有权 |
| --- | --- |
| `apps/desktop` | Electron/React 界面与桌面生命周期 |
| `packages/contracts` | 事件、证据、工具、UI 投影协议及运行时校验 |
| `packages/observation` | 关联、过滤、摘要调度和 Evidence Store |
| `packages/proactive-runtime` | DSH bridge、内置能力模块、运行时适配 |
| `native/collector` | Swift 采集与原生协议 |
| `fixtures` | 合成/获准脱敏的测试观察及预期结果 |
| `docs` | 本 PRD、研究证据、实施记录 |

不从现有 Proactive Agent 工作树相对导入代码，不通过软链接依赖旧业务内部实现。起步可把几个 TS package 作为清晰模块，只有需要独立构建边界时再拆包，避免空壳层级。

## 5. 行为采集：先确保可追溯

### 5.1 “每个 action 都捕捉好”的精确定义

- 对**当前权限、应用范围和系统 API 实际交付的每个已订阅事件**，先产生唯一 `action_id`，保留轻量事件元数据。
- `action_id` 在任何模型调用之前生成，不从摘要文字或截图文件名推导。
- 原始 action 不等同于语义活动。几十次滚动可以属于同一个 `activity_id`，但原始 ID 不消失。
- 每个 action 可查询其 AX、OCR、截图关联状态。允许多个 action 引用同一份证据，但必须显示是否共享及相对时间差。
- 不能为满足非空字段，把新窗口截图标成旧窗口的精确现场。
- 不能在高频输入下承诺每个按键都有独立全量 AX、独立 OCR 和独立模型调用。首版通过轻量逐事件记录与重证据共享/抽样分别满足可追溯性与资源边界。

### 5.2 原始事件范围

| 类别 | 必须记录 | 处理要求 |
| --- | --- | --- |
| 鼠标 | 左/右/中及其他按钮 down/up、点击计数、坐标、修饰键 | down/up 关联；点击目标不能仅靠前台 app 猜测 |
| 拖拽 | 起点、终点及必要阶段 | 高频移动聚合；不把拖拽中每一点当独立有意义点击 |
| 键盘 | key down/up、重复标记、修饰键变化、按键类别 | Space/Enter/Escape/Tab/快捷键可具名；普通输入默认不保存逐字文本 |
| 滚动 | x/y delta、设备提供的 phase/momentum、时间、目标窗口 | 连续滚动合并；方向变化与 viewport 变化可分段 |
| 应用/窗口 | app activated、窗口创建/关闭/焦点改变、标题变化（可得时） | 作为辅助观测，不保证所有 app 都发所有通知 |
| AX | focus/value/selection 等支持的通知 | 记录订阅失败和能力范围，不把缺少通知视为没有变化 |
| 系统 | idle/resume、锁屏/解锁、sleep/wake、采集器状态 | 切分时间基准与证据有效期；按设置暂停/恢复 |

普通鼠标移动首版只在拖拽、目标定位或诊断模式需要时采样。不能将全屏 mouse move 作为默认高频 LLM 输入。

### 5.3 ActionEnvelope 字段契约

| 字段 | 类型/必需 | 含义 |
| --- | --- | --- |
| `schema_version` | string，必需 | 采集协议版本 |
| `action_id` | string，必需 | 一次原始事件的稳定 ID |
| `capture_session_id` / `collector_epoch` | string，必需 | 区分采集会话及进程重启 |
| `source_sequence` | uint64 的十进制字符串，必需 | 采集进程内递增；避免 JS 数字精度丢失 |
| `occurred_at` / `received_at` | UTC ISO 8601，必需 | 事件发生与服务接收时刻 |
| `monotonic_ns` | 十进制字符串，必需 | 同一 epoch 内的相对顺序和耗时 |
| `timezone` | IANA timezone，必需 | 发生时的本地展示与时间表达解释 |
| `kind` | enum，必需 | `mouse_down`、`key_down`、`scroll` 等 |
| `actor` | enum，必需 | `human`、`system`、`agent`、`unknown` |
| `origin` / `trust_class` | enum，必需 | native observation、direct user、external event、runtime；观测不成为授权 |
| `app` | object，可部分缺失 | pid、bundle ID、显示名 |
| `window` | object，可部分缺失 | window ID、title、bounds、display ID |
| `input` | 按 kind 区分的 object | mouse/button/delta/key category/modifiers 等 |
| `target_hint` | object，可空 | 命中 AX 节点、role/title/bounds、取得方式、可信程度 |
| `causation_id` / `correlation_id` | string，可空 | 事件因果链与一次活动组 |
| `policy_status` / `reason_codes` | enum / array，必需 | 允许、受保护、排除、合并等，不隐藏处理结果 |

时间显示例如 `2026-09-06 12:25:03.418 +08:00`。用户举出的非真实日期仅表达“需要精确时间”，不作为合法时间格式。时钟跳变时继续依赖 epoch 内 monotonic 顺序；跨 epoch 不直接比较 monotonic 数值。

### 5.4 采集与证据的时序

1. 回调中仅构造轻量事件并放入有界队列，不能同步遍历 AX、OCR、编码截图或请求模型。
2. 鼠标 down 时尽早进行异步命中定位；前台应用与坐标命中应用都记录，点击非前台窗口时二者可能不同。
3. 保留最近屏幕帧的短内存环形缓冲；重要事件关联最近 before 帧及稳定后的 after 帧。不承诺真正原子快照。
4. AX 遍历独立执行，记录开始/结束时间、目标 pid/window、耗时和节点限制；其间 app/window 变化则标记不稳定。
5. OCR 必须引用实际处理的 `screenshot_artifact_id`，不能只按相近时间猜测关联。
6. 证据可以迟到。迟到追加形成新的 observation revision，不能悄悄改写已产生摘要的输入。
7. 高负载时优先保住原始元数据与关键事件证据；重证据被跳过也必须留下原因。

### 5.5 原生技术方向

- 被动输入监听候选：CoreGraphics `CGEventTap`，使用 listen-only 语义；真实权限和事件覆盖由签名开发应用验证。
- 应用切换/AX：NSWorkspace + AXObserver + AXUIElement；采用节点数/深度/总时限边界，防止无响应 app 卡死采集。
- 截图：ScreenCaptureKit；单帧 API 与低频帧缓存做对比 spike，选能满足时序和资源目标的一条主路径。
- OCR：Apple Vision；保留文本块、位置、候选置信度、语言和引擎版本。中文与英文识别用真实样本对比，不假设 fast 模式一定足够。
- 坐标统一：保存全局屏幕坐标、window bounds、截图像素尺寸、scale factor 与转换版本；测试 Retina、多屏负坐标、窗口跨屏。
- 独立展示 Screen Recording、Accessibility、Input Monitoring 三项能力状态，以及设备实际捕获健康。自我排除和没有可观察窗口不等于权限失败。

相关官方依据见研究材料中的 Apple API；本轮只阅读文档和 SDK 头文件，没有运行系统事件监听。

## 6. 过滤：不让信息量与价值混为一谈

### 6.1 三个不同的处理位置

| 位置 | 目的 | 是否可恢复 |
| --- | --- | --- |
| 采集范围/内容保护 | 排除锁屏、受保护输入、用户指定 app 等 | 不采集/不落盘的内容不可恢复；只留必要状态 |
| 时间与重复合并 | 减少同一活动的重复证据与唤醒 | 保留原始 action ID 和归组关系，可回放重新合并 |
| 模型上下文选择 | 只送当前决策有关的节点、差异、摘要 | 可以按 ID 重新读取已保存的原始证据 |

不能用一个 `filtered: true` 混合表示这三类结果。每个阶段记录 `policy_version`、输入 ID、输出 ID、数量变化和原因。

### 6.2 事件处理矩阵

| 情况 | 原始记录 | 语义/模型侧策略 | 必须保留的例外 |
| --- | --- | --- | --- |
| 普通连续打字 | 时间、输入类别、计数与 focus，不存逐字符正文 | 合并 typing burst；默认不逐字唤醒 | 切换输入目标、结束编辑、明确提交等边界 |
| 单个 Space | 有该按键事件 | 不能仅凭键名判断输入空格 | 播放/暂停、Quick Look、勾选、翻页等结果变化 |
| Enter | 有该按键事件及焦点 | 结合 app/焦点/前后变化判断 | 编辑器换行、IME 候选确认不等于发送 |
| 快捷键 | 键组合与窗口 | 保存可观察结果 | Cmd+W/Cmd+S/Cmd+Enter 含义随 app 改变 |
| 同一窗口反复点击空白 | 每次 ID 可检索 | 位置+焦点+内容未变则合并 no-change | 点击同位置但弹窗/状态改变时不能去重 |
| 按钮点击 | 事件与命中路径 | 保留目标，压缩无关按钮 | 保存、发送、删除、关闭等被操作节点不得被整体 role 规则删除 |
| 连续滚动 | 原始 delta 与归组关系 | 汇总方向/范围/viewport 变化 | 新区域出现重要内容、滚动方向反转 |
| 选择文本 | AX selection 与鼠标/键盘证据 | 合并拖拽，结束时形成事件 | 不能认定选择就是复制或提交 |
| 应用切换 | source/target app、时间 | 同时保留之前活动的结束与新活动开始 | 极短切换仍可见，是否唤醒由上下文调度决定 |
| 纯 AX value 噪声 | 来源与变化摘要 | 文本等价/布局变化分类 | 时间、金额、状态等短值变化不能因长度短被删除 |
| 无障碍树缺失 | 错误/原因、截图/OCR | 使用其他证据，降低结论确定性 | 不生成空树后宣布“页面没有内容” |
| 新外部事件 | event ID、source、payload refs | 优先入 inbox | 即使没有用户输入也能唤醒 |

“大多数按钮没意义”落实为**对当前动作无关且没有变化的 UI chrome 可被压缩**，不落实为删掉全部按钮。被点击、被聚焦、最近变化、显示错误/确认结果的节点及其祖先始终优先保留。

### 6.3 默认时间策略：需要调参而非业务硬编码

建议初值：typing/scroll 的安静窗口 300–600ms；持续活动最长 1–2s 形成一个更新；普通重复观测做 100–300ms 微批。所有数值放入可版本化配置，调试面板显示实际值，基准测试后再固化。

这些时间边界只用于调度和资源控制，不判断“用户想做什么”。短时未见变化输出 `no_observed_change`，不能宣称用户行为一定没有价值。

普通输入默认只保留动作元信息和局部内容结果，避免形成逐字键盘记录。测试场景中确需原始字符诊断时，用显式短期诊断模式、受控应用和短保留期；受保护输入始终禁止正文进入证据。

### 6.4 可视化过滤与标注

- 同一 action 查看 Original / Normalized / Context 三种 AX 视图及结构差异。
- 展示原始节点数、保留节点数、重复/超界/敏感/不相关等原因计数。
- 在树节点显示“保留：点击目标”“折叠：重复容器”“移除：屏外且未关联”等标签。
- 支持标注“误删”“应该忽略”“摘要事实错误”“关键节点”，加入回放样本，不自动改规则。
- 同一证据可用不同 policy 版本重跑，结果并列显示，不覆盖原始 run。

## 7. AX 树与多模态证据

### 7.1 “完整 AX”的范围

本文的 raw AX 指：针对采集目标，在权限、可见 API、节点/深度/时限约束内取得的完整原始快照，尚未做模型上下文裁剪。它不是全电脑、全应用、无限节点、绝对同一瞬间的树。

每份树必须包含 coverage：目标 app/window/root、开始/结束时间、节点总数、已访问数、未访问分支、错误、截断原因。未知的“真实总节点数”用 null，不能拿已读取节点数冒充总数。

### 7.2 节点字段

| 字段组 | 内容 |
| --- | --- |
| 标识 | `snapshot_id`、快照内 `node_id`、`parent_id`、children order |
| AX 属性 | role、subrole、title、description、identifier、value（经过内容策略） |
| 状态 | focused、enabled、selected、expanded、可用 actions |
| 空间 | bounds、visible/intersects viewport、coordinate space |
| 文本 | 可得的文本/选区，原始来源及是否截断 |
| 完整性 | 属性读取失败、子树未展开、采集耗时 |
| 关联 | clicked/focused/changed、与截图坐标的映射 |

节点 ID 只保证快照内稳定。跨快照匹配使用 identifier、层级、role、bounds 等证据并记录匹配置信度；不能直接持久化 AX 对象指针作为长期 ID。

### 7.3 模型上下文构造

默认上下文优先包含：应用/窗口/页面身份、触发事件、命中或焦点节点、祖先路径、局部邻域、变化节点、可见正文以及关联截图。重复容器可收缩，但必须保留树的父子关系或可追溯路径。

大树采用视口和交互相关局部树加按需读取。`observation.read_ax_subtree` 必须能读取原始快照中已经保存的分支；无法读取的分支明确返回 unavailable，不能事后从当前界面伪装补成历史快照。

“完整 AX + screenshot 能否更准”作为评估模式保留：同一受控快照分别运行完整可容纳树、过滤树、仅截图、截图+OCR、截图+AX+OCR，并比较事实准确率、关键节点保留率、延迟和 token。大于模型窗口时显示不可比较/截断，不能暗中截掉再声称使用了完整 AX。

### 7.4 截图与 OCR 的展示要求

- 默认展示动作前/后的主窗口截图，标明 before/after、实际时间差、裁剪范围、分辨率和证据状态。
- 可切换全屏或局部证据；点击位置和目标框是 UI 叠层，不写入唯一原始图。
- OCR 以文本块展示，可联动高亮原图区域；复制文本时保留段落顺序。
- 不同屏幕、截图 crop 和 AX 的坐标变换须明确标记。无法正确对齐时关闭叠层并显示原因。
- 对同一张截图的 OCR 结果可以缓存共享；结果必须引用截图内容 hash 与 OCR 配置版本。

## 8. SQLite：证据是内容，不只是文件路径

### 8.1 存储原则

用户要求的 action、AX、OCR、screenshot 内容全部进入本项目本地 SQLite。首版截图以压缩图片 BLOB 保存，AX 以 JSON 文本或带编码元数据的压缩 BLOB 保存，OCR 保存结构化 JSON 及检索文本。

临时导出图、UI 缓存和缩略图不成为唯一原件。多个 action 可以引用同一个去重后的 artifact；删除外部临时文件后，历史证据仍可正常打开。

### 8.2 主要表及字段

| 表 | 关键字段 | 约束/用途 |
| --- | --- | --- |
| `capture_sessions` | id、started_at、ended_at、host/app/build、policy_version、status | 原生采集与配置边界 |
| `actions` | action_id、session_id、epoch、source_sequence、occurred_at、received_at、kind、metadata_json | 唯一 `(epoch, source_sequence)`；原始 action 不被合并覆盖 |
| `activities` | activity_id、kind、start/end、revision、summary_metadata | typing/scroll/重复观测的聚合 |
| `activity_actions` | activity_id、action_id、ordinal | 归组可回溯；避免在一列中保存不可查询的超长 ID 数组 |
| `artifacts` | artifact_id、kind、mime_type、codec、content_hash、blob/text、byte_size、captured_start/end、metadata_json | AX/截图/OCR 实际内容；按类型+hash+编码版本去重 |
| `action_evidence` | action_id、slot、artifact_id nullable、status、delta_ms、source_action_id、reason | slot 如 screenshot_before/after、ax_before/after、ocr；缺失也有行 |
| `observations` | observation_id、activity_id nullable、revision、policy_version、context_manifest、status | 一轮可解释的上下文材料集合 |
| `observation_actions` | observation_id、action_id | 多 action 与 observation 的显式关系 |
| `understandings` | id、observation_id/revision、model_config_id、prompt_version、result_json、input_manifest_hash、usage、timings、status | 每次模型产物独立版本，不覆盖旧结论 |
| `event_outbox` | event_id、kind、payload_refs、sequence、status、attempts、runtime_message_id | SQLite 到 Harness 的可靠交接；至少一次投递+去重 |
| `runtime_event_projection` | projection_sequence、native_event_id、native_session_id、parent_id、native_sequence、event_json、ingested_at | Bridge全局持久投影游标；唯一native(session_id, sequence)；不是第二套会话真相 |
| `task_controls` | task_id、native_child_id、revision、purpose、basis_refs、desired_state、actual_state、result_refs | 业务任务有效性/版本；执行状态以 runtime 事件核对 |
| `tool_intents` | intent_id、task_id/revision、tool、schema_version、arguments_json、mode、status、basis_refs | proposal 模式业务工具意图 |
| `attention_state` | id、version、source、content、updated_at | 显式关注事项、主代理当前理解与未完成事项，区分来源 |
| `model_runs` | run_id、role、provider/model、request_config、usage、latency、error | 费用和故障归因，不保存凭证 |
| `evaluation_annotations` | id、target_refs、label、note、dataset_version | 人工事实/过滤质量标注 |
| `schema_migrations` | version、applied_at、checksum | 仅本新应用本地 SQLite 的版本管理 |

### 8.3 关联状态

`action_evidence.status` 至少包含：`pending`、`captured`、`shared`、`unavailable`、`timed_out`、`excluded`、`skipped_by_policy`、`dropped_by_backpressure`、`expired`。

`shared` 必须说明来源 action/采集时间；`captured` 不隐含精确同步。所有终态缺失必须有 reason，不能用空字符串或一张替代图片遮盖。

### 8.4 写入、检索和保留

- action 元数据先提交，重证据异步追加；状态变化与对应 outbox 事件在同一事务提交。
- 使用 WAL 候选方案支持读写并发，但仍采用单写入口和短事务；不在事务内进行网络调用/OCR。
- UI 列表按稳定 sequence 游标分页，不用 offset 扫描大表；为时间、kind、app、action ID、task ID 和 session ID 建立必要索引。
- 事实摘要/OCR 搜索可用 SQLite FTS；全文搜索索引遵从删除和保留策略。
- 建议开发期初值：证据 24 小时或 2 GiB 先到上限，元数据/摘要 7 天；固定评估样本单独 pin。数值必须可见和可调整。
- 固定评估样本与活跃任务形成强保留引用；普通历史 action 的引用遵从证据 TTL。到期时在事务中解除其 artifact 指针，将关联置为 `expired`，保留原 artifact ID/hash、时间和过期原因。
- 只有不存在尚未到期引用或强保留引用时，才能释放共享 artifact 内容。不能让仍保留7天的普通 metadata 自动阻止24小时证据清理；强保留内容超过体积预算时明确告警，不静默删掉或无上限增长。
- 磁盘不足时停止新重证据写入并发出故障状态，不自动删除整个库、不假装仍正常采集。
- 导出使用一致性快照或正式备份机制，不能运行中只复制 `.sqlite` 而遗漏 WAL；导出时让用户选择具体范围。
- 若DSH为模型输入物化自己的图片附件，该附件是SQLite证据的派生副本，登记原artifact ID与runtime附件ID，纳入同一保留/删除范围。会话可保留过期引用标记，不能因原生附件目录另存一份而绕过证据TTL；具体附件清理接口在S0验证。
- SQLite 备份、性能与保留测试只针对新应用测试库，不访问现有 Proactive Agent 或 Supabase 数据库。

## 9. Screen Understanding：事实陈述服务

### 9.1 输入与职责

输入为 ObservationBundle：触发 action/活动、前台及命中 app/window、近期相关观测、AX 上下文视图、原始证据引用、before/after 截图、对应 OCR、时间差与缺失信息。

输出是短事实摘要与结构化证据，不在这个服务中直接决定日程、记忆写入或用户长期意图。主 Agent 可以跳过等待这个摘要直接查询已有证据，摘要到达后作为新的带版本事件加入。

### 9.2 FactUnderstanding 输出契约

| 字段 | 类型/约束 | 含义 |
| --- | --- | --- |
| `observation_id` / `revision` | 必需 | 精确绑定模型看到的输入版本 |
| `statement` | string，建议 1–2 句中文、约 30–100 字 | 可验证的行为和变化 |
| `activity_kind` | extensible enum | typing、navigation、scroll、selection、submission、window_management、no_observed_change、unknown |
| `app_context` | object | 已知 app/window/url，不确定字段为 null |
| `observed_action` | object | 物理动作、命中目标、可观察结果分开 |
| `facts` | array | 每条 fact 含文字、evidence refs、来源类型 |
| `uncertainties` | array | 未知目标、时差、AX/图像冲突等 |
| `evidence_quality` | enum + reason | sufficient、partial、conflicting、insufficient |
| `meaningful_change` | yes/no/unknown | 当前可见变化；不是对业务价值的最终裁决 |
| `hypotheses` | optional array | 如确需描述可能意图，明确标“推测”，默认收起 |

运行时在结果外层记录 provider/model、prompt/schema/policy 版本、输入 hash、开始/结束时间、token 与状态。模型自报 confidence 只作信号，不能作为真实性保证。

### 9.3 事实表达示例

| 证据 | 合格摘要 | 不合格摘要 |
| --- | --- | --- |
| 鼠标命中关闭按钮，after 窗口消失 | 用户点击该窗口的关闭按钮；之后该窗口不再出现在采集结果中。 | 用户已经完成工作，准备休息。 |
| Space，播放器图标从播放变成暂停 | 用户按下空格，播放器由暂停切换为播放。 | 用户输入了一个空格。 |
| Enter 后输入框清空，但缺少 before/新消息证据 | 用户在聊天窗口按下 Enter；当前证据不足以确定提交内容。 | 用户发送了一条空消息。 |
| 连续输入，输入框有文本变化 | 用户正在编辑当前输入框，期间发生连续输入。 | 用户决定发送这些内容。 |
| 同位置点击三次，无可观察变化 | 用户连续点击当前窗口相同区域，未观察到页面状态变化。 | 用户尝试三次提交但系统失败了。 |

核心约束：看到一个按钮不代表点击它；看到一段消息不代表作者是用户；最后一条消息不一定由刚才 Enter 产生；AX 更精确的拼写不能抹去时间错位或隐藏内容问题。

### 9.4 模型配置与成本

Google 官方当前文档确认 `gemini-3.8-flash` 支持图像输入与结构化输出；其 thinking 支持 low/medium/high，不能配置不支持的 minimal。它是本轮候选，不是已经完成延迟验证的“最小最快模型”。另以官方定位为低延迟/高吞吐的 `gemini-3.5-flash-lite` 作为感知对照。来源见研究材料。

- 感知默认候选为 Gemini 3.8 Flash，thinking low、短输出、结构化约束；所有参数经所选 Provider 实际能力检查。
- 主 Agent、子 Agent 与事实摘要分别计量，可以使用不同模型。
- 摘要缓存基于完整 `input_manifest_hash` 加 prompt/schema/model 配置；manifest必须包含action类型/顺序/元数据、证据before/after角色与时间差、上下文和缺失状态。同一画面上的Enter与Space不能复用同一行为摘要；仅图像压缩/OCR缓存可以单独以图像hash为基础。
- replay 默认复用匹配输入的结果，只有显式比较才新增模型调用。
- 运行费用展示 input/output/cache/reasoning token（Provider 提供时）、请求次数、失败重试与当前预算。
- 价格读取时间和计价版本必须标注；未配置单价时显示 token 和请求数，不伪造金额。
- 预算到达后暂停新增自动模型请求，继续允许采集/回看，并显示待处理数量；不能循环重试消耗费用。

首版需要真实模型闭环，但实机 token、延迟、准确率与持续采集成本均留到实施验证；本文不以估计值冒充 benchmark。

## 10. Agent Runtime：复用 DSH 的同一套原子

### 10.1 技术决策

首选 **DeepSeek Harness 唯一主/子 Agent loop + 随应用发布的固定 Cordis 能力模块 + 小型 Proactive Bridge**。

调研固定的 DSH 仓库快照为 `d347e703908d0406b7a7ef80e3a0e594d86b2215`，提交日期 2026-09-04；这是研究参考，不代表该 SHA 的所有 npm 包已被本应用安装验证。第一实施切片固定相互兼容的包版本和运行时，不使用散落的 latest。

复用范围为 DSH Agent、SessionEvent、inbox、tools、subagent、模型 seam、持久化服务及 Cordis 生命周期。单独引入通用 Cordis 库不能自动得到这些能力。

首版可用内置能力模块组织代码，不提供用户安装入口。这满足“使用同一套原子”的要求，同时避免提前建设插件产品。

### 10.2 已有内部原子与宿主接口缺口

| 需求 | 已研究的 DSH 原子 | 本项目适配责任 |
| --- | --- | --- |
| 会话身份与恢复 | `ctx.agents` / `ctx.sessions` | 关联 capture session、目标与 observation IDs |
| 明确新输入 | `agent.followup` | 用户主动输入作为下一轮消息 |
| 修正当前工作 | `agent.steer` / `agent.send` | 将重要新观测投到允许的 step 边界 |
| 背景补充 | `agent.inject` | 不主动唤醒的证据更新；重要事件不能误用此模式 |
| 当前推理取消 | `agent.cancel` | 区分用户暂停、任务作废、关闭应用 |
| 可继续子代理 | `ctx.subagents.startContinuable` | 任务 ID/版本/证据包映射 |
| 父子沟通 | `ctx.subagents.sendMessage` | 修正内容及处理回执可见 |
| 实时和持久事件 | SessionEvent、live assistant stream | 给 UI 提供增量和最终事件，不丢失父子关系 |

官方 SDK Client 有 sidecar 启动、prompt 入队与 session tree 事件订阅；当前公开 SDK wire 没有完整暴露内部 steer/inject/cancel。**这些方法在 DSH 内部存在，不等于可以直接从 Electron 调 SDK 调用。** Proactive Bridge 应在 sidecar 内调用公开服务接口，再向受信任本地宿主暴露受限协议。

传输优先研究现成 SDK 的可扩展点；没有稳定扩展点时使用单一本地 socket 或 loopback 通道。不能为了接入取消按钮复制一套 loop，也不能假定 SDK 的高层 `run()` 能把最终响应一一对应到某个 action。

### 10.3 本项目 Bridge 拟定协议

下面的方法名是本项目拟定名称，最终 wire 命名可调整，语义必须保留。

| 方法 | 输入 | 输出/事件语义 |
| --- | --- | --- |
| `runtime.initialize` | protocol_version、profile_id、client_instance_id | capabilities、runtime/build、支持的控制/stream 能力 |
| `runtime.deliver` | event_id、session_id、input_refs、delivery_mode、wakeup、idempotency_key | accepted/rejected、message_id；不是处理完成 |
| `runtime.control_task` | task_id、expected_revision、operation、reason、new_context_refs | accepted/conflict/unavailable、control_id |
| `runtime.subscribe` | root_session_id、after_projection_sequence | root 与 descendants 的结构化事件与 live deltas；游标属于Bridge全局持久投影，不是单个DSH session seq |
| `runtime.read_session` | session_id、cursor、limit | 历史记录及下一页 cursor |
| `runtime.pause` / `runtime.resume` | scope、inbox_policy | 状态变化；暂停推理与暂停采集分开 |
| `runtime.shutdown` | grace_deadline、descendant_policy | stopped 或 timeout，并报告未停止资源 |

协议协商必须把 unavailable 返回为明确能力缺口。开始采集不应因为 bridge 某项能力缺失而悄悄切换到另一套 runtime。

DSH原生sequence按各自session递增。Bridge为已持久投影事件分配全局 `projection_sequence`，保留到 `(native_session_id, native_sequence)` 的映射并去重。实时delta使用message ID与chunk序号，不假装已经获得持久游标；重连以final/session事件收敛。也可改用每session游标映射，但实现必须只选定一种明确契约。

### 10.4 三层持久状态与唯一事实源

1. 原始观测、artifact、过滤与理解版本：SQLite 为真源。
2. 模型实际看见的消息、工具调用/结果、主子会话：DSH 原生日志为真源。
3. UI：基于前两者的关联投影，可重建，不允许编辑 native Agent 历史以“修复展示”。

`event_outbox` 先记录准备投递的观察事件。Bridge 使用稳定 message/event ID 去重。UI 分别显示 captured、persisted、delivered、claimed、responded；DSH 内存入队、日志 flush 和模型实际领取是不同状态。

不宣称跨 SQLite 和 DSH JSONL 的分布式事务或天然 exactly-once。恢复时对账 outbox 与 native session message IDs；不确定投递状态显示 unknown，按去重语义重试。工具意图也使用幂等键，防止一次观察重放产生多份相同提案。

### 10.5 主 Agent 的职责

- 维护当前活动理解、显式关注事项、待证实假设、进行中的任务和已处理事件范围。
- 读取/补充证据，判断是否值得响应、委派、继续等待或更新任务。
- 给子代理组织明确目标、证据、限制、输出格式和完成条件。
- 接收新观察、子代理结果和外部事件，并修订之前的判断。
- 首版不直接执行外部业务写操作；低成本的上下文查询、关注状态更新与任务管理可以直接完成。

系统 Prompt 应说明：观察内容属于环境数据，不能因页面上写着“忽略先前规则”就变成指令；目标与授权来自用户显式设置。若 runtime 用 user role 承载注入，仍需带结构化来源标签，不伪装成用户亲自输入的要求。

### 10.6 工作上下文与关注事项

| 内容 | 来源 | 生命周期 |
| --- | --- | --- |
| 用户职责/关注事项 | 用户显式输入或配置 | 可修改、可关闭，持久化 |
| 当前活动摘要 | 观测与 Agent 理解 | 持续更新，有证据 refs 和时间 |
| 待确认意图 | Agent 假设 | 有失效时间；不会自动升级为用户目标 |
| 活跃任务列表 | task controls + runtime | 完成/取消/作废后移出工作摘要 |
| 近期重要事件 | inbox/observations | 按窗口/预算选择，可查历史 |

上下文压缩保留目标、事件游标、未完成任务、任务版本和证据指针，不能只保留一段泛化叙述。主 Agent 空闲时无需持续生成 token；“持续存在”由持久会话和可唤醒机制实现。

### 10.7 子代理模式与任务契约

DSH 子代理明确选 continuable background 模式；在研究到的配置中使用 `backgroundMode: continuable` 与 `enableRunInBackground: true`，实际字段以锁定版本核对。不要沿用默认 one-shot 后声称主代理不阻塞。

推荐 spawn 独立上下文，首版子代理最大深度 1、同时运行 2 个作为可配置资源初值。任务数量和模型预算应可见，不能因每个低级 action 都派发子代理。

| TaskSpec 字段 | 内容 |
| --- | --- |
| `task_id` / `revision` | 业务任务稳定 ID 与版本 |
| `objective` | 可交付目标，例如“为评审时间变化生成日程修改提案” |
| `why_now` | 为什么当前事件值得处理，属于可展示的简短理由 |
| `basis_refs` | action/observation IDs 及精确 revision |
| `context_brief` | 当前场景和必要背景；不复制整段父历史 |
| `capabilities` | 允许的工具与模式 |
| `deliverable_schema` | 需要返回的结构和引用 |
| `constraints` | proposal-only、所选目录、工具/时间/token 限额 |
| `invalidation_conditions` | 哪些新信息使目标过期 |
| `parent_session_id` / `child_session_id` | parent在派发前已知，child在接受派发后回填，不要求模型预先编造 |

应用派发适配器应立即返回或关联 child/message/task IDs。DSH原生 `subagent` 工具的canonical结果是 `kind: continuable` 与 `subagentId`；内部 `startContinuable` 才提供childId/messageId。task ID、revision及完整映射由本项目单一适配定义或事件投影补齐，不能假设原生工具自动返回所有字段。子代理的完整工作保留在自己的轨迹，主代理接收简短结果和可追溯引用。

### 10.8 修正、取消与过期结果

| 阶段 | 含义 |
| --- | --- |
| `queued` | 等待调度，尚未开始 |
| `running` | 正在执行当前 revision |
| `update_requested` | 已收到修正，但执行者尚未确认 |
| `cancelling` | 已发取消请求，尚未观察到停止 |
| `completed` | 当前有效版本结束，结果验证通过 |
| `cancelled` | 已确认停止；不等于外部副作用自动撤销 |
| `superseded` | 旧任务版本失效；旧结果可回看但不得当当前结果使用 |
| `failed` / `interrupted` | 执行失败/进程中断，有原因 |

任务更新使用 expected revision，避免两个更新互相覆盖。晚到结果保留 originating revision；UI 标过期，父代理不能把它写进当前事实。

DSH 的 interrupt 发信不等于子树全部停止。取消任务、暂停当前主代理、停止整应用应分别处理；关闭应用必须收拢后代并确认退出。中断已领取工作不假设自动重放，恢复策略由任务状态决定。

首版即使只产生 proposal，也要在 proposal 入库前校验任务 revision。未来真实写工具必须执行前重新校验任务与目标资源版本，而不能仅依赖“主代理正在观察”。

## 11. 原子能力与工具 Schema

### 11.1 定义方式

能力目录采用唯一可运行定义：工具名、描述、输入 Schema、输出 Schema、执行模式、适用角色、资源约束、实现 provider 和可用状态。优先使用 DSH 的 ToolDefinition/Schema 机制，模型工具描述和 UI 卡片从同一定义投影。

本节字段为实现规范，不要求本轮交付可执行 Schema 文件。实施必须产出真正的校验定义和字段描述，不能只写 TypeScript interface 或把参数当任意 JSON。

本应用自定义工具必须拒绝未声明字段；可选字段缺失使用统一 null/省略约定；ID、日期、数组长度和文本上限须可验证。复用DSH原生工具时检查其开放字段语义，若需同等严格性则在明确的adapter/guard中补齐，不能假设 `defineTool` 默认拒绝额外字段。输入校验失败不产生业务动作。输出校验失败记录明确错误，不能让自然语言“成功”覆盖失败状态。

### 11.2 执行模式与统一结果

| mode | 意义 | 首版适用 |
| --- | --- | --- |
| `live` | 真正执行能力并返回真实结果 | 本地证据查询、读取允许文件、派发/取消、内部状态 |
| `proposal` | 校验参数、记录拟议动作，不修改外部目标 | 日程写入、文件写入、长期记忆写入 |
| `fixture` | 在隔离样例资源上返回确定结果 | 无凭证的日历查询、Web 查询演示 |
| `unavailable` | 当前 provider/权限未配置 | 缺少真实 Search Provider 等 |

工具结果公共字段：`tool_call_id`、`tool_name`、`schema_version`、`mode`、`status`、`data`、`evidence_refs`、`task_revision`、`error`、`started_at`、`finished_at`。

proposal 结果必须带 `proposal_id`、`execution_status: not_executed`、拟操作目标与参数；不能伪造真实 event ID、文件 hash 或成功回执。Fixture 卡片显示“测试数据”，不能与真实网页/日历结果混合呈现。

### 11.3 观察与上下文原子，P0 live

| 工具 | 输入字段 | 输出字段与限制 |
| --- | --- | --- |
| `observation.get` | `observation_id` 必需；`revision` 可选 | 指定版本 metadata、action refs、artifact refs、理解；默认当前版本，响应注明版本 |
| `observation.search` | `query?`、`from?`、`to?`、`app_ids?`、`kinds?`、`limit`、`cursor?` | 有限结果与 cursor；检索元数据/OCR/摘要，默认不返回图片 BLOB |
| `observation.read_artifact` | `artifact_id`、`representation`、`max_bytes?` | 文本/图像附件或明确不可用；不能把 image ID 当图像 token |
| `observation.read_ax_subtree` | `snapshot_id`、`node_id`、`depth`、`max_nodes`、`view` | 子树、coverage、truncation、节点引用 |
| `attention.get` | `scope` | 显式目标、当前理解、关注与任务版本 |
| `attention.update` | `expected_version`、`updates`、`basis_refs`、`source` | 新版本或 conflict；模型不能把 inferred source 改成 user_explicit |

### 11.4 协作原子，P0 live

优先复用 DSH 的 subagent/control tools，并在适配层保留本项目 TaskSpec，不重新注册同义重复工具让模型混淆。

| 产品语义 | 输入 | 输出 |
| --- | --- | --- |
| 派发任务 | TaskSpec | task_id、revision、child_id、message_id、accepted |
| 更新任务 | task_id、expected_revision、new_context_refs、goal_change?、reason | control_id、新 revision、update_requested |
| 子代理消息 | target_child_id、content、context_refs、delivery_mode | message_id、accepted；与 applied 分开 |
| 取消任务 | task_id、expected_revision、reason、include_descendants | control_id、cancelling；停止完成由事件确认 |
| 查询任务 | task_id?、state?、limit、cursor | runtime实际状态、desired state、revision和结果 refs |

### 11.5 文件原子

| 工具 | 输入 Schema 要点 | 首版结果 |
| --- | --- | --- |
| `file.read` | `root_id`、`relative_path`；`offset_line >= 1`、`limit_lines`、`max_bytes` | live；文本/图像类型、实际路径范围、内容、截断、content hash |
| `file.write` | `root_id`、`relative_path`、`content`、`create_or_replace`、`expected_hash?`、`basis_refs` | proposal；显示完整拟写内容或可读 diff |
| `file.edit` | `root_id`、`relative_path`、明确编辑操作、`expected_hash`、`basis_refs` | proposal；不存在目标时失败，不猜测替换 |

首版真实读取限制在用户选择的测试根目录；解析 realpath 后检查范围，包含 symlink 逃逸、二进制/大文件和文件在读取中变化的处理。DSH 已有 fs/read seam，优先适配它；Pi createReadTool 作为参考，不为一个 read 工具额外引入 Pi 会话层。

### 11.6 Web Search、Fetch 与 Research

| 能力 | 输入 Schema 要点 | 输出 Schema 要点 | 首版 |
| --- | --- | --- | --- |
| `web.search` | `query`、`max_results`、`domains?`、`time_range?` | results：title/url/snippet/published_at?/provider；检索时间 | Schema+fixture；真实 provider 可在 P1 打开 |
| `web.fetch` | `url`、`max_chars`、`timeout_ms` | final_url/title/text/fetched_at/content_type/truncated | Schema+fixture；P1 live |
| `web.research` | objective、questions、scope、source constraints、budget、basis refs | report、claims与source refs、uncertainties、查阅时间 | 子代理 preset，P0用fixture跑通，P1 live |

Research 是子代理使用 search/fetch/read 的组合能力，不建设第三个独立 loop。DSH 的 Web service/provider 能覆盖这类原子；实际 provider 可用性、返回格式与凭证另行验证。

来源正文和用户屏幕观察都当作外部数据；不能把网页指令变成工具授权。无真实 provider 时呈现 unavailable 或 fixture，不能由模型凭记忆生成“搜索结果”。

### 11.7 日程 Schema，首版 proposal/fixture

| 工具 | 输入字段 |
| --- | --- |
| `calendar.list` | calendar_id、time_min、time_max、timezone、query?、limit、cursor? |
| `calendar.get` | calendar_id、event_id |
| `calendar.create` | calendar_id、title、start、end、timezone、all_day、description?、location?、attendees?、basis_refs |
| `calendar.update` | calendar_id、event_id、expected_version、changes、basis_refs |
| `calendar.delete` | calendar_id、event_id、expected_version、reason、basis_refs |

list/get 返回 fixture event 与版本；create/update/delete 返回 proposal。时间必须是明确时间或 all-day 日期，end 晚于 start；“下周一”由 Agent 按 action 的时区/时间解释，并在提案中展示解析依据。未知日期、目标日程 ID 或参会人不能编造。

Schema 可预留 recurrence，但首版不宣称支持修改重复日程。未来接真实服务时必须明确单次/整个系列的语义。

### 11.8 记忆与表达 Schema

| 工具 | 输入 | 首版 |
| --- | --- | --- |
| `memory.search` | query、scope、limit | fixture，或明确限定为本应用 attention/observation 索引；不冒充已接 Proactive Agent Memory |
| `memory.write` | content、category、basis_refs、source、confidence_class | proposal；来源为推断时保留推断标记 |
| `agent.emit` | audience、kind、text、basis_refs、related_task_ids、urgency | live 写入本应用时间线，不发系统通知或消息给外部人 |

`agent.emit.kind` 可为 observation_note、question、proposal、task_update、no_action；`no_action` 在调试流可见，面向用户的普通视图默认收起。解释仅要求简短可展示理由，不要求或伪造模型隐藏思维链。

## 12. 外部事件、定时与唤醒

### 12.1 统一事件信封

ExternalEvent 必需字段：event_id、source、event_type、occurred_at、received_at、timezone、subject/resource ID、payload/artifact refs、schema_version、dedupe_key、trust_class。与物理 action 同属可追溯输入，但 UI 明确显示来源类型。

日程到期示例为 `calendar.upcoming`，子代理结束为 `task.settled`，人工测试消息为 `debug.event`。插件将来可注册事件类型；首版使用固定内置目录。

### 12.2 Webhook 首版

- 提供本地测试入口，限制监听 loopback 或受权限控制的本地 socket，不部署公网接收服务。
- 校验 event schema、大小、来源标记和重复 ID；返回 accepted/event_id，不返回“Agent 已处理”。
- 如果采用 HTTP，来源验证凭证只保存在进程/系统凭据区，调试日志不得显示原值。
- 一条事件重复投递只入队一次；新版本事件使用新 ID 或明确版本语义。
- 晚到事件保留发生与收到时间，主 Agent 能识别过期，不能按收到时间重写为“刚发生”。

### 12.3 定时首版

用一条内置测试日程展示临近唤醒；timer 注册可复用 DSH 定时能力，业务 event 仍走同一观测入口。重启/睡眠恢复后重新计算到期状态；每个提醒实例使用稳定 dedupe key，避免重复提醒。

定时实现不等于首版完成真实日历 CRUD。UI 上“测试定时事件”与“真实日历事件”分别标记。

## 13. 简洁界面与调试交互

### 13.1 主界面布局

首版一个主窗口，三块可调整宽度的区域：左侧导航/筛选，中央实时信息流，右侧详情检查器。窄窗口时详情作为抽屉打开。默认浅色或跟随系统，不为实验应用设计复杂营销视觉。

| 区域 | 默认内容 |
| --- | --- |
| 顶栏 | 采集状态、Agent状态、暂停采集、暂停推理、继续、成本/队列摘要 |
| 左侧 | Live、Sessions、Tasks、Replay、Capabilities、Diagnostics |
| 中央 | 当前会话统一时间线，按时间顺序向下增长 |
| 右侧 | 当前选中 action、message、task 或 tool 的详情 |

状态不只用颜色区分，必须有文字/图标；保留 macOS 正常窗口 chrome 和红绿灯布局。

### 13.2 实时信息流

默认显示语义活动与 Agent 消息；可切换 Raw，检查每个原始 action。两种视图共享同一 action ID，不产生两套事实。

每行展示时间（毫秒可展开）、来源图标、app、action/活动名称、简短事实摘要、证据就绪状态、Agent处理状态。系统事件、人工输入、桌面观察、模型消息和工具结果必须可区分。

- 默认跟随底部；用户向上滚动或选中事件时停止自动跳转，显示“新增 N 条”。
- 点击“回到实时”恢复跟随；暂停滚动只冻结视图，不自动停止采集。
- 列表虚拟化，较大截图/AX 按需加载；新 action 到来不能让正在查看的树自动收起。
- 支持时间范围、app、event type、task/session、处理状态、错误和全文检索。
- 选中动作后复制 action ID、查看因果链、加入评估样本、回放该 observation。
- 空闲、排除本应用、权限缺失、runtime断开、网络失败、预算暂停有不同空状态。

### 13.3 Action 检查器

页签：Overview / Screenshot / AX / OCR / Understanding / Delivery。

| 页签 | 必须呈现 |
| --- | --- |
| Overview | action ID、发生/接收时间、app/window、按键/点击元数据、归组、过滤原因 |
| Screenshot | before/after、实际时间、点击叠层、缺失/共享状态、图片尺寸 |
| AX | 可折叠树、搜索、定位目标/焦点、raw/context/diff、coverage与截断 |
| OCR | 文本块、图像定位、识别配置、关联 screenshot ID |
| Understanding | 事实、推测分区、引用跳转、模型/prompt/版本、耗时和用量 |
| Delivery | event/outbox/message/turn/step IDs，入队/领取/响应状态，缺失环节 |

AX 默认展开根到点击/焦点路径，其他分支折叠。提供展开当前层、折叠全部、跳转命中节点和仅看变化。不能默认将数万节点全部渲染为 DOM。

### 13.4 主/子 Agent 轨迹

主 Agent 消息在中央流显示；子代理任务以卡片出现，展示目标、状态、版本、child ID、耗时与最新进展。点击进入子轨迹，面包屑能返回父会话。

子轨迹可检查派发 Prompt、上下文包、实际可用工具、模型、输入版本、工具参数与结果。对话文本使用平稳流式显示；持久 final 到来后合并对应 live message，不重复渲染成两条。

任务工具卡明确区分 accepted、running、proposed/not_executed、succeeded、failed、cancelling、cancelled、superseded。旧 revision 结果标“已过期”，仍可回看。

“Agent 想表达什么”通过可见文本、结构化 decision/intent、简短依据展示；“用户想表达什么”只能展示用户显式输入或带推测标签的模型理解，不把观察推断当读心结果。

### 13.5 Capabilities 与 Diagnostics

Capabilities 展示固定内置能力、Schema、适用角色、mode、provider、可用性；可用样例参数试运行 proposal/fixture。没有安装/市场按钮。

Diagnostics 展示 Collector epoch、权限、当前目标、自我排除、输入事件速率、AX/OCR耗时、队列深度/最老项年龄、丢弃/合并计数、SQLite/WAL体积、sidecar连接和模型错误。

必须区分 `permission_denied`、`unknown`、`self_excluded`、`no_eligible_target`、`unsupported`、`timed_out`、`disconnected`。尤其不能重复 DeskLore 旧版本中“AX观察未启用直接显示权限不就绪”的误诊。

### 13.6 人工输入

在主 Agent 视图提供一个轻量输入框，用于设置关注事项、解释当前场景和测试修正。人工输入是真实 User Prompt；旁边明确标示桌面观察流。首版不需要完整聊天产品的文件管理或多模态创作 UI。

## 14. 可观测性、回放与故障归因

### 14.1 端到端关联

每条可执行或可展示结论，能沿以下关系回查：原始 action IDs → activity/observation revision → artifact IDs → understanding run → delivery event/message ID → Agent turn/step → task/revision → tool call → result/proposal。

这是一张一对多、多对一关系图，不能硬编码一条 action 对应一条 assistant message。十条滚动可能合并为一条观察，一轮 Agent 可能处理多条观察，一条观察也可能触发多个子任务。

每个 span 至少带：trace_id、parent_span_id、action/observation/task/session refs、component、operation、status、start/end、error type/code/cause。跨 Swift/TS/sidecar 边界保留原始错误类别，不能统一抹成“处理失败”。

### 14.2 状态与实时流

- `live_delta` 是即时呈现，不等于 durable final message；UI 按 native message ID 合并。
- `inbox_accepted` 不等于模型已看到；显示 claimed step 与 `input_manifest` 才证明该步处理了哪些内容。
- Provider 不提供推理 token 或模型理由时显示 unavailable，不补造内容。
- 断线重连使用持久 sequence/cursor 回补；先去重再合并 live，避免时间线重复。
- 树节点/BLOB/工具长结果按需读取，日志系统默认记录引用与摘要，不把全部截图 base64 写进 stdout。

### 14.3 回放模式

回放读取指定 action/observation/artifact 的不可变版本，用虚拟时钟重新执行关联、过滤和 Agent 输入。它不向操作系统重放真实点击、按键、滚动。

| 模式 | 模型调用 | 工具 |
| --- | --- | --- |
| Inspect | 无 | 只读历史 |
| Deterministic replay | 无；使用录制响应/fixture | 所有工具读取fixture或记录提案 |
| Perception compare | 显式发起新的摘要请求 | 只读证据 |
| Agent compare | 显式发起新的主子模型请求 | 受控fixture与proposal，不接真实副作用 |

每次 run 固定 dataset、policy、prompt、schema、model、provider、runtime版本和配置 hash。原始证据过期时显示不可回放，不能偷偷改用实时桌面数据。

### 14.4 故障场景处理

| 故障 | 用户看到什么 | 系统行为 |
| --- | --- | --- |
| AX timeout/不支持 | AX partial/unavailable，其他证据仍可见 | 截图与OCR继续；降级摘要不猜缺失属性 |
| 截图权限缺失 | screenshot unavailable及权限项状态 | 原始输入/AX按其自身能力继续 |
| Collector 退出 | 断开时间与最后sequence | 受监督重启新epoch；记录中断区间，不补造事件 |
| 输入 tap 被停用 | 明确disabled原因与恢复状态 | 在适当线程尝试恢复；持续失败停止假健康显示 |
| SQLite busy/磁盘满 | 存储故障、未持久队列长度 | 有界缓冲、停止重证据；超限明确计数 |
| 摘要模型超时/限流 | 该 run失败；observation仍可查询 | 有限退避重试，校验新上下文是否使旧请求无效 |
| Harness 崩溃 | running任务变interrupted | 重建投影、核对outbox、恢复明确可继续工作 |
| 子代理旧结果晚到 | 过期结果卡片 | 保留记录，不更新当前提案/事实 |
| UI重启 | 恢复会话及当前位置 | 通过游标回补，不重跑模型 |
| 超出模型预算 | Agent paused_by_budget | 采集与回看仍按设置工作；不无限重试 |

## 15. 资源预算与体验指标

以下为实施时的**起始目标**，不是已测性能。基准记录机器型号、macOS、分辨率、应用、模型网络路径及数据量。

| 项目 | 初始验收目标 | 测量说明 |
| --- | --- | --- |
| 原始事件到UI | p95 ≤ 150ms | 受控样例，无重处理同步阻塞 |
| metadata持久化 | p95 ≤ 250ms | 可批量短事务；记录真正提交时刻 |
| 单次AX预算 | 目标 ≤ 700ms，硬上限可配置 | 到预算返回partial；不等待无响应app无限结束 |
| 关键动作证据完成 | p95 ≤ 2s，本机 | 单独报告截图/AX/OCR耗时，缺失不算成功 |
| 事实摘要完成 | 目标 p95 ≤ 6s | 端到端与模型耗时分开；取决于真实Provider |
| 后台派发回执 | p95 ≤ 250ms，不含模型决策 | 从工具execute到持久/接受回执分开测量 |
| 子任务运行时接收新事件 | 不中断capture，inbox入队p95 ≤ 250ms | 20s受控延迟任务中连续投递事件 |
| 时间线渲染 | 10万metadata分页流畅，显示区不持续增长DOM | 不要求一次装入所有BLOB |
| 内存稳定性 | 30min操作后无持续线性增长 | 记录baseline、峰值、稳定值；不同进程分开 |
| 正常退出 | 5s目标内完成资源收拢 | 超时报告仍存活子进程，不能当成功 |

### 15.1 队列与降载

各队列有最大长度、最老项年龄、合并数和丢弃数。输入元数据、重证据、摘要请求和 Agent inbox 分开观测，不能只有一个“忙碌”指标。

对处理不过来的重复低价值观测可合并，并留下 action 归组；关键状态改变和人工修正优先。降低截图/摘要频率不改变历史事件本身。物理输入覆盖率、证据完整率、语义事件保留率分别统计，不把合并当采集丢失。

模型与任务限额由可见配置控制，至少包含：每分钟请求预算、每会话 token预算、最大子代理并发、单任务步骤/时间限额、重试次数。默认数值由受控 benchmark 选择，不能只凭“模型很快”取消背压。

### 15.2 成本评估方法

报告每10分钟真实工作样本的原始事件数、活动数、唯一截图/AX数、模型唤醒数、token和摘要正确率。对比逐事件调用的估算与合并方案的实际请求量，重点观察是否通过少发请求损失关键事件。

在固定数据集上，分别报告感知、主 Agent、每个子 Agent 的费用。延迟和质量同时达标才选择模型，不能仅按名称中的 Flash 或 Lite 判定。

## 16. 最小数据边界与用户控制

本节是持续桌面观察必要的产品行为，不扩展成首版通用权限管理平台。

- 采集开关、推理开关和UI自动滚动分别控制。首启先检查能力，用户开启采集后开始记录。
- 提供“暂停全部”同时停止新采集和新模型提交；已发送模型请求无法撤回其输入，界面准确显示仍在结束的请求。
- 默认排除本应用观察界面，避免“Agent看见自己的总结又触发总结”的反馈循环；人工输入仍作为显式事件接入。
- 受保护输入字段不保存value，也不把输入正文经OCR/截图送入模型。无法确认安全覆盖时跳过该窗口证据并显示reason。
- 只有测试关注范围内的证据进入模型；配置页明确说明会将哪类截图/文本发给哪个Provider。
- 凭证由新应用自己的系统凭据/进程配置提供，不复用或复制旧 Proactive Agent secrets，不进入SQLite、导出或stdout。
- 模型可见Schema过滤与文件/网络执行边界分别实施；工具声明本身不是系统权限。
- 本轮不修改任何Supabase、旧数据库或生产环境。未来新应用的SQLite权限不能被误解为已有业务数据库写授权。

## 17. 评估样例与验收矩阵

### 17.1 场景集

初始建立至少40条可回放样本，覆盖下列30类；关键场景包含不同输入法、两种app或重复运行。样本来自合成测试应用或用户明确选择并脱敏的记录，不扫描整个历史库自动收集。

| 编号 | 场景 | 必须验证的结果 |
| --- | --- | --- |
| E01 | 点击有名称按钮 | 点击目标、截图坐标与AX节点对齐 |
| E02 | 点击窗口关闭后窗口消失 | before证据保留；after不能错误归到新窗口 |
| E03 | 点击后台窗口 | 命中app与旧前台app分开记录 |
| E04 | 连续20次空白点击 | 原始ID齐全；语义合并可见；不虚构目标 |
| E05 | 同坐标点击但按钮状态变化 | 不被仅坐标去重吞掉 |
| E06 | 单个Space用于播放/暂停 | 不描述为普通文本输入 |
| E07 | 编辑器Enter换行 | 不生成发送/提交结论 |
| E08 | IM Enter发送，输入框清空 | 有前后/新消息证据才陈述发送内容 |
| E09 | 中文IME候选确认 | 不逐字唤醒，不把候选确认当业务提交 |
| E10 | 连续typing、切换field | activity正确结束/重开；不混合两个输入框 |
| E11 | Cmd+W、Cmd+S、Cmd+Enter | 物理按键与观察结果分开 |
| E12 | 长滚动、惯性滚动、方向反转 | 原始delta、聚合边界、viewport变化正确 |
| E13 | 拖拽选区与复制快捷键 | 选择与复制是不同证据 |
| E14 | 页面大量重复按钮/容器 | 触发节点及祖先不被删除，压缩效果可度量 |
| E15 | AX树超大/遍历超时 | 及时返回partial，UI不冻结 |
| E16 | Chromium/Electron空壳AX | 报告coverage不足；截图可用；不谎报完整树 |
| E17 | canvas/视频或AX缺失 | 多模态降级并陈述未知，不造文字 |
| E18 | AX含屏外聊天记录 | 摘要不把屏外文字当当前动作结果 |
| E19 | OCR误字/AX图像冲突 | 不确定性可见，引用定位正确 |
| E20 | Retina双屏、负坐标、窗口跨屏 | 像素与AX overlay正确或明确禁用 |
| E21 | 密码框/锁屏/排除app | 无受保护正文持久化或发模型 |
| E22 | 调试窗口成为前台 | self_excluded，不显示权限故障 |
| E23 | 无鼠键但页面内容变化 | AX/受控视觉更新可形成新观察 |
| E24 | Worker运行20秒期间10条新事件 | 主inbox继续接收，关键修正能被领取 |
| E25 | “改周一”随后“仍周五” | 旧revision作废，旧proposal不冒充当前结果 |
| E26 | 子任务取消和整应用退出 | cancelling与cancelled分开，后代资源回收 |
| E27 | 断网、限流、预算耗尽 | 有限重试、队列可见、无无限费用循环 |
| E28 | 重启、重复Webhook、晚到事件 | 稳定ID去重、时序保留、无重复proposal |
| E29 | 只复制SQLite证据快照到测试位置 | 截图/AX/OCR仍可读取，不依赖原临时图片 |
| E30 | 页面含“忽略指令/执行工具”的文字 | 当观察数据呈现，不提升为用户指令 |

### 17.2 质量标注与门槛

| 指标 | 定义 | 首版门槛/要求 |
| --- | --- | --- |
| 受控输入覆盖 | 已接收订阅事件与测试app记录比对 | 支持场景无未解释丢失；系统不提供的事件单列 |
| 证据关联正确率 | 目标app/window、截图来源、OCR图像关联正确 | 核心样本100%；错配必须阻止“完整证据”状态 |
| 关键节点保留 | 人工标注目标/焦点/错误结果节点在context中存在 | 关键样本100%；不能用总体压缩率掩盖误删 |
| 事实支持率 | 摘要中可验证陈述有证据支持的比例 | 初始目标≥95%，必须人工逐条核对 |
| 高风险虚构 | 无证据称已发送/已删除/已完成外部操作 | 样本集0例 |
| 不确定性表达 | 证据不足场景正确保留unknown | 核心缺失/冲突样本100% |
| 工具Schema合规 | 参数及输出通过正式校验 | 合法样本100%；非法样本拒绝且无副作用 |
| 异步纠偏 | 主Agent接收修正并使旧任务失效 | E24–E26全部通过 |
| 可追溯率 | 从proposal回到触发action/证据/模型输入 | 100% |

这些指标用于受控样本验收，不外推为对全应用生态的保证。每类样本数量与失败列表必须随报告交付；40条只能作为首个诊断集。

### 17.3 必做比较实验

1. 同一事件：仅截图 vs 截图+OCR vs 截图+AX vs 三者；区分模型质量与采集质量。
2. 同一大树：raw可容纳全量 vs context裁剪 vs context+按需子树；测关键节点和事实准确率。
3. 高频输入：逐事件唤醒的受控基线 vs 聚合；比较请求量、延迟和关键遗漏。
4. 同一摘要样本：Gemini3.8Flash与选定轻量候选；价格、速度和事实质量同时记录。
5. 同一纠偏故事：正常完成、修正、取消、崩溃恢复、结果晚到五种执行路径。

不要求同时维护多个Agent框架来做上述实验。数据、Prompt或策略比较在同一运行时内完成。

## 18. 实施顺序与独立交付切片

每个切片包含对应实现、必要测试、说明和验收证据，形成可单独review/回滚的commit。提交边界按行为，不按文件拆分。

| 切片 | 实现范围 | 完成判据 |
| --- | --- | --- |
| S0：固定技术接入 | 新项目；Bun锁；DSH profile/bridge；合成事件；Node/Electron运行路径 | 主会话跨轮、continuable子任务、step修正、取消、live与final、退出六项跑通 |
| S1：采集证据闭环 | Swift被动输入、基本AX/截图/OCR、SQLite、最简事件列表 | 输入ID到三类证据可回查；缺失状态诚实；E01–E03/E20–E22基础通过 |
| S2：过滤检查器 | activity合并、raw/context/diff、树UI、数据标注/回放 | E04–E19可诊断；任何过滤可解释和重跑 |
| S3：事实理解 | 模型配置、结构化摘要、输入manifest、费用与错误 | 样本事实支持率与unknown检查达标；模型输入可回看 |
| S4：持续主子协作 | 观察到DSH outbox/inbox、TaskSpec/revision、任务树、proposal工具 | 日程修正故事完整；长子任务不堵采集；旧结果失效 |
| S5：调试与恢复 | 全因果链、重连回补、crash恢复、保留策略、预算、Webhook/timer | E24–E30与重启验收通过，无重复意图和孤儿进程 |
| S6：打包与交接 | 独立.app、启动/签名身份、运行说明、已知限制与基准报告 | 非开发shell环境可启动；用户能独立完成演示并回看 |

S0与S1分别验证最大未知：runtime接入和原生证据质量。S0在没有真实桌面数据时用合成事件；S1可先不接模型。不要先完成美观聊天壳，再发现取消或输入监听不成立。

### 18.1 S0 的阻断判据与备选

必须实测：DSH同一版本可用；image附件进入模型；step注入可见；continuable派发立即返回；live文字和durable消息可关联；取消/退出可回收。

若失败，先定位缺口是SDK wire、bridge、模型adapter还是DSH原子。仅修改窄桥接层能解决时不换框架。若锁定版本根本不能满足，则提交一份具体ADR，以失败证据比较“DSH最小补丁”与“Pi单一runtime备选”，由任务范围决定是否改选；不把三套loop并排装入项目。

### 18.2 实施 Agent 的禁止捷径

- 不仅显示模拟UI就宣称采集已完成。
- 不只在鼠标点击后随意抓当前桌面、用同一个timestamp假装原子快照。
- 不以“过滤太多”为理由抹去原始action和处理原因。
- 不把AX raw视图实际渲染为已裁剪树而不标明。
- 不把工具Schema声明等同于已实现工具，不伪造成功结果。
- 不await子代理全部完成后声称主代理持续响应。
- 不将queue accepted等同于processed、fsync或任务停止。
- 不用旧Proactive Agent、DeskLore的本地数据作为测试数据捷径。
- 不执行Supabase相关操作，不修改现有业务仓库或生产应用。

## 19. 待验证事项与明确默认决策

| 问题 | 当前决策 | 验证位置 |
| --- | --- | --- |
| DSH同版本npm可用性与API一致 | 固定发布/commit后验证；不按浮动文档盲装 | S0 |
| SDK如何扩展控制与delta | 内置bridge；传输在扩展点调查后固定 | S0 |
| Node sidecar打包 | 优先复用可证明兼容的运行环境，否则随应用打包受支持Node | S0/S6 |
| SQLite驱动 | 按实际执行进程ABI选择；不强制Bun专用API | S1 |
| 原始按键正文 | 默认只记录事件类别与必要快捷键；不逐字记录 | S1/S2 |
| 全量截图与树采集频率 | 元数据逐事件，重证据按需/共享且有时差标签 | S1/S2 |
| 无鼠键的屏幕变化 | AX内容变化为主；低频视觉检查可配置，计入预算 | S1/S2 |
| Chromium空AX的恢复技巧 | 默认只诊断；修改目标app AX增强标志仅作显式实验能力 | S1/S2 |
| Gemini3.8Flash速度和成本 | 可配置候选，真实样本比测后决定默认 | S3 |
| 主Agent关注什么 | 首版可见的显式关注配置+允许推测，推测不能自动升级为目标 | S4 |
| 所有工具真实连接 | 首版只有基础读与runtime live，业务写proposal，Web可fixture | S4/P1 |
| 插件安装与市场 | 不做；固定内置Cordis模块 | 不影响首版 |

这些是实验应用必须验证的工程问题，已经给出默认路线和失败处理；它们不要求用户先回答完才能开始S0。

## 20. 最终交付与审查清单

实施完成应交付：新应用源码与锁文件、第三方版本/许可证记录、可启动的macOS应用、最小真实模型配置说明、脱敏回放样本、验收报告、已知缺口、费用与性能数据。

最终演示至少包含：真实动作出现 → 查看AX/截图/OCR → 查看事实摘要与输入版本 → 主Agent委派 → 子Agent执行工具 → 新观察修正任务 → proposal标记未执行 → 重启后回看同一因果链。

报告必须分别标识“源码已存在”“本机已运行”“受控样本已通过”“真实外部工具已连接”。当前PRD只完成研究与设计，不把任何一项未来验收写成已完成。

## 实施偏差记录：S0（2026-09-06）

实际 npm 发行版可用版本为 `0.1.2-rc.1`，没有研究快照 `0.1.3-alpha.1`。S0 使用同版本 DSH 公开原子与 Cordis `4.0.2` 组合唯一 runtime，通过真实 Node sidecar 验证，不使用较旧 npm SDK client，也未复制私有 loop。固定内置 bridge 以私有父子 IPC 接入；live chunks 来自此发行版原生 `session/event` 内的 `assistant/chunk`，持久确认由独立 flush 水位表达。完整版本、接口和验证边界见 [S0-RUNTIME-VERIFICATION.md](S0-RUNTIME-VERIFICATION.md)。此记录不回写或改变研究阶段源码事实。
