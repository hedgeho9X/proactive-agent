# Proactive Agent Runtime 选型调研

调研日期：2026-09-06。范围：官方文档与公开源码的静态核对；未安装、未运行模型、未实现应用、未修改业务仓库。本稿为 PRD 的技术输入，不是可运行性验收报告。

DSH 源码快照：`d347e703908d0406b7a7ef80e3a0e594d86b2215`，committer 时间 `2026-09-04T09:16:23Z`，合并 PR #3554（`dsh-0.1.3-alpha.1`）；SHA 和提交元数据由主调研 Agent 通过公开 GitHub API 核实，本稿另外读取该 SHA 的 SDK 协议、subagent 工具源码和 LICENSE 交叉检查。生成文档以 2026-09-06 的访问状态为准，不能假定未来文档仍对应此快照。[固定提交](https://github.com/deepseek-ai/deepseek-harness/commit/d347e703908d0406b7a7ef80e3a0e594d86b2215)

DSH 许可证为 MIT，版权声明为 Copyright (c) 2026 DeepSeek；代码或实质性部分进入发行包时保留版权和许可文本，第三方依赖另按各自声明处理。[固定快照 LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/LICENSE)

## 1. 推荐结论

建议首版使用 **DeepSeek Harness 作为唯一主 / 子 Agent loop**，复用它内部的 Cordis 服务、事件、会话、工具和可继续子代理原子。使用随应用发布的固定 profile / bundle 挂载本应用能力，不做插件商店、用户安装、热更新或通用插件管理 UI。

需要自己实现的是桌面观测领域：Action / Evidence SQLite 存储、AX 过滤和事实摘要、观测注入策略、调试视图，以及将桌面宿主接到 Harness 内部原子的窄桥接层。不要重新实现 Harness 已提供的主 / 子 Agent FIFO、消息历史、子代理 activation、父子通信和取消机制。

关键保留条件：DSH 目前是 developer preview，API 会有破坏兼容的改动；SDK 的现有跨进程协议未完整暴露内部控制能力。因此实施应先完成一个小型“SDK + bridge + continuable subagent”验证切片，再开始完整 UI。单凭 README 不能宣称已经适配 Electron / Bun。[DSH 仓库](https://github.com/deepseek-ai/deepseek-harness)；[SDK Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)

## 2. Cordis 与 DSH：准确的复用边界

Cordis 提供 Context、Service、依赖注入、类型化事件、可释放注册和插件生命周期。Agent loop、会话、工具、存储、子代理均由 DSH 的插件提供。只安装一个通用 `cordis` 包不会自动得到这些 Agent 能力。

DSH vendor 了自己的 Cordis 版本，应用扩展应跟随锁定的 DSH 使用 `@deepseek-ai/cordis` 等同套包，不应再混入另一个不匹配的独立 Cordis runtime。首版可将“插件”解释为开发者随应用发布的能力模块，而不是用户安装产品。[Cordis primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)；[Cordis 仓库](https://github.com/cordiverse/cordis)

### 可复用包 / 服务

以下为此次 master / 官方生成文档观察到的名称；实施时须核对锁定版本的 package exports 和 config，而非深层 import 源码：

| 能力 | 包或公开原子 | 本应用用途 |
| --- | --- | --- |
| 生命周期 / 依赖 | `@deepseek-ai/cordis`，Context / Service / inject / `ctx.on` / `ctx.effect` | 内置模块注册、依赖等待、关闭时清理 |
| Agent 接口 | `@deepseek-ai/dsh-agent`，`ctx.agents` | 创建、恢复、查找主 Agent |
| 唯一 loop | `@deepseek-ai/dsh-agent-loop` | 实际驱动推理和工具调用；业务模块依赖 Agent 接口 |
| 会话事件 | `@deepseek-ai/dsh-session`，`SessionEvent` / `ctx.sessions` | Agent 模型上下文和可回放历史真源 |
| 工具 | `@deepseek-ai/dsh-tools`，`defineTool` / `ctx.tools` | 输入 / 输出 schema、执行、错误、展示 |
| 系统上下文 | `@deepseek-ai/dsh-system-prompt`，`ctx.systemPrompt` | 稳定角色、职责、可见工具描述 |
| 模型 seam | `@deepseek-ai/dsh-llm`，`ctx.llm` | 接入模型 adapter；与 loop 解耦 |
| 持久化 | `@deepseek-ai/dsh-session-persistence` + `@deepseek-ai/dsh-session-persistence-jsonl` | 复用原生日志持久化和恢复 |
| 子代理 | `@deepseek-ai/dsh-subagent` | 启动、继续、父子消息、查找和停止 |
| 子代理后端 | `@deepseek-ai/dsh-subagent-spawn-in-process` | 新上下文的执行者，首版优先 |
| 子代理工具 | `@deepseek-ai/dsh-tool-subagent` | 模型派发任务 |
| 子代理控制 | `@deepseek-ai/dsh-tool-subagent-control` | `send_message` / `interrupt_agent` / `list_agents` |
| 主程序集成 | `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-sdk-protocol` | 宿主控制 sidecar 与订阅事件 |

[架构包映射](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)；[核心原子](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/core)；[子代理包和接口](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)

## 3. 原生收件箱和消息注入：已有，不必重造

DSH 的 Agent 有 session-backed identity、`inbox` 和 `idle | running` 生命周期。内部 Agent surface 的确切语义如下：

| 调用 | 实际行为 | 建议用途 |
| --- | --- | --- |
| `agent.followup(message)` | 投递 `next-turn`，唤醒；普通输入各自占据一个轮次 | 用户显式输入 |
| `agent.steer(message)` | 投递最近可用的 step；空闲时唤醒 | 已稳定、值得处理的观测批次；对当前目标的修正 |
| `agent.inject(message)` | 投递 `next-step`，不唤醒；已运行时在后续 step 领取 | 补充背景证据、低优先级状态变化 |
| `agent.send(message, target, wakeup)` | 明确指定 `next-turn` / `next-step` 与是否唤醒 | bridge 映射不同来源事件 |
| `agent.cancel(cause, { keepInbox })` | 协作式中止当前活动，可保留未领取消息 | 用户暂停推理、明显失效的执行 |
| `agent.whenIdle()` | 等待整个 Agent 停稳 | 正常关闭或维护，不可当作某一 action 的结果 ID |

Inbox 的变更有规范 `agent/inbox/spliced` 持久事件；单条消息有 inserted / claimed / discarded 观测点。普通输入和 step 注入共享 Agent 已有的两个有序列表，模型历史从 `SessionEvent` 派生。**不能在 sidecar 外再维护一份独立可编辑的 messages[] 当成第二真源。**

需要特别说明：“接受入队”“进入模型本轮输入”“持久写入已 flush”“完成响应”是四个不同状态。`followup()` 不返回本轮响应句柄；`MessageId` 关联的是消息而不是最终 assistant。高频事件可能合并进入同一步，UI 必须显示 input action IDs → message ID → turn / step → tool call 的关系。[Agent surface 与 Inbox](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/core)

业务补充：外部 SQLite 先持久保存 Action，bridge 保留稳定 action/message 去重键以及入队回执。DSH 批量写日志有 flush 窗口，不能把内存接受或同步 `session/event` 等同于 fsync 成功。应用崩溃重启时用持久回执对账，避免重复唤醒；观测账本和 Agent 会话账本承担不同领域，不是互相复制聊天历史。[持久化机制](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/persistence)

## 4. 子代理：选择 continuable，而不是普通 await

DSH 已存在两种子代理模式。`one-shot` 默认前台等待；开启 `run_in_background` 时可以变成 job，结果由 job output 收集。**本项目推荐 `backgroundMode: continuable`**：`enableRunInBackground: true`，未指定时默认后台，使用稳定 child session ID，子代理以后可以继续接收指令。

固定 SHA 源码确认：配置 `backgroundMode` 默认确为 `one-shot`，`enableRunInBackground` 默认 true；运行时以 `request.run_in_background ?? options.continuable` 选择后台。continuable 分支等待的是 `startContinuable` 接受，再返回 canonical output `{ kind: 'continuable', subagentId: started.childId }`；“started subagent …”是工具结果的文本呈现，不是独立的 job result。[固定快照配置与执行源码](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/tool-subagent/src/index.ts)

内部 `ctx.subagents.startContinuable(spec)` 在子代理接收初始 prompt 后返回 `{ childId, messageId }`，不等待开始推理或完成。`ctx.subagents.sendMessage(sender, targetId, content, options)` 可向直接父或可继续子代理发消息；运行中转为 step steering，空闲时唤醒，没有 activation 时从持久会话冷恢复。子代理结束时，runtime 向父代理投递带来源标记的 settlement notice；不要伪装成子代理自己发送的内容。[子代理原子](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)

模型面对的现成 `subagent` tool 支持 background 配置、每实例 persona / toolFilter / maxDepth、配置模型路由。工具输入可保留用户熟悉的 description / prompt；应用增加职责、证据引用、输出约束、取消条件等 prompt 组装。`spawn` 子代理不继承父历史，应给充分上下文；`fork` 只继承父代理已完成的轮次，当前正在执行的轮次不在 seed 中。首版用 spawn 更容易控制上下文成本。[tool-subagent 配置与行为](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent/tool-subagent)

### 不能误写的中止语义

- `interrupt()` 是发出取消信号后即返，不是确认执行已停止。
- 它保留未领取 Inbox、activation 和已经发布的后代，**不等于递归取消整棵任务树**。
- 已经被领取到中断轮次的工作不会自动重新入队。
- continuation 请求的调用方 signal 只控制接受前阶段；接受之后由 activation manager 拥有生命周期，父方本次 dispatch 调用结束不应杀死子代理。
- `drainContinuableDescendants(parents)` / `drainContinuableChildren(parent, ids)` 面向释放树 / 子树；真正停止按钮应区分暂停当前 turn、取消某个任务、关闭整应用。
- toolFilter 限制 schema 可见性与执行入口，不能单独当成 OS 文件权限 / 沙箱。

这些是 PRD 中“主代理可随新观察纠偏”的必要验收项。业务仍需 evidence version / goal revision / superseded 状态，避免主代理看到“改回周五”后，执行者把旧“改到周一”的提案当作当前结果。[控制接口与语义](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)

## 5. Electron / Bun 集成方案及明确缺口

### 已核实

DSH 官方应用入口为 `dsh` CLI 与 profile。TypeScript SDK `DeepSeekHarness` 使用独立进程、stdio 的换行 JSON-RPC；`dshBin` 可指定可执行入口，未指定时解析同版本 `@deepseek-ai/dsh`。SDK profile / patches 可以改变运行时组合。`HarnessClient` 是低层 API，可 start / initialize / prompt / request / close；`prompt()` 接受入队就返回 message ID，`subscribeSessionTree()` 可筛选根会话和子会话通知。[SDK Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)

现有 wire 只有 client→server `initialize`、`session/prompt`、`shutdown`；通知包括 `session.event`、`session.status`、`subagent.started`、`subagent.finished`。没有公开的 mid-turn cancel、直接 inject / steer 控制，也没有已实现的 server→client 请求机制供审批使用。SDK 文档明确不支持单独取消一轮，放弃运行需关闭 runtime。[SDK 协议](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)

固定 SHA 的 `HarnessSdkRequestMap` / `HarnessSdkNotificationMap` 已交叉核实以上三个请求、四个通知；`SessionPromptParams` 仅提供 `sessionId` 与 `contentBlocks`，没有 target / wakeup / steering 字段。图片内联输入 MIME 支持 png / jpeg / webp / gif，接收后转为持久附件。[固定快照 SDK wire types](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/sdk/protocol/src/types.ts)

因此 `harness.run(action)` 每条 action 一次、等待 idle，不适合本产品：高层 run 的 finalResponse 是该活动区间最后一条根助手消息，不能因果归属给某个 prompt。低层 prompt 与事件订阅更合适，但控制能力仍有缺口。

### 推荐设计，待实施验证

采用独立应用：Electron renderer 仅展示；主进程 / 本地宿主负责采集桥和 SQLite；一个受宿主拥有的 DSH sidecar 负责所有 Agent。首版内置一个 `proactive-bridge` Cordis 模块，对受信任本地宿主暴露受限 action delivery / inject / steer / cancel / session read / event stream，并在 sidecar 内调用公开 `ctx.agents` / `ctx.subagents` 原子。传输可选本地 socket 或额外受限 HTTP 通道；只有核对 SDK server 可扩展注册点后，才决定是否扩展同一 JSON-RPC 通道。**不能把“准备自建的 bridge method”写成 SDK 已有 API。**

事件输出需要同时覆盖：已提交的 session events 和 live assistant deltas。DSH 架构将 `agent/assistant-stream` 定义为进程内 live surface，不能仅凭 SDK 的 `session.event` 推断 UI 会得到全部逐 token 增量。桥接 spike 必须核对流式路径。

Bun 继续作为本应用包管理和构建工具，`bun.lock` 为依赖真源。**Bun 工具链不等于强制第三方 runtime 在 Bun 下运行。** 此次 DSH master package.json 为 `0.1.3-alpha.1`，声明 Node `^22.19.0 || >=24.0.0`，上游仓库使用 pnpm。应用可以用 Bun 管理发布依赖、用满足要求的 Node 运行 sidecar。是否借用 Electron 的 Node 或另带 runtime，需打包测试后决定；不能假定 npm 安装成功就保证 `.app` 内可以运行。[DSH package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)；[SDK 启动 bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/sdk-app/README.md)

DSH 已固定上述 commit SHA，并对 SDK wire / continuable 配置核对源码；其余生成文档仍记录为访问当日快照。`0.1.3-alpha.1` 是源码 manifest 观察值，不代表已验证 npm 上对应发布。实施第一步须固定同一发行版 / commit 全套包、存锁文件，避免 API 文档与实际版本漂移。

## 6. Read File / Web Search / Web Research

### 原生 DSH 已足够的部分

- `@deepseek-ai/dsh-fs` + `dsh-fs-local` + `dsh-tool-fs` 提供 read/write/edit seam。read 支持行窗口和输出上限；`dsh-fs-observation-policy` 提供先读与版本新鲜度约束。首版只开放 read 或由自定义 provider 限定所选目录，写操作注册为提案工具，不加载可直接产生真实写入的执行入口。[文件能力](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/filesystem)
- `@deepseek-ai/dsh-web` + `dsh-tool-web` 提供 `web_search` / `web_fetch`；现成搜索 provider 包有 Exa、Perplexity、DeepSeek，HTTP fetch 为独立 provider。凭证缺失应显式显示 unavailable；不要制造假搜索结果。来源结果具有 URL，可保留引用关系。网络 fetch 的 SSRF 限制不等于防止向公开 URL 发送用户内容，观测隐私策略仍属于本应用。[Web 能力](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/web)
- Web Research 建议是一个 subagent preset：目标 + 策略 + search/fetch/read 工具 + 引用输出要求。它不是另一个 Agent loop，也不是必须独立调用一次“大 research API”。

### Pi 实際可复用什么

当前 `badlogic/pi-mono` URL 重定向到 `earendil-works/pi`；包名为 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`。Pi 为 MIT。`pi-ai` 是统一模型 API，`pi-agent-core` 提供 Agent loop / tools / state；`pi-coding-agent` 增加 coding tools、SessionManager、压缩、扩展和 SDK。Pi README 明确主产品没有内建 sub-agents，需扩展或额外实现，不能把它当成 DSH 同等现成协调器。[Pi 官方仓库](https://github.com/earendil-works/pi)；[Coding Agent README](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)

`createReadTool(cwd, options)` 是公开导出的工具工厂，支持 offset / limit、文本截断、图片读取和 `ReadOperations` 注入。它可以不用启动 Pi 会话就构造 AgentTool，但返回结构、schema 和 UI renderer 属于 Pi 词汇，需要映射到 DSH `ToolDefinition`。DSH 已有 read，首版为读文件引入整个 Pi coding-agent 的收益不大；Pi 更适合当参考实现 / 对照测试，除非打包实验证明某个独有行为明显更好。[Pi SDK 导出](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)；[Pi read 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts)

Pi 的 `Agent.steer`、`followUp`、`abort`、`subscribe` 可以支持一个自建宿主；steering 在当前 assistant turn 的工具完成后注入，不是任意时刻改写已发出的模型请求。Agent core 的 messages state 本身不是替代 durable history 的承诺；coding-agent 的 `SessionManager` 才是其更完整会话层。若选 DSH，不能同时让 Pi SessionManager 承担同一主 Agent 的历史。[Pi Agent core](https://github.com/earendil-works/pi/tree/main/packages/agent)

## 7. AI SDK ToolLoopAgent 的定位

ToolLoopAgent 确实提供 generate / stream、多步 tools、prepareStep、structured output 和 abortSignal；它适合一次调用内的推理与工具循环。其官方基础 subagent 示例在 tool execute 内 await 子代理完成，流式 preliminary results 可以展示进展，但没有自动变成主代理返回后仍可持续控制的后台子会话。[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)；[Subagents](https://ai-sdk.dev/docs/agents/subagents)

源码表明它基于 generateText / streamText 组装调用，本身不提供 DSH 的 durable session inbox / cold resume / parent-child activation。若首版选择它作为唯一 runtime，需要自建这部分。它不是不合适的框架，只是用户此轮明确要求复用 DeepSeek Harness 同套原子，且已有更贴近需求的 DSH 实现，因此不选为主 / 子 loop。[ToolLoopAgent 源码](https://github.com/vercel/ai/blob/main/packages/ai/src/agent/tool-loop-agent.ts)

可以在独立事实摘要任务中使用单次 provider call，必要时用 AI SDK 的结构化输出适配某模型；它只做 evidence → factual summary，不保存长期 Agent 会话、不注册第二组 Agent。更优先让模型调用经过同一模型 adapter 策略。AI SDK 当前仓库许可为 Apache-2.0。[LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)

主调研 Agent 已核实 Gemini 3.8 Flash：稳定模型 ID `gemini-3.8-flash`，支持图像和 structured output，thinking 为 low / medium / high、不支持 minimal。模型存在性不再列为未知；模型产品依据与精确官方链接由主 PRD 的模型调研段落承接。实际 DSH adapter / 路由集成仍需单独验证。

## 8. Schema-only 首版的正确结果语义

DSH `defineTool` 同时声明参数、输出 schema 和 execute。需要研究 Agent 意图时，注册真实可调用的 **proposal tools**，execute 只保存提案并返回真实状态，例如 proposed / not_executed，绝不能返回伪造 calendar event ID 或声称文件已写入。

建议能力分为两种，UI 清晰标示：

| 类型 | 首版执行 | 结果 |
| --- | --- | --- |
| 运行时原子：派发、消息、读取已有 evidence、读取允许目录 | 真执行 | accepted / result / failed / cancelled |
| 外部副作用：calendar create/update/delete、memory write、file write | 只生成提案 | proposal ID、目标、拟修改内容、证据 action IDs、not_executed |

输入 schema 应在正式 execute 前校验；输出同样校验，UI 使用 canonical result，不通过自然语言猜成功。每个工具由统一定义产生模型 schema 和调试卡片；`presentCall` / `presentResult` 是可回放纯投影，能对应用户要求的“Agent 想干什么、Sub-agent 做了什么”。[DSH ToolDefinition 与 schema DSL](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools)

建议最小工具组合：主 Agent `subagent`、`send_message`、`interrupt_agent`、`list_agents`、`observation_read`、`attention_update`、`proposal_record`；执行者按 preset 得到 `read`、`web_search`、`web_fetch`、`calendar_*_proposal` 或 `memory_*_proposal`。其中 observation / attention / proposal 是本应用新增工具，不是 DSH 自带包。

## 9. 实施前必须完成的验证切片

1. 固定 DSH 包版本、支持的 Node runtime、一个已验证模型路由；无真实桌面数据时用合成 action。
2. SDK sidecar 启动 / 退出成功；关闭应用后 sidecar 被回收；没有孤儿进程。
3. 同一个主 session 连续输入两条观察，第二条在第一轮尚运行时能够入队；记录 messageId、claimed step 与模型可见证据。
4. 主 Agent 通过 continuable subagent 派发一个可控延迟任务，立即返回 child ID；延迟期间主 Agent 可接收新观察并响应。
5. 对 child 发送修正后，在下一 step 生效；取消显示 cancelling → stopped，不把发信成功当成停机成功。
6. live text stream 和最终 durable message 可通过 bridge 连到 UI，结果事件和 action causal IDs 可回看。
7. 杀掉 sidecar 后从日志恢复，区分 interrupted turn、未 flush 事件、待处理 action，对同一 action 不重复产生提案。
8. Schema-only 日程工具输出 proposed/not_executed，整个演示无真实日历写入。
9. 对比 DSH 原生 read 与所需文件读取行为；无明确缺口就不引入 Pi runtime。
10. 在 macOS 打包应用中验证 sidecar 路径、Node ABI、图片附件、退出取消和 SQLite 连接边界；仅 development mode 能跑不算通过。

若 1–6 任一基础能力因锁定 DSH 版本不可用，先对 bridge / bundle 做一次局部修正；仍无法满足才形成 ADR 比较 Pi 唯一 loop 备选。不要为了绕过一个 IPC 缺口把三套 loop 并排装入产品。

## 10. 尚未核实的部分

- 目标 DSH npm 发布的可用性、以及除已核对接口之外与访问当日生成文档的逐项一致性；源码 SHA 已固定。
- 新应用是否可由现成 Electron Node 运行 DSH sidecar、以及签名 / 打包后的路径和原生依赖行为。
- DSH 内部 live assistant delta 到现成 SDK 通知是否完整映射；本次只确认内部事件与 SDK 有限协议。
- 锁定 DSH 版本的 Google adapter / 路由以及实际 Gemini 3.8 Flash 请求兼容性；不能因为 Google 提供模型就认为 DSH 已接通。
- 主 / 子 Agent 在观测风暴中的实际延迟、内存、token 与取消耗时；需要合成事件负载与真实屏幕场景测量。
- 自动 crash resume 是否恢复业务级关注目标与任务有效性：DSH 恢复会话不等于本产品的业务任务继续有效，仍需应用 policy。
