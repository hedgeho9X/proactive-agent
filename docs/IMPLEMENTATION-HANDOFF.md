# 交给实施 Agent 的任务说明

这是实施入口，不是本轮启动新任务的指令记录。研究阶段已经完成文档交付，尚未创建应用或运行采集。

## 1. 目标

为 Jerry 建立一个新的 macOS 主动式 Agent 实验应用，工作名 Proactive Agent。重点是持续观测、事实理解、异步主子 Agent、可追溯证据和调试面板。新应用与其他应用 代码和数据独立。

用户明确要求：首版不做插件安装与市场，但应尽量使用 DeepSeek Harness 同一套原子；优先复用现有运行时，避免重写 Agent loop。业务写工具先实现 Schema 和真实的 proposal 记录，让用户看清 Agent 想做什么；不要假装已完成外部操作。

## 2. 建议阅读顺序

1. `PRD.md` 第0–4节：目标、范围和技术选择。
2. `PRD.md` 第10、18节：DSH接入边界与先验证什么。
3. `RESEARCH.md` 第2–3节：DeskLore最新源码经验与DSH原子。
4. 再按所做切片阅读PRD对应数据/捕获/UI/验收章节。
5. 需要准确源码证据时查看references中的笔记，优先固定SHA链接，避免重复大范围调研。

本文是短入口，冲突时以PRD中明确的用户需求与验收要求为准；发现上游版本已变化时保留证据并更新技术适配，不静默改变产品目标。

## 3. 开工边界

- 在独立新项目内工作，建议仓库名 `proactive-agent`，与其他应用 业务仓库并列；实际路径由承接任务的环境决定。
- 当前 `开发工作区` 只做本地开发控制面，不把新业务代码直接塞进它，也不放回旧Desktop仓。
- 创建前检查目标路径是否已存在及Git/dirty状态，保留现有工作。
- 使用Bun和bun.lock管理新项目；DSH运行时按其Node兼容要求执行，不强制上游源码改用Bun。
- 文档和代码注释使用中文；标识符、协议字段、第三方名称保持原文。面向用户展示的代码块逐行解释/注释。
- 不访问其他应用、DeskLore的用户历史数据库，不运行Supabase CLI、Management API、直连或绕过方案，不修改生产环境。
- 测试应用自己的明确身份，不能修改其他应用 bundle ID 来绕过权限。
- 用户选择的测试目录与本应用新SQLite是首版数据范围；模型凭证单独配置，不从其他业务配置复制秘密。

## 4. 第一切片必须先证明的事情

S0只做一个很小的运行时接入实验，使用合成事件和受控延迟工具，暂不读真实桌面。

| 检查 | 通过证据 |
| --- | --- |
| 版本一致 | 固定DSH发行版/commit、Node版本和lockfile，说明与文档差异 |
| sidecar可用 | 新应用宿主启动和关闭runtime，无孤儿进程 |
| 会话连续 | 两次输入属于同一主session；消息ID和实际claimed step可见 |
| 异步子代理 | continuable子任务启动即返回；20秒工具运行期间主代理仍接收修正 |
| 更新与取消 | 修正进入子会话；cancelling之后观察到真正停止 |
| 流式与持久轨迹 | live文本和durable final关联，重连无重复消息 |
| 多模态 | 合成图片能够通过所选adapter进入模型，结果引用正确 |
| 最小proposal | 日程修改只生成提案，返回not_executed，无真实日历访问 |

先检查官方SDK是否已有新扩展点。当前研究快照的SDK不完整暴露steer/inject/cancel；预计需要内置Proactive Bridge。只能复用公开service原子，不通过拷贝内部loop“修”接口。

## 5. 已确认的版本线索

| 项目 | 研究版本/结论 |
| --- | --- |
| DeepSeek Harness | SHA `d347e703908d0406b7a7ef80e3a0e594d86b2215`，2026-09-04；manifest0.1.3-alpha.1；MIT |
| DeskLore当前参考 | SHA `8851346c7e544b6da07372d7a9a5aca9f81317f1`，2026-09-03；Apache-2.0 |
| DeskLore本地旧clone | `/Users/jerry/code/personal/opensource/desklore`，SHA `b5928393700a743bfdbcfa01da78a3b9b1d095ed`；勿当最新 |
| Pi | 当前官方仓库earendil-works/pi；read可独立构造，但DSH已有read，首版无需Pi第二套runtime |
| 感知模型 | 官方存在gemini-3.8-flash，支持图像/structured；thinking不能设置minimal；真实adapter与费用待测 |

参考仓库只用于读取。若确需更新源码学习副本，保持开源参考区与产品项目分离，并先检查已有dirty状态。

## 6. 后续实现顺序

1. S1：真实macOS输入元数据和action ID、截图/AX/OCR关联、SQLite证据内容、简单列表。
2. S2：typing/scroll聚合、AX原始/上下文/差异树、过滤原因和回放标注。
3. S3：事实理解Schema、模型配置、输入manifest、缓存、费用与错误。
4. S4：观察outbox到DSH、主子任务版本、内部真实工具与外部proposal工具。
5. S5：完整因果链、重连/崩溃恢复、清理、预算、本地Webhook与定时事件。
6. S6：打包独立.app，实际启动、权限、停止、回放和验收报告。

每个行为切片实现、必要测试和说明齐备后commit，不按每个文件机械提交，也不等整个项目完成才提交。先验证最高风险链路，避免先写完完整UI再发现runtime不支持。

## 7. 不可省略的数据语义

- 原始action ID在模型调用前产生；多个action可合成activity，但必须能查回原始ID。
- SQLite保存截图BLOB、AX内容、OCR内容，而非只保存临时文件路径。
- 共享、缺失、超时、受保护、过期证据全部有显式状态；时间差和实际窗口身份可见。
- “完整AX”是有预算、coverage明确的采集快照，不是全电脑无限原子树。
- 原始观测与模型上下文分开；被点击/聚焦节点、祖先和关键变化不能因为属于button而删除。
- 摘要缓存绑定完整input_manifest_hash，必须包括动作、上下文、时序、缺失状态，不能只按截图hash。
- 活跃任务/固定评估样本强保留证据；普通历史引用到期置expired后才能释放BLOB，防止TTL永不生效。
- DSH会话日志为Agent历史真源，SQLite只存原始证据和可重建索引，不双写两个可编辑messages[]。
- 跨主子会话回补用Bridge全局投影游标或每session游标映射；不能把单session seq当全局seq。
- native subagent工具返回值与本项目task/revision/message映射分层处理，不假设上游自动产生业务ID。
- 入队、持久flush、模型领取、完成、取消请求、实际停止分别展示。

## 8. 工具与UI要求

最小live能力：观察/证据读取、本地检索、受限文件读取、主子代理派发/消息/更新/取消、attention状态、应用内表达。

首版proposal：calendar create/update/delete、file write/edit、memory write。calendar list/get与Web Search/Fetch可用带标签fixture；无真实provider不能生成看似真实的搜索结果。Web Research是同一个runtime中的子代理preset。

界面默认实时语义流，可切Raw；点击action看Screenshot/AX/OCR/Understanding/Delivery。AX树可展开折叠，raw/context/diff可切换；显示coverage、过滤理由与目标高亮。

主Agent与子任务卡片有完整关联；模型可见文字、tool参数与结果可展开。不要伪造隐藏思维链；对用户意图的猜测必须标推测。用户滚动查看历史时暂停自动跟随，但继续采集。

## 9. 验收与报告

完整验收见PRD第17节的30类场景和至少40条初始样本。必须包含：Space播放、Enter换行/发送、IME、重复点击、scroll、多屏、AX空壳/超时、调试窗口自我排除、旧任务结果晚到、重启去重和SQLite证据独立回看。

最终交付报告按“源码存在 / 本机运行 / 样本通过 / 真实外部连接”分开陈述。给出真实失败列表、性能和模型用量，不把PRD里的目标数值抄成测试结果。

如DSH接入失败，先写清具体版本、接口和失败证据，尝试局部bridge适配。确实不满足再提出单runtime替代ADR，不同时保留DSH、Pi、ToolLoopAgent三套主循环。
