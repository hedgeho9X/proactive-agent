# DeskLore 采集与 Agent 源码研究笔记

调研日期：2026-09-06。用途：Proactive Agent 新一代主动式 PRD 的证据输入；本轮没有实现业务代码。

**阅读顺序：第 12 节是补读最新固定远端 SHA 后的当前结论，PRD 应优先引用。第 2–8 节保留旧本地版本的详细证据，不能混写为最新行为。**

## 1. 版本与证据边界

- **已验证，本地静态源码**：`/Users/jerry/code/personal/opensource/desklore`，HEAD 为 `b5928393700a743bfdbcfa01da78a3b9b1d095ed`，提交日期 2026-08-24，标题 `feat(history): adopt Pi-powered timeline agent`。调研前工作区干净，分支 main。
- **已验证，远端公共 GitHub API**：当前 main 为 `8851346c7e544b6da07372d7a9a5aca9f81317f1`，提交时间 2026-09-03T09:58:26Z，标题 `fix(timeline): show all application icons`。远端比本地固定版本领先 **45 个提交**，落后 0 个提交。
- 官方版本链接：[本地研究基线](https://github.com/FoundDream/desklore/tree/b5928393700a743bfdbcfa01da78a3b9b1d095ed)、[当前远端提交](https://github.com/FoundDream/desklore/commit/8851346c7e544b6da07372d7a9a5aca9f81317f1)、[版本比较](https://github.com/FoundDream/desklore/compare/b5928393700a743bfdbcfa01da78a3b9b1d095ed...8851346c7e544b6da07372d7a9a5aca9f81317f1)。API 比较元数据另存 `/private/tmp/proactive-desklore-remote-compare.json`。
- 下文写“已验证”默认仅指**固定本地 HEAD 的静态代码存在且调用关系已读取**；没有启动 Collector、没有捕获屏幕/输入、没有读取用户 history 数据、没有执行数据库操作、没有安装或运行测试、没有 pull 或修改 clone。
- **不能把下文的旧版局限写成 DeskLore 当前主分支仍有的缺陷。** 远端已有采集与语义表示大改，见第 9 节。

## 2. 最直接的结论

1. **固定版本没有 SQLite 模型。** 实际使用十分钟分桶的 JSONL 原始事件、独立 evidence JSONL、JSON metadata、Markdown timeline 和 6h/day memory。`src/main/history/storage.ts:26-61,331-365,531-568`，`src/main/history/types.ts:110-181`。在源码/文档中搜索 SQLite、CREATE TABLE、better-sqlite 等没有命中；未查询任何实际数据库。
2. **固定版本已有 Pi Agent。** `package.json:40-41` 固定 `@earendil-works/pi-agent-core` 与 `pi-ai` 0.84.2；`src/main/history/timeline-agent.ts:723-799` 创建真实 `Agent`、注册工具、执行多轮工具调用。不过它处理关闭的十分钟活动桶，生成时间线记忆；没有实现持续主动式编排器。
3. **固定版本没有 scroll 监听，普通字符也不逐键持久化。** `InteractionMonitor.swift:39-46,142-195` 的 mask 只有左键 down/drag/up、右键 down、keyDown；字符键主要只更新“最近有打字”信号，完整输入由 AX 值变化恢复。
4. **每次行为必有截图、完整 AX、OCR 的契约在这里不存在。** 不同事件按需要读取不同证据；AX 树有预算、可仅提供差分或省略；截图是可选、延后、有冷却和失效时间的补充。

## 3. 原生采集：真正采什么、何时采

### 3.1 运行时与输入事件

**已验证事实**：

- Swift `HistoryEngine` 只拥有 macOS 原生采集边界，Electron main 拥有 policy/coalescing/storage/timeline/LLM：`Sources/ComputerHistoryApp/HistoryEngine.swift:6-8`。
- Electron 启动独立 Collector 进程，通过 stdin/stdout NDJSON 通信；事件做 `normalizeHistoryEvent` 后才 emit：`src/main/agent-client.ts:74-84,191-234`。Collector 身份与 UI 身份分离，host bundle ID 通过环境参数传入：`agent-client.ts:75-80`。
- 左键按下先 flush 尚未提交的文本/选择变更；按住期间仅更新拖拽末点；松开时距离达到 3px 才形成 drag，否则形成 click；Ctrl+左键视作 context menu。右键在 down 时形成 context-menu 事件。`Sources/ComputerHistoryApp/Capture/InteractionMonitor.swift:58-139`。
- Return/numpad Enter、Tab/Delete/Escape/Home/End/PageUp/PageDown/方向键、带 Cmd/Ctrl/Option 的组合键形成 `keyboard.shortcut`。普通字符不逐键发出 HistoryEvent；Delete、常规可打印字符、Cmd+V/X/Z 更新 typing activity。`InteractionMonitor.swift:12-25,142-195`。
- 应用激活时绑定目标 AXObserver 并捕获 `window.changed/application_activation`：`HistoryEngine.swift:106-125`。
- 每 2 秒 `pollFrontmostApplication` 仅修正活动 app 与监听目标；它**不是每两秒抓一份完整屏幕或完整树**：`HistoryEngine.swift:128-135,201-223`。
- 事件类型是 window.changed、mouse.click/context_menu/drag、keyboard.text_input/shortcut/submit、selection.changed：`src/main/history/types.ts:3-22`。

**可复用经验**：输入通道应该区分“原始物理信号”和“语义事件”。物理键可以用来证明文本变化很可能来自用户打字，却不必把所有字符作为对话消息发送。

**对本 PRD 的建议**：如产品确实要求 every key/scroll，就需要显式增加 raw event 契约与容量预算；不能直接把 DeskLore 的 HistoryEvent 当成无损原始输入流。滚动的增量、phase、设备、起止时间，以及滚动后内容变化应分别记录。是否保留字符值应作为明确产品选择，不能由“监听 keyDown”隐含决定。

### 3.2 AX 通知与 typing 的联动

**已验证事实**：

- app 级订阅 focus-window、focus-element、window-created、title-changed；selection 支持文本、children、rows、columns、cells 多类通知。`AXNotificationMonitor.swift:44-72,88-124`。
- 当前焦点向上最多走 12 层，寻找支持 AXValue 且可编辑的目标，注册值/选择通知。`AXNotificationMonitor.swift:209-243`；后续 registration 还处理 attribute 支持差异。
- 值变化只有在“可编辑控件 + 最近 2 秒有 typing activity”时才变成文本输入。它保存最新值、去掉相同值与初始空值，再 debounce：`AXNotificationMonitor.swift:411-423,656-658`。
- typing debounce 为 350ms；连续变化达到 1 秒时主动 flush，避免不停打字导致长期无输出：`AXNotificationMonitor.swift:435-453`。
- selection debounce 为 80ms，持续变化到 350ms 时 flush：`AXNotificationMonitor.swift:456-474`。原生 `SemanticEventGate` 对相同非空选区 1.5s 内、相同空选区 0.4s 内抑制：`Sources/ComputerHistoryCore/Capture/SemanticEventGate.swift:13-33`。
- title debounce 为 1 秒，连续变化达到 20 秒时 flush：`AXNotificationMonitor.swift:477-495`。
- 开启 semantic capture 后每秒轮询 focused value 和 selected text，为不可靠的 AX 通知补偿；value 仍要求最近 typing。`AXNotificationMonitor.swift:127-138,540-563`。
- Return 触发时，先 flush 当前文本再发起键盘 capture；鼠标导致焦点切换前也 flush：`HistoryEngine.swift:82-102`。这有助于保留“用户输入了什么，再点击或提交”的顺序。

**静态代码推断的局限**：

- 依赖最近键盘活动的输入认定可能漏掉语音输入、程序填充、辅助输入法等不产生相同 typing 信号的路径；不能仅凭这些静态规则声称覆盖所有输入方式。
- 用户正在看聊天窗口、没有点击和打字时，窗口内容新增但标题/焦点不变，不保证产生新的富 AX 快照。当前订阅与轮询针对焦点语义，不能等同“持续理解整个可见屏幕变化”。
- Enter 的发送含义在 TypeScript 按 target role、标签关键词、已知 app 或 Cmd/Ctrl 推断：`coalescer.ts:31-73`。`keyboard.submit` 是启发式分类，不能证明服务端真的收到消息或操作成功。

## 4. AX 树的成本、差分与时间一致性

### 4.1 捕获协调

**已验证事实**：

- `HistoryEngine.capture` 在入队时取 `Date()`，分配序号，交给独立 `AXCaptureCoordinator` actor；结果按序号 drain，暴露 backlog：`HistoryEngine.swift:255-280,316-328`。
- 非 application-activation 的 window.changed，按 app+reason 在 AX 抓取之前抑制 250ms 内的重复请求：`HistoryEngine.swift:284-300`。
- 只有 window.changed、click、context menu、drag、原生 kind 为 submit 时请求 rich snapshot；text_input/shortcut/selection 不请求：`HistoryEngine.swift:303-313`。
- `AXContextReader` 创建 app AX 元素并设置 250ms messaging timeout，读取当时 focused window/title/URL，检查观察范围，然后定位焦点/屏幕点 target 并读取树：`AXContextReader.swift:138-225`。
- 注意 Enter 原始事件在 Swift 是 shortcut，之后才由 TypeScript 分类为 submit。因此不能简单从 rich-snapshot switch 推断“每次 Return 均携带完整 AX 树”。

**推断与建议**：原始输入发生时、AX 入队时、实际 AX 读取时、截图时并非同一个时间。actor/队列和原始序号能保持处理顺序，不能把晚读到的画面变成过去时刻的画面。PRD 应规定 eventOccurredAt、captureStartedAt/captureFinishedAt、window/process identity、sourceSequence、关联精度/失效原因；对于过期证据明确标为 unavailable/stale。

### 4.2 有预算的树与差分

**已验证事实**：

- 每次最多访问 1200 个节点、输出 800 个节点、深度 20，遍历 deadline 700ms；优先遍历焦点路径和高语义价值节点；超限标记 truncated：`AXContextReader.swift:362-482`。
- children 组合 AXChildren、AXVisibleChildren、AXRows、AXContents，并按元素 identity 去重，以适配不同 app 的 AX 暴露方式：`AXContextReader.swift:694-710`。
- node ID 基于运行时 AX 元素 `CFHash`，是本次运行的 identity，不是可跨进程长期稳定业务 ID：`AXContextReader.swift:649-650`。
- 同一 app+window 且仍在同一个 10 分钟桶中，保存上次快照做差分；新桶首次输出全树；无变化则省略 accessibility；变化节点占比 >=65% 输出全树，否则输出 diff 文本：`AXContextReader.swift:307-359`。
- 当前跨进程 DTO 的 `accessibility` 只有 mode（fullTree/diffFromPrevious）与 text；结构化节点树在 native 端已被渲染成文本：`src/main/history/types.ts:61-64`。

**局限与建议**：

- “accessibility 缺失”在该版本可能表示没请求、请求失败、空树、差分无变化等多种状态；`visual.ts:107-115` 把没有 accessibility text 的事件统一视为 needs_visual。PRD 应保留可解释的证据状态，避免把 unchanged 当成 unavailable。
- 当前文本差分没有显式 baseSnapshotID/revision。Agent 若只看到一个 diff，无法可靠知道它依赖哪份树；我们的事件存储宜保留有版本的结构化 snapshot 与差分引用，消息上下文只放短摘要/引用。
- 同名元素不能靠显示文字作为 identity。旧版 tests 已覆盖重名 label、移动/新增/移除、层级与截断，但没有在本轮运行：`Tests/ComputerHistoryCoreTests/AXTreeSnapshotTests.swift:5,37,59,80`。

## 5. screenshot/OCR：异步 evidence enrichment

**已验证事实**：

- 只对 window.changed、click/context-menu/drag、submit 评估视觉：`src/main/history/visual.ts:4-10,73-75`。
- 主采集先 append 事件，再启动视觉 enrichment；输入采集、timeline、AX judge、实际截图、视觉模型分别排队：`service.ts:643-658,1152-1185`。
- 规则 judge 的三态是 enough/needs_visual/uncertain；缺树、仅窗口壳被判 needs_visual；含非 image 内容差分判 enough；其他情况常为 uncertain。只有 uncertain 且配置模型 judge 才额外判断：`visual.ts:107-147`，`service.ts:782-807`。
- 同窗口先等 500ms settle；更晚事件可取消尚未 settle 的旧 intent。可以在模型 judge 尚未返回时捕获候选帧，待结果 enough/uncertain 时丢弃候选，避免“等模型回来后屏幕已变”的明显问题：`service.ts:751-779,810-868,877-942`。
- 窗口截图冷却 12 秒；provider failure 后退避 30s、2min、10min；图片理解缓存 30min。没有稳定窗口 identity 时采用 app 级 cooldown，避免一堆 unresolved 窗口绕过限制：`visual-policy.ts:1-6,41-100`。
- 每次截图请求有 eventID/requestID/app/windowID/title/url/private flag/expiresAt/includeImage；最多允许距事件时间 8 秒：`service.ts:1073-1088`。
- 原生先检查 policy、过期时间和录屏权限，获取 on-screen 窗口，再次检查 policy 与过期时间；窗口匹配优先 windowID，再唯一同 title，最后唯一普通窗口；有歧义就 unavailable。`VisualCaptureProvider.swift:61-146`。
- 使用 ScreenCaptureKit 的单窗口 screenshot，最大边 1920px，保持比例、不含 cursor：`VisualCaptureProvider.swift:91-106`。
- 本地 OCR 使用 Vision accurate + language correction。匹配现有敏感文本规则的 OCR 方框扩 4px 打黑；只有请求模型理解才附 imageBase64。图像停留在内存中，持久化 DTO 仅保留 OCR/理解/元数据：`VisualCaptureProvider.swift:107-120,149-197`，`types.ts:82-108`。
- 视觉结果包含 eventID/eventTimestamp/assessmentStartedAt/createdAt，单独 append 到 evidence.jsonl，读取时按 eventID join：`service.ts:933-942`，`storage.ts:354-365,531-568`。
- 视觉理解按相同窗口与**完全相同图像字节的 SHA-256**复用，不是感知哈希：`visual-scheduler.ts:22-30,55-86`，`service.ts:980-1007`。

**应吸收的 know-how**：视觉补证不阻塞事件落盘；补证具有自己的状态与因果引用；新事件取消旧候选；窗口身份必须验证；截图发生的时间明确记录；AX/视觉/模型处理可各自失败，仍保留已有证据。

**局限与 PRD 建议**：

- 500ms settle、12s cooldown、8s expiry 是历史产品的具体策略，不能照搬为“每次用户 action 的屏幕证据”。主动式场景需要明确哪些事件可合并、哪些属于不能丢失的状态转移，以及合并之后丢了多少条原始事实。
- OCR 和截图反映补证时刻，而非原 action 的严格原子快照；仍可能错过瞬时 toast、菜单或短暂弹窗。目标窗口匹配只保证一个窗口，不能保证它内部 tab/内容 revision 未变。
- OCR 识别与正则覆盖决定遮挡效果，不能把 `redacted_remote` 字段写成“所有敏感内容都已经证明安全”的强保证。
- 完全字节相同缓存对微小变化、光标闪烁和动画不鲁棒；是否新增感知差异/区域变化应通过受控场景评估。

## 6. 过滤、去重、聚合的实际后果

**已验证事实**：

- 原生 app/surface 策略在重 AX 抓取之前过滤；Electron 再做 observation policy 与脱敏。策略覆盖 app、域、窗口标题、private browsing、敏感 target：`HistoryEngine.swift:244-252`，`AXContextReader.swift:162-169`，`src/main/history/policy.ts:180-275,336-370`。
- URL 去掉 username/password/query/hash，保留路径等信息：`policy.ts:204-214`。
- private browsing 使用限定 browser bundle + 标题中英文 marker，属于启发式：`AXContextReader.swift:873-892`。
- EventCoalescer：selection 80ms 内去重；相同非空选区 1.5s 内抑制；空选区仅保留结构性 roles；非 activation window callback 2s 内同窗口抑制；文本 200ms 内抑制、30s 后重建文本基线；全文相同抑制。`coalescer.ts:110-180`。
- typing 由前缀差分生成增量：尾部新增保存后缀、尾部删除保存 `<deleted:N>`，中间变化保存完整当前值；清除 target.value：`coalescer.ts:212-225`。
- EventBurstCoalescer：相同 target 的 click 800ms 聚合；title 2s 聚合，其他非 activation window 750ms 聚合；保留最新事件和 occurrenceCount，把前后 AX 文本串接后截断到 48000 字符。`coalescer.ts:228-325`。
- storage 接收的是以上过滤/归一化/聚合后的 event。被聚合/去重事件只保留计数，原始逐次内容没有另一份无损日志：`service.ts:603-647`。

**建议**：若本产品称为“原始事件日志”，必须定义保存层级。DeskLore 的 raw segments 实际已经是处理后的语义事件，不能承担逐鼠标/逐键无损回放。可以采用“短期物理事件 + 长期语义 episode”的双层模型，但这是 Proactive Agent 的新设计建议，非 DeskLore 已实现能力。

**与不预定义业务 pipeline 的关系**：上述去重和 snapshot budget 是基础设施对有限 CPU/存储/上下文的管理，能够与开放式 Agent 决策共存。需要避免的，是在这些基础规则里偷偷加入“只有某几类业务才值得处理”的硬编码业务判定。Enter 的发送推断也应暴露为推断，不能直接作为执行日程/发消息的授权依据。

## 7. 本地存储与 Pi Agent

### 7.1 实际存储，而非 SQLite

- `segments/<10min-id>/events.jsonl` 保存规范化事件；`metadata.json` 保存 eventCount 与 captured/policyBlocked/deduplicated/burstCoalesced 等计数；`evidence.jsonl` 保存延后补证。`storage.ts:26-27,331-394,577-594`。
- timeline schemaVersion 4 含 sourceSegmentID、claims、evidenceEventIDs、generator/version/model/failureReason；memory schemaVersion 2 含 sourceDocumentIDs/sourceSegmentIDs/sourceDigest。`types.ts:130-181`。
- 文件目录 0700、文件 0600；metadata 原子临时写入再 rename；event append 与 metadata write 是两个操作，不是数据库事务。`storage.ts:64-99,313-350`。
- 24h 后修剪 visual evidence，48h 后修剪 raw segments；timeline/memory 派生文档另存。`service.ts:661-670`。
- 每 250ms flush burst，30s maintenance：`service.ts:1128-1141`。

**建议**：Proactive Agent 是否选 SQLite 应由可恢复队列、按 eventID/任务/时间查询、事务与删除传播需求决定。DeskLore 只能提供文件结构与证据引用经验，不能被引用为“已有 SQLite schema 可复用”。本笔记不提供数据库操作命令。

### 7.2 已有 Pi 工具循环的范围

- 对一个十分钟 segment 创建新的 EvidenceSession 和 Agent。最多 4 个 model turns；每轮最多 3 个 inspection calls；单次最多 40 events；总 evidence budget 120 KiB；默认普通文本 2048 字符、AX 4000 字符：`timeline-agent.ts:11-16,723-799`。
- 初始只给 segment overview 与前序 timeline continuity hints。Agent 自选 `list_activity_spans`、`read_event_range`、`search_events`、`read_events` 查询证据；完成时必须调用 `submit_timeline`。`timeline-agent.ts:498-640,791-793`。
- inspectedEventIDs 记录真正被工具返回的事件；提交时每条 claim 与证据引用必须落在这个集合，不允许引用只见于目录但未读过的 ID。`timeline-agent.ts:289,326-327,399-419,429-465`。
- `toolExecution: parallel` 允许同轮并行只读 inspection；submit_timeline 必须是该轮唯一 tool call；beforeToolCall 可阻止超额/不允许的工具。`timeline-agent.ts:751-781`。
- 新 Agent 的系统提示把观察内容、AX、URL、visual、历史摘要和 tool result 明确视为不可信观察证据；内容不能反过来成为系统指令。`timeline-agent.ts:753`。

**可复用经验**：让 Agent 对完整已保存证据主动检索，主上下文保留 overview 和当前工作状态；工具返回证据再引用，比每次拼接全部屏幕文本更可控。结构化提交 + 引用校验可以迁移为 proactive decision 的 provenance 契约。

**已验证的缺口**：本地版本的 Agent 不持久订阅 input/webhook，不维护跨事件的长期任务状态，没有 executor sub-agent registry，也没有任意业务插件的调度。因此 `toolExecution: parallel` 不等于用户所说的持续 observer + 异步执行者架构。

## 8. 诊断与捕获盲区

### 8.1 诊断已有能力与误读点

- 原生健康字段包含 AX permission、global interaction active、Return/submit/shortcut/text/selection 计数、AX observer/notification target 数、节点访问/输出、duration、slow/truncated 次数、capture backlog。`HistoryEngine.swift:16-35,364-401`。
- UI 显示 permission/global listener/AX observer 的布尔 ready/notReady；另显示 capture duration、部分 semantic counters、backlog、raw/persisted/blocked/deduplicated/coalesced。`src/renderer/src/App.tsx:896-910,939-998`。
- **仍存在易误解点**：DeskLore 自身前台时 host app 被排除，AX observer 会 stop，而 UI 直接把 observer=false 映射成 notReady。它不区分“权限失败”“有权限但当前无合法目标”“监听失效”。当前固定 HEAD 已重新从代码核实，非只引用旧记忆。`HistoryEngine.swift:213-220,414-419`，`App.tsx:939-947`。
- “rawEvents”数来自 Electron 收到的原生语义 HistoryEvent，在 native 前已过滤的物理事件不进入这个计数；不能用该计数作为 OS raw input 的 recall 分母。`service.ts:603-619`，`HistoryEngine.swift:244-263`。
- UI semanticEvents 相加了 submit+shortcut+text_input，没有 selection：`App.tsx:969-974`。指标名比实际覆盖范围宽。

### 8.2 主动式产品需要补的可观测性

**建议，不代表 DeskLore 已实现**：

- 分开观测源权限、订阅存活、当前目标是否可采、最近事件时间、最近成功快照时间、排队延迟、丢弃/合并原因、覆盖范围和内容 stale 状态。
- capture -> event -> evidence -> observer decision -> task -> executor attempt -> side effect result 全链携带 ID；不能把“没有建议”归结为单一模型不够聪明。
- 明确可复现实验：只滚动阅读、同一窗口收到新消息、跨 app 快速切换、输入后立即 Return、输入中切焦点、输入法组合文本、语音输入、Canvas/图表、双窗口同 title、长 AX 树、权限撤销/休眠/解锁。
- 分别评估物理动作覆盖、语义内容覆盖、证据时间一致性、主动式判断质量与真正执行结果。单元测试通过不能证明 capture recall。
- DeskLore 自己在 `docs/EVALUATION.md:17-19` 要求独立 reference、bundle-aware 一对一时间匹配与 per-kind precision/recall/F1；`docs/EVALUATION.md:42-60` 要求同证据 AX-only/AX+Visual 对照与人工复核。相关测试存在但本轮未运行。

## 9. 远端 45 个提交：已核实的变更元数据

以下来自官方 compare API 的提交标题/说明及文件列表。当时仅核实版本变化；随后定向读取了 10 个远端文件，新增已验证事实见第 12 节。表格本身仍属于提交元数据，不替代源码证据。

| 提交前缀 | 远端声明的变更 | 对本 PRD 的影响 |
| --- | --- | --- |
| `31e33f3446` | harden timeline agent runtime | 旧版运行时限制不能直接代表最新 Pi runtime |
| `058481d7f1` | worker-ready handshake、parentPort、runtime/provider failure 分离 | 最新进程通信与恢复值得定向复查 |
| `c9d533376e` | 按连续失败退避、即时工作抢占延时 wake-up、迁移 stalled jobs | 主动任务调度的恢复经验已有新实现 |
| `935efccbd6` | 跨 capture reason 合并窗口回调、保留来源 reason | 固定版本窗口去重分析已落后 |
| `ff831572f9` / `26c6db8534` | 提取 transport-neutral ServerCore，并运行于 utility process | 当前目录与进程边界已经变化 |
| `29e953d7d0` | 按 Electron/ServerCore/Swift Collector 重排目录并加入 AGENTS/架构指南 | 旧源码路径不可用于当前 main 导航 |
| `d782d7d88b` / `b56c577f28` | memory -> rollups，统一 10min/6h/day timeline，移除旧兼容 | 旧版存储目录/schema 不能表述成最新格式 |
| `8265f00c8c` | recorder availability tracking | 健康与覆盖边界已有新模型 |
| `907865b381` | 产品定位改为 personal context infrastructure | 当前 README 已不等同旧版 history-only 定位 |
| `dbe770fd41` | 原生发送结构化 AX 树，替代已渲染文本 | 旧版 mode+text DTO 的局限很可能已针对性处理 |
| `1b3055dab3` | AX 树区分 content/navigation/chrome regions | 结构化语义区域可成为新 observer 输入参考 |
| `4a78dc9167` | 在 persistence path 派生有界 semantic frames | 最新上下文抽象重点，应追加定向源码读取 |
| `f756faf176` | timeline-agent semantic-first views + explicit raw drill-down | 更贴近我们“短工作上下文 + 按需原始证据”方向 |
| `7166aeb928` | semantic frame replay evaluator + baseline regression | 可参考的语义表示评估方法 |
| `e6bc974d7d` / `8230f9dc73` | Chromium app 请求完整 AX trees、优先最深 focus；浏览器缺 web area 时请求全树并加计数 | 采集完整性有最新专门处理，旧版 Chromium 盲区不能当现状 |

远端新增/重排的重要路径：`src/server/history/semantic/{ax-tree,frame,regions,surface,tracker}.ts`、`src/server/history/availability/{contracts,tracker}.ts`、`src/server/history/timeline/agent/{jobs,runner,runtime,evidence,diagnostics}.ts`、`src/server/history/storage/repository.ts`。上述仅验证路径出现在 compare 文件列表，内容尚未全部读取。

## 10. 给 Proactive Agent PRD 的取舍清单

**建议吸收**：原生采集进程隔离；OS event 与 AX 语义互证；打字停顿/提交/切焦点 flush；预算化树遍历；结构化证据与 ID 引用；按窗取消视觉候选；capture 与模型解耦；缺失/过期/blocked/failed 的显式状态；Agent 主动检索完整证据；提交引用校验；独立的捕获和下游质量评测。

**建议重新设计**：无损 raw input 契约及 scroll；被动屏幕变化；event 与 AX/图片/OCR 的时间一致性；持久 inbox 与任务状态；主 Agent 的任务 revise/cancel；副作用前版本检查；plugin 既供 tools 又供 events；按任务注入执行能力；用户反馈与打扰控制。这些是新主动式产品要求，不是将 timeline agent 改名即可获得。

**不宜直接继承**：十分钟关闭桶才运行 Agent；固定 12 秒视觉 cooldown；把 Enter 推断当事实；把所有缺失 AX 视为信息不足；把处理后 JSONL 称为每次物理动作的完整原始日志；将布尔 observerActive 等价于传感器完整健康。

## 11. 许可证与历史辅助来源

- **已验证许可证**：固定版本 `LICENSE:1-3` 为 Apache License 2.0；`package.json:10-11` 声明 Apache-2.0 / Ziwen Song；官方仓库页面同样显示 Apache-2.0。本笔记仅识别许可证，不提供法律判断。[固定版本 LICENSE](https://github.com/FoundDream/desklore/blob/b5928393700a743bfdbcfa01da78a3b9b1d095ed/LICENSE)。
- 调研中使用旧记忆定位 AX 诊断误报，然后重新读取当前固定 HEAD 验证。记忆来源：`MEMORY.md:1096-1096`；`rollout_summaries/2026-08-24T08-57-29-2wUA-desklore_pnpm_setup_and_ax_diagnostics_false_alarm.md:41-44`；对应 rollout ID `01a032fd-319f-7af2-a3d3-2a653785c014`。旧记录里的安装/运行成功没有作为本轮运行验证结论。

## 12. 最新固定 SHA `8851346` 的定向复核

### 12.1 复核边界与文件

**已验证事实**：从官方 `raw.githubusercontent.com/FoundDream/desklore/8851346c7e544b6da07372d7a9a5aca9f81317f1/` 下载以下 10 个文件到 `/private/tmp/proactive-desklore-latest/`，仅静态阅读。没有修改原 clone、没有运行下载的代码、没有采集或数据库操作。后续本节路径均相对最新 SHA，行号也属于最新文件。

1. `package.json`
2. `native/collector/Sources/DeskLoreCollector/Capture/InteractionMonitor.swift`
3. `native/collector/Sources/DeskLoreCollector/Capture/AXContextReader.swift`
4. `native/collector/Sources/DeskLoreCollector/HistoryEngine.swift`
5. `src/server/history/semantic/frame.ts`
6. `src/server/history/semantic/regions.ts`
7. `src/server/history/semantic/tracker.ts`
8. `src/server/history/storage/repository.ts`
9. `src/server/history/timeline/agent/runner.ts`
10. `src/server/history/timeline/agent/runtime.ts`

### 12.2 最新输入事件仍不是完整 raw-input 采集

**已验证事实**：最新 InteractionMonitor 与旧版本的 diff 只有 import 名称 `ComputerHistoryCore` -> `DeskLoreNativeCore`，监听与键盘处理逻辑完全一致。因此仍无 scroll mask、无其他鼠标键、普通字符仅标记 typing activity，未逐字符发 HistoryEvent。左键 down/drag/up、右键 down、keyDown 见 `InteractionMonitor.swift:39-46`；字符处理见 `142-195`。

最新 HistoryEngine 仍在 Return 前 flush 文本、鼠标换焦点前 flush pending changes；2s timer 仍负责 frontmost 轮询；rich snapshot 排除 text_input/shortcut/selection。见 `HistoryEngine.swift:81-100,142-148,320-330`。最新新增 usage availability 回调，给 unavailable 发独立状态事件：`HistoryEngine.swift:129-139`。

**本轮未核实最新细节**：没有下载最新 AXNotificationMonitor，因此旧版 350ms/1s typing debounce 和 2s recent typing 只能作为旧版已读事实，不能直接标为最新已核实配置。没有重读最新视觉协调器，所以 500ms/12s/8s 等视觉数字也只引用旧版本。

[最新 InteractionMonitor](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/native/collector/Sources/DeskLoreCollector/Capture/InteractionMonitor.swift#L39)

### 12.3 结构化 AX 与 Chromium 的真实补强

**已验证事实**：

- AX 原生输出已经从 mode+渲染文本升级为 `fullTree + tree` 或 `diffFromPrevious + delta`；同桶差分无变化仍省略 context，变化 >=65% 仍输出全树：`AXContextReader.swift:313-350`。
- 原生遍历预算仍是 1200 visited nodes、800 output nodes、depth20、700ms：`AXContextReader.swift:353-360`。这表明“结构化”没有消除完整性/时延的取舍。
- 最新增加针对懒加载 AX 的适配：检测 `AXManualAccessibility` 是否可写来识别 Electron；已知 Chromium browser 列表包含 Chrome/Canary/Edge/Brave/Vivaldi/Arc/Opera/Chromium。树 degenerate，或 Electron/Chromium 缺少 WebArea 时，按 PID 至多尝试一次启用 `AXManualAccessibility` / `AXEnhancedUserInterface`。源码注释指出 enhanced mode 可能让部分应用窗口动画变慢：`AXContextReader.swift:864-910`。
- 先抓本次 snapshot，再调用 enhanced request；返回事件仍使用刚才那份 snapshot，没有在同次方法中立即重新抓取：`AXContextReader.swift:199-240`。能否得到完整新树取决于后续采集。
- 该方法在执行 setter 尝试前就把 PID 加入已尝试集合；setter 成功才返回 true。`HistoryEngine.swift:381-384` 的 enhancedAccessibilityRequestCount 只在该返回值为 true 时递增。因此计数不是“本次树已经完整”的证明。

**建议**：把主动增强 AX 的请求、成功、下一次树是否出现内容区、内容节点增长、捕获时延分开记录。将 Chromium 空壳树盲区纳入验收，而不是只检查 AX 权限。这里讲的是代码的已有行为，本轮没有实际向任何 app 设置 AX 属性。

[最新 AX 增强逻辑](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/native/collector/Sources/DeskLoreCollector/Capture/AXContextReader.swift#L875)

### 12.4 SemanticFrame：最值得参考的最新 know-how

**已验证事实**：

- `extractSemanticFrame` 是纯函数，把完整、已脱敏 AX snapshot 转为 version=1 的 semantic frame；可以对历史 snapshot 重放新 extractor，而不必重新采集。`frame.ts:18-21,68-102`。
- Frame 字段包括 surface、identity（title/url/domain/path）、outline、body、bodyTruncated、focus、recent、regions 各区文本量。默认 body 4000 字符、outline24条每条160字符、recent8条每条200字符、focus500字符、focus path最多6级。`frame.ts:23-41,91-101,148-164`。
- 先按 siblingIndex 恢复文档顺序，保护循环并补入不可达节点：`frame.ts:104-128`。这避免采集时“优先焦点的遍历顺序”被误当用户阅读顺序。
- 内容区域优先保留；按钮/checkbox/radio/menu/slider/image/scrollbar 等控件不进入 body。多行 value 拆为行；terminal/chat/mail 优先保留尾部，其他 surface 默认保留头部：`frame.ts:51-88,215-231`。
- 当父容器与子元素都标 focused 时，优先内容区内最深的 focused node，同深度优先有文本，附最多6级祖先标题路径：`frame.ts:179-212`。
- Region 划分是通用结构规则：AXWebArea/AXDocument/AXTextArea 为 content；AXOutline/AXBrowser/AXList/AXTable 为 navigation；toolbar/tab/menu/status 等为 chrome；支持按 bundle 注册 override。未知节点默认 content。`regions.ts:38-65,74-87,110-120`。
- region 原始节点仍在 partition 中，body 是其派生视图；可以分别计算每个 region 的节点数/文本节点数/字符数。`regions.ts:123-151`。
- `SemanticFrameTracker` 缓存每个窗口最近 full tree，delta 重放后才能派生 frame；最多64 streams，按最近使用淘汰；stream key 为 app + runtimeWindowID（缺失时用 title）；缺基线的 delta 返回原 event，不伪造 frame。`tracker.ts:4-56`。

**目前仍能从最新代码确认的边界**：

- 没有 tree/delta 的 event 不借用最近 frame 生成新 frame；缺基线不会自动把 delta 当全树。它选择可解释地缺失，尚未在此 tracker 看到主动向 Collector 请求补全基线的机制。
- 这是 bounded semantic view，不是无损屏幕表示。body 排除了控件、只保留部分正文；outline 只抽 AXHeading；recent 是文档顺序尾部若干行，并不是通过时间戳证明“这些文字刚新增”。不能把 recent 字段当 change event。
- 窗口 ID 缺失时以 title 作为 key，标题变化或同名窗口可能影响基线命中；原生树的 stream key 则基于 AX window 元素 identity。PRD 应统一跨边界 stream/window identity。
- `applyAXTreeDelta` 保留 base.wasTruncated，delta 本身在该方法未重估完整性：`frame.ts:131-140`。不要把成功重建 frame 等同于已获取完整 AX 内容。
- 结构规则会有 app 适配与覆盖代价；它们整理证据，不直接决定用户应做哪个业务动作。可以把它当 observation plugin 的可替换 extractor，保留 raw drill-down 和版本号，让主 Agent 的业务判断保持开放。

[最新 Frame](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/frame.ts#L68)、[Region](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/regions.ts#L38)、[Tracker](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/semantic/tracker.ts#L17)

### 12.5 最新存储仍然以文件为核心

**已验证事实**：`src/server/history/storage/repository.ts:27-66,348-381` 仍定义 10min segments、events.jsonl/evidence.jsonl，并使用文件 append。目录把 memory 改成 rollups/6h 与 rollups/day，另有 usage/recorder-availability；metadata 使用公共 atomicWriteOwnedFile。最新 `package.json:41-60` 未声明 SQLite 依赖。

**精确结论**：本轮已读的当前 history 存储实现仍是 JSONL/文件目录模型，未引入可借用的 SQLite schema。本轮不是对当前全库所有未读模块的 SQLite 使用作全面排除。Pi runtime jobs 的文件与持久恢复实现没有在这10个文件范围内完整读取。

[最新存储](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/storage/repository.ts#L348)

### 12.6 最新 Pi Agent 已升级为可推进的 session，职责仍是 timeline

**已验证事实**：

- 包版本仍是 Pi 0.84.2；系统提示首句仍定义“将一个十分钟 computer-activity segment 变为有证据的摘要”。工具仍是 list/read/search evidence + submit_timeline，没有主动式业务动作或通用 executor plugin。`package.json:46-47`；`runner.ts:539-735,757-762`。
- Evidence 默认返回 semantic summary；`include_accessibility` 给完整 content-region body；`include_raw_accessibility` 显式给 rendered AX 原始视图。只有 detailed request 才附更完整 visual evidence；没有 frame 时可退回 AX text。`runner.ts:207-235`。
- **旧版4轮、每轮3 inspection、总120KiB限制已不能用于描述最新版本。** 最新只保留每次 inspection最多40 events和字段长度，支持多页按需读取；累计 evidenceBytes用于观测。`runner.ts:17-19,380-446,762`。
- `TimelineAgentSession` 把一次模型 turn 作为 step，Pi `shouldStopAfterTurn: () => true`；首次 prompt，后续根据最后角色调用 continue 或发 continuation prompt；有成功结果返回 succeeded；连续3步无进展返回 stalled。进展签名使用已读事件数、不同 inspection request 数、submissionRevision。`runner.ts:891-993`。
- 支持 abort；runtime 提供 step/abort/dispose，统计每步 turns/toolCalls/evidenceBytes/tokens/submission/invalid citations。`runtime.ts:11-46,63-121`。
- 超过360000序列化字符时，把较早的 toolResult 正文替换为“需要时重读对应事件”的提示，保留最近12条 messages；通过 Pi transformContext 应用。`runner.ts:863-883,925-948`。这不是把所有历史永久原样塞进模型。
- 该压缩方法仍保留消息数量及旧 user/assistant 内容，只缩小较早 toolResult 正文。因此它不是已验证的长期无限消息内存上限方案，不能直接代替 proactive 的会话分段与状态压缩策略。
- worker 返回值还需要核验：claim引用既在该次 inspected IDs 中，也在 sourceEventIDs 中，文档证据集合与各claim证据并集一致。`runtime.ts:124-175`。

**可迁移但要继续验证的判断**：单步可推进、abort、进展检测、上下文压缩、按需精读，恰好说明“Agent 常驻”和“模型单次调用”可以分开。把这层模式应用到 proactive observer很合适；但这里的输入仍是固定 segment，现有 session 并未提供用户事件到达后的 inbox append/revise task 生命周期。不能说当前 DeskLore 已经实现我们需要的编排者与执行者。

[最新 Pi Session](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/timeline/agent/runner.ts#L891)、[最新 runtime 校验](https://github.com/FoundDream/desklore/blob/8851346c7e544b6da07372d7a9a5aca9f81317f1/src/server/history/timeline/agent/runtime.ts#L124)

### 12.7 PRD 应采用的当前表述

“DeskLore 最新固定版提供独立原生 Collector、结构化 AX tree/delta、Chromium懒加载AX增强、可重放的 bounded semantic frame、semantic-first/raw-drill-down 的 Pi Timeline Agent，以及文件式事件证据存储。当前已核实输入监听仍未包含 scroll，字符键不逐键形成历史事件；Pi Agent职责仍是十分钟历史摘要。Proactive Agent 可借鉴证据获取与渐进读取机制，并另外设计实时 inbox、持续观察会话、任务版本/撤销、异步执行者与业务插件事件协议。”

**尚未完成的最新验证**：最新 AXNotificationMonitor 的具体 debounce、最新视觉捕获阈值与OCR实现、jobs持久化恢复、当前诊断UI/availability全链、最新真实捕获召回和性能。本轮只做10文件静态定向核实，不把旧版参数或已有测试名称冒充这些结果。
