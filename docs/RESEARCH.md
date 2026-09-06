# Proactive Lab 调研依据与技术取舍

调研日期：2026-09-06。本文件与 `PRD.md` 配套。所有运行时、采集和性能结论均区分静态代码事实、设计建议与待实测事项。

## 1. 研究方法与证据范围

本轮完成：现有本地参考项目只读检查、公开远端版本核对、固定提交关键源码阅读、官方API文档核对、PRD设计与一致性审查。

本轮没有：安装应用依赖、启动Collector、监听键盘鼠标、读取用户历史记录数据库、截取真实桌面、调用付费模型、部署服务、连接真实日历或修改业务仓库。

| 对象 | 版本/范围 | 证据状态 |
| --- | --- | --- |
| DeskLore本地 | `b5928393700a743bfdbcfa01da78a3b9b1d095ed`，2026-08-24 | 深入读取旧版采集/视觉/存储/Pi；clone未修改 |
| DeskLore远端 | `8851346c7e544b6da07372d7a9a5aca9f81317f1`，2026-09-03 | 远端比本地领先45个commit；定向读10个当前文件 |
| DeepSeek Harness | `d347e703908d0406b7a7ef80e3a0e594d86b2215`，2026-09-04 | 固定SHA核对SDK协议、子代理配置、许可证；更多语义来自当日官方生成文档 |
| Pi | 当前官方仓库为earendil-works/pi；DeskLore固定0.84.2 | 官方分层与read工具源码核对；不推断新应用已适配 |
| Apple、Google、SQLite、Electron | 访问当日官方文档；部分Apple符号由本机Xcode SDK头文件交叉核对 | API能力来源，不是本机集成通过证明 |

精读原始笔记另见[DeskLore源码笔记](references/DESKLORE-NOTES.md)与[Runtime源码笔记](references/RUNTIME-NOTES.md)。DeskLore笔记包含旧版历史分析，**判断当前参考价值请优先看其第12节**。

## 2. DeskLore：当前真正值得复用什么

### 2.1 版本漂移先于结论

本地clone不是当前版本。远端在45次提交中迁移了原生目录与server结构，并加入结构化AX和SemanticFrame。因此“旧版本AX只有文本”“Pi最多四轮”不能作为对当前项目的判断。

[固定远端提交](https://github.com/FoundDream/desklore/commit/8851346c7e544b6da07372d7a9a5aca9f81317f1)；[两版本比较](https://github.com/FoundDream/desklore/compare/b5928393700a743bfdbcfa01da78a3b9b1d095ed...8851346c7e544b6da07372d7a9a5aca9f81317f1)

许可依据：本地固定版本LICENSE与官方仓库声明为Apache-2.0；复制代码时保留适用许可与归属文件。此处只识别项目许可，不推断所有传递依赖具有相同许可。[已读LICENSE](https://github.com/FoundDream/desklore/blob/b5928393700a743bfdbcfa01da78a3b9b1d095ed/LICENSE)

### 2.2 原始输入：不能直接满足every action

最新固定文件的监听mask仍包含左键down/drag/up、右键down、keyDown；没有scroll，也没有覆盖全部其他鼠标按钮和keyUp。普通字符只更新typing信号，随后利用AX变化构建输入事件。这是语义活动采集，不能当成无损物理输入日志。

对新应用的影响：需要额外设计原始action层、滚动事件、物理与语义归组关系，以及每个action的证据状态。不能改个存储后直接声称覆盖用户所需事件。

[InteractionMonitor，固定SHA](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/native/collector/Sources/DeskLoreCollector/Capture/InteractionMonitor.swift#L39)

### 2.3 结构化AX与预算

当前输出有fullTree/tree与diffFromPrevious/delta。遍历有明确边界：最多访问1200节点、输出800节点、深度20、约700ms预算。这些是该版本实现参数，不能当作适用于所有应用的最佳值。

当前还会尝试使Electron/Chromium懒加载的AX树暴露更多内容：检测空壳树后，按PID至多一次设置AXManualAccessibility/AXEnhancedUserInterface。这个动作可能影响目标应用表现，且本次返回的仍是增强请求之前的快照。成功设置属性不等于本轮已获取完整树。

对新应用的影响：保留coverage和截断信息；AX增强只做显式实验选项，诊断成功、后续树实际改善和时延分别呈现。不能把它作为每次读取的无副作用默认步骤。

[AX快照与预算](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/native/collector/Sources/DeskLoreCollector/Capture/AXContextReader.swift#L313)；[AX增强](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/native/collector/Sources/DeskLoreCollector/Capture/AXContextReader.swift#L875)

### 2.4 SemanticFrame：最直接回答“AX太多怎么处理”

当前代码把AX快照变成可重放的纯函数派生视图，包含页面身份、正文、标题目录、焦点、尾部文字和分区统计。它恢复sibling顺序、保护循环、选择更深的focus节点，并区分content、navigation、chrome。

默认上限包括正文4000字符、outline24项、recent8项、focus500字符。聊天/终端/邮件偏向保留正文尾部。正文会排除按钮等控件，但原始分区与树仍是另外一层证据。

新应用应借鉴“原始快照+可版本化派生视图”，同时补上**被点击节点、焦点与关键变化节点的显式保留**。不能照搬“控件不进正文”后让Agent看不到刚按下的按钮；recent表示文档尾部，不等于时间上刚发生的事件。

[Frame纯函数](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/frame.ts#L68)；[Region分区](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/regions.ts#L38)

### 2.5 Delta必须依赖可识别基线

SemanticFrameTracker按窗口缓存最近full tree，再应用delta重建frame；缓存最多64个stream。缺基线的delta不伪造frame。窗口ID缺失时退回标题，可能受重名/标题改变影响。

新应用应保存稳定snapshot ID、base snapshot ID、窗口身份、policy版本和完整性。不能只给模型一段“变了这些节点”却无法找到它依赖的树。

[Tracker](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/tracker.ts#L17)

### 2.6 存储并不是SQLite

最新已读history存储仍为10分钟segments及events.jsonl/evidence.jsonl，长期派生内容在rollups目录。本轮没有发现该存储模块可直接复用的SQLite schema；结论限于已读history实现，不对全部未读模块作存在性断言。

新应用需要独立设计SQLite证据、查询索引、事务、迟到补证、保留和回放。用户要求截图实际存入SQLite，与旧版仅保留视觉元数据/理解的策略不同。

[当前存储实现](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/storage/repository.ts#L348)

### 2.7 Pi已经可step/continue/abort，但业务职责仍不同

当前TimelineAgentSession支持单步推进、继续、abort、无进展检测和较旧工具结果压缩。证据默认返回semantic summary，需要时再读取正文或raw AX。输出还校验证据引用是否实际被读取过。

它仍围绕十分钟活动segment产出timeline，不是本需求中持续接收用户事件、不断修正异步执行者的主代理。可迁移的是渐进读取、单步推进、结果验证与上下文控制，而不是整个时间线业务流程。

[TimelineAgentSession](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/timeline/agent/runner.ts#L891)；[输出验证](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/timeline/agent/runtime.ts#L124)

### 2.8 旧版经验的有限复用

旧版本中还验证到：Return/鼠标换焦点前flush待处理文本；视觉补证与原始事件落盘解耦；截图请求包含窗口身份与失效时间；窗口歧义时返回unavailable；OCR关联截图；自我排除被旧UI误显示为AX未就绪。

这些因果边界应纳入新应用设计。旧版350ms输入debounce、12s截图cooldown、8s证据expiry等数值不作为最新DeskLore事实，也不直接进入新应用默认配置。

## 3. DeepSeek Harness：选择同一套原子的具体含义

### 3.1 推荐组合与许可

DSH和其内置Cordis包作为一个兼容版本集使用。DSH快照版本manifest为0.1.3-alpha.1，仍属于开发者预览；许可证MIT。上游应用入口是CLI/profile，SDK可启动独立runtime。Bun是新应用依赖管理选择，不等于上游Node程序已经可在Bun中无差异运行。

[固定源码](https://github.com/deepseek-ai/deepseek-harness/tree/d347e703908d0406b7a7ef80e3a0e594d86b2215)；[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/LICENSE)；[官方产品边界](https://www.deepseek.com/harness/)

| 能力组 | 上游包/服务线索 | 首版采用方式 |
| --- | --- | --- |
| 组合与清理 | `@deepseek-ai/cordis`，Context/Service/inject/effect | 固定内置模块，随应用发布 |
| Agent与会话 | dsh-agent、dsh-agent-loop、dsh-session | 唯一主子代理循环和历史 |
| 模型与工具 | dsh-llm、dsh-tools、dsh-system-prompt | 单一能力目录与模型边界 |
| 可继续子代理 | dsh-subagent、spawn-in-process、tool-subagent/control | 后台独立上下文、修正、停止 |
| 持久化 | dsh-session-persistence及jsonl provider | 原生Agent账本；SQLite只建关联投影 |
| 文件与Web | dsh-fs/tool-fs、dsh-web/tool-web及provider | read live；Web先fixture，写工具proposal |

这些名称是访问时观察到的线索。实施必须从锁定发行版的public exports与profile检查，不深层import随机源码文件。

### 3.2 收件箱与边界注入

官方Agent接口已有followup、steer、inject和更底层send。它们区分下一轮、最近可用step与是否唤醒；inject本身不唤醒空闲Agent。消息进入模型只发生在允许边界，不能改变已发送的模型请求。

设计采用：人工输入进入独立轮次；关键新观察/任务纠正使用可唤醒的step投递；背景材料可仅注入。SQLite事件接收与模型真正领取分别可见。

[Agent接口与Inbox](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/core)；[固定Agent类型](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent/src/types.ts)

### 3.3 异步子代理不是默认one-shot

固定源码确认默认backgroundMode为one-shot。本应用需要显式选择continuable；它启动可继续子会话并尽早返回child identity。内部startContinuable返回childId/messageId；模型工具的canonical结果形如kind=continuable及subagentId，二者不能混为同一层协议。

父子消息可更新运行中的工作；interrupt只发取消请求，不天然递归清理后代，也不是已停止的证明。本应用另外维护任务依据版本，阻止过期结果成为当前结论。

[固定子代理工具源码](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/tool-subagent/src/index.ts)；[子代理服务语义](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)

### 3.4 SDK缺口决定必须先做bridge spike

当前固定SDK wire只有initialize、session/prompt、shutdown三个请求，以及session和subagent相关通知。已有prompt入队回执和session tree订阅，但没有完整跨进程steer/inject/cancel接口。内部live assistant stream也不能仅凭session.event推断已经透传到桌面。

因此推荐单个内置Proactive Bridge，调用sidecar内公开服务原子，对桌面暴露受限控制与流式输出。S0首先证明此路可行；不提前承诺“直接几行SDK就全部支持”。

[SDK Client](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/sdk/client/README.md)；[SDK Protocol](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/sdk/protocol/README.md)

### 3.5 会话与投影不双写真相

DSH使用SessionEvent构成模型历史，并有持久化插件。外部观察证据用SQLite；两者通过ID关联。日志批量flush意味着内存接受不等于落盘；需要outbox和恢复对账，而非声称两个存储之间天然原子提交。

[会话](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session)；[持久化](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/persistence)

### 3.6 工具Schema与proposal

DSH工具定义同时描述输入、输出、执行与呈现。首版业务工具的execute可以真正执行“记录提案”这件事，返回proposed/not_executed，而不修改日历或文件。这样Agent会得到合法工具结果，UI也能准确观察意图。

[工具定义](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools)；[文件系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/filesystem)；[Web](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/web)

## 4. Pi与ToolLoopAgent为何作为对照

Pi当前官方仓库由旧pi-mono地址重定向到earendil-works/pi。pi-ai负责模型，pi-agent-core负责Agent loop/state/tools，pi-coding-agent提供编码工具、session与扩展。createReadTool可独立构造工具，但转换到DSH仍需映射Schema、输出和呈现；DSH已有read，首版没有足够收益承担双依赖。

Pi主产品并不内建本需求完整的subagent协调器，因此不因它有read工具就选择它承担第二套主代理。许可MIT。

[Pi官方仓库](https://github.com/earendil-works/pi)；[read实现](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts)；[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

AI SDK ToolLoopAgent支持多步工具调用、prepareStep、流式和结构化输出。官方基础子代理示例会等待子代理完成；流式preliminary结果改善进展展示，不自动提供常驻子会话、跨轮inbox与冷恢复。作为单一runtime备选可行，但需要自己承担更多协调层，不符合本轮优先复用DSH原子的方向。其仓库许可Apache-2.0。

[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)；[Subagents](https://ai-sdk.dev/docs/agents/subagents)；[源码](https://github.com/vercel/ai/blob/main/packages/ai/src/agent/tool-loop-agent.ts)

## 5. Apple原生捕获：可行方向与不能承诺的部分

### 5.1 物理输入

CGEventTap提供被动listenOnly模式。API存在不等于目标应用拥有监听权限；必须检查事件监听访问状态和真实事件覆盖。回调只做轻量入队，不把AX或网络置于输入回调。

[listenOnly](https://developer.apple.com/documentation/coregraphics/cgeventtapoptions/listenonly)；[CGPreflightListenEventAccess](https://developer.apple.com/documentation/coregraphics/cgpreflightlisteneventaccess%28%29)

本机Xcode SDK的CoreGraphics头文件进一步确认CGPreflightListenEventAccess/CGRequestListenEventAccess及tapDisabledByTimeout事件。只读头文件，没有调用权限请求或事件监听。

### 5.2 AX

AXObserver用于订阅指定进程通知；AXUIElement提供属性/节点访问，命中测试可按屏幕坐标取元素，messaging timeout可限制单次AX交互。应用支持不完整或调用超时属于正常需要表达的状态。

[AXObserverCreate](https://developer.apple.com/documentation/applicationservices/1460133-axobservercreate)；[AX messaging timeout及相关读取API](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout)

AX遍历不是跨应用全局原子事务。动作时间、遍历起止时间与窗口身份必须记录；节点预算到达不能把输出标成完整。

### 5.3 截图与OCR

ScreenCaptureKit支持按应用/窗口/显示器过滤捕获内容和读取帧。Apple官方示例说明了录屏权限、过滤器与帧元数据；示例要求macOS15，不意味着所有ScreenCaptureKit API都首次出现在15。

[ScreenCaptureKit官方示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)；[SCStream](https://developer.apple.com/documentation/screencapturekit/scstream)

Vision文字识别有语言、速度/精度级别、文本高度等配置，返回识别观察。新应用必须保留OCR块与截图的实际关联，按中英文样本测量准确率。

[VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)

### 5.4 SQLite与Electron

SQLite WAL允许读写并发但仍只有一个writer；长读事务和checkpoint会影响行为，备份不能漏掉活动WAL。首版独立存储owner、短事务、BLOB按需读取是针对本产品的设计选择。

[SQLite WAL](https://www.sqlite.org/wal.html)；[BLOB内外存储讨论](https://www.sqlite.org/intern-v-extern-blob.html)

用户明确要求SQLite存证据，因此PRD使用内部BLOB，并把体积预算/保留做成可配置。官方BLOB文章不能证明所有截图大小下内部BLOB一定性能最好，实施仍需测量。

Electron utilityProcess提供独立Node子进程与MessagePort。它是Observation/存储owner的候选隔离方式，DSH则走已验证的sidecar启动路径；二者是否可以合并不在研究阶段假定。

[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

## 6. Gemini模型核对

2026-09-06访问的官方模型页确认：

| 候选 | 当前官方能力 | PRD中的地位 |
| --- | --- | --- |
| `gemini-3.8-flash` | 稳定；支持图像输入、文本输出、结构化输出；thinking low/medium/high，不支持minimal | 用户举例已核实存在；感知候选默认，速度仍待本机测试 |
| `gemini-3.5-flash-lite` | 稳定；官方定位低延迟/高吞吐的多模态模型 | 感知对比候选，不替用户先行锁死模型选择 |

[Gemini3.8Flash官方模型卡](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)；[Gemini3.5Flash-Lite官方模型卡](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

没有验证用户当前key的模型权限、DSH adapter对该模型参数的支持、实时价格或实际请求延迟。PRD把这些归入S0/S3验证，不能将模型存在误写为应用已经接通。

## 8. 实施成本取舍

| 决策 | 收益 | 代价与边界 |
| --- | --- | --- |
| DSH单runtime | 主子代理/收件箱/历史直接复用 | preview版本需锁定，bridge需先验证 |
| 不做插件安装 | 聚焦原子和调试闭环 | 新能力暂时随应用版本发布 |
| raw记录与语义上下文分开 | 可诊断过滤，又能控制token | 多一层关联数据和版本管理 |
| SQLite保存实际证据 | 一致回看、检索、导出、回放 | 图片体积大，需要去重、保留和BLOB基准 |
| 外部写操作proposal | 观察Agent意图且可验证，无需先完成业务集成 | 不能据此证明真实业务执行可靠 |
| 全量树作为评估/精读选项 | 能测出过滤是否伤害理解 | 不能每个事件无限全量输入 |
| Web Research作为子代理preset | 复用同一套任务/工具/轨迹 | 质量依赖来源工具和引用验证 |

## 9. 尚未完成的实测

1. DSH锁定npm发行版、sidecar桥接控制与live流、图片附件和打包。
2. 新Collector真实输入覆盖、AX/截图时序、多屏和IME。
3. 本地SQLite写入/查询/保留的性能与崩溃行为。
4. 模型事实准确率、过滤误删、请求预算和真实费用。
5. 用户工作样本中“值得介入”的产品判断；首版通过显式关注事项和可标注评估集探索。

它们需要实施环境与运行中的新应用，不能通过继续阅读文档替代。PRD已经为每一项给出实现切片、可见状态和验收方法。
