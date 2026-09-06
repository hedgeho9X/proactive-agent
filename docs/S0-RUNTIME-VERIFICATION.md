# S0：固定 DSH 原子的真实运行时验证

日期：2026-09-06。本切片是接入实验，不是完整 Proactive 应用。

## 版本和证据边界

本机 Bun 1.3.14、Node 22.23.1。npm 实查 `@deepseek-ai/dsh` latest 为 `0.1.2-rc.1`；版本列表没有研究快照 `0.1.3-alpha.1`。因此依照真实发行版适配，所有直接 DSH 原子固定 `0.1.2-rc.1`，Cordis 固定 `4.0.2`，依赖由 `bun.lock` 锁定。没有使用旧 npm SDK client（latest `0.0.1-rc.1`），没有下载研究 SHA 后自行发布包，也没有使用私有深层 import。

安装时先验证了全量 dsh CLI，最终移除它，只直接依赖应用需要的原子。没有加载默认 profile、Bash、真实日历或文件写工具，没有读取旧应用 secrets。模型固定为显式 `fixture/deterministic-v1`，不执行网络请求；真实模型状态始终 `unavailable`。

当前 sidecar 使用 Node 的 experimental TypeScript transform；这是 S0 可运行实验入口，正式打包应改为编译后 JS 并锁定随应用交付的 Node 版本。不能把本机命令成功等同于已打包 .app。

## 实际使用的公开能力

| 能力 | 已安装发行版公开入口 |
| --- | --- |
| 容器组合 | `@deepseek-ai/cordis` 的 `Context`、await `ctx.plugin(...)`、`ctx.fiber.dispose()` |
| 主循环 | `dsh-agent-loop` 默认插件；只有这一套 loop |
| 会话 | `dsh-agent` 的 `ctx.agents.create/resume/get/list`、`AgentHandle.dispose` |
| 收件箱 | `Agent.followup`、具有稳定 `MessageId` 的消息、原生 inbox events |
| 子代理 | `dsh-subagent` 的 `startContinuable/sendMessage/interrupt`、`dsh-subagent-spawn-in-process` |
| 模型 | `dsh-llm` 的 `LlmAdapter`、`registerAdapter`、真实 `StreamChunk` |
| 工具 | `dsh-tools` 的 `ctx.tools.register`、严格输入与输出 Schema、真实 tool call/result |
| 持久化 | `dsh-session-persistence-jsonl`、`ctx.sessions.flush` |
| 多模态 | `dsh-attachment-local` 的持久图片存储及 adapter 中 `readImage` |
| 回放 | `Session.snapshotEvents`、每 session seq 游标 |

研究文档提及的 `agent/assistant-stream` 不是此发行版接入契约。本包中 live chunks 直接由 `session/event` 内 `assistant/chunk` 发布，其后有 `assistant/message` 和 `sourceEventSeqs`。实时 append 不代表磁盘已 flush，bridge 另发 `session.flushed` 水位；两者明确分开。

## 进程和数据所有权

`RuntimeHost` 创建一个 Node 子进程，使用父子私有 IPC，没有 HTTP 监听端口。`sidecar.ts` 拒绝无父进程 IPC 启动。宿主只有收到 ready 握手后才发送请求；Cordis 原子逐个 await 安装，没有固定 sleep 猜测就绪。

固定内置 `proactive-bridge` 声明依赖并注册 tools 和 fixture adapter。主会话与所有 continuable 子会话由 DSH 维护；宿主没有第二份可编辑 messages 数组。私有目录由调用方明确指定，JSONL 会话和附件均在该目录内。没有在 S0 引入 SQLite；真实桌面证据存储属于 S1。

关闭先释放主 Agent handle，DSH 负责其子代理树停止与会话持久化，再销毁根 fiber。IPC 断开也触发关闭。宿主等待 exit，超时仅终止自己拥有的子进程，不按进程名清理其他应用。

## 验收覆盖

自动测试使用真实 Node sidecar 和真实 DSH loop，fixture 只替代上游模型响应，不替代 loop、工具执行、收件箱或持久层。

- 主代理收到两条不同 action ID，两条消息进入同一主 session。
- 主代理通过真实 tool call 启动 continuable 子代理，得到 child ID 和初始 message ID。
- 子代理执行 20 秒受控工具时，主代理仍在 5 秒阈值内处理第二观察；此时延迟工具未完成。
- 修正通过 `sendMessage` 在工具结束后的下一 step 被实际模型请求领取。子代理只产生 revision 2 / Friday / not_executed 提案。
- 旧 revision 再次请求提案被拒绝，提案数量不增长。
- 第二个延迟任务取消时先发 cancelling；工具收到 AbortSignal 并结束，`whenIdle` 后才发 stopped。取消用时要求小于 3 秒。
- 原生 live text chunks、最终 assistant message、step/start 和 tool/result 关联存在。
- 每 session 游标回补后再次读取为空；不会把不同 session 的 seq 混成全局 seq。
- 完整关闭后重新启动，恢复主 JSONL 会话；同 action ID 不重复投递，新 action 正常处理。
- 正文包含 `action:future` 不会使未来 action 被误判重复；去重只读取原生消息 ID 和 inbox inserted IDs。
- 合成 1×1 PNG 经真实附件写入与校验，模型 adapter 读取到原始字节及对应 message ID。此项只证明多模态通道，不证明视觉理解正确。
- strict proposal Schema 拒绝 executed 状态、缺失字段与额外字段。

执行 `bun run typecheck`、`bun run format:check`、`bun test`。用 `bun run demo` 可查看只含合成状态的短演示；示例子工具缩短到 2 秒，测试仍使用 20 秒。

## 已知边界与下一切片

1. `tasks` 的 revision/status 映射与 `proposals` 索引目前在内存。提案工具结果存在于 DSH JSONL，但本切片没有重建业务索引，没有验证崩溃后进行中任务恢复或 child 冷恢复。不能据主会话恢复宣称 S4/S5 完成。
2. live event feed 与 `events` 当前只包含已激活 session；没有提供跨重启所有历史子会话目录浏览。S5 需要 persistence catalog 回补。
3. fixture 请求包含调试用合成 messages 和 tool schemas；不得直接当作真实观测的默认外部日志通道。后续 UI 需在本机明确展示，不外发。
4. 本轮没有真实键鼠采集、AX、OCR、截图、过滤、SQLite、UI 或付费模型测试。没有真实外部工具副作用。
5. 首版仅 `calendar.update` proposal 用于证明契约；其余业务工具 Schema 按 PRD 在 S4 实施。
6. 该实验使用协作式取消；若工具不响应 AbortSignal，DSH 无法魔法终止同进程函数。实际执行者必须遵守信号和版本检查契约。

## 调试过程中修正的适配事实

- Cordis 4 没有旧式 `ctx.start/stop`；使用 await plugin 与 root fiber disposal。
- plugin 中获取服务必须显式声明 inject，不能因 root 已装服务而省略。
- DSH 自动加入 subagent runtime-context snapshot；模型 fixture 不能只取数组最后一条就当作用户任务。
- 跨代理 relay 会增加来源说明文本块，任务 JSON 仍是独立内容块，不能直接把所有文本拼成 JSON。
- 第一份测试 PNG 数据无效，真实附件边界正确拒绝；修正为合法 CRC 的测试图片后通过。

## 最终本机执行记录

- `bun install --frozen-lockfile`：成功，113 packages，无变更。
- `bun run typecheck`：成功。
- `bun run format:check`：成功。
- `bun test`：3 pass、0 fail、31 assertions，总计 20.69 秒；其中 20 秒主子任务场景 20.41 秒。
- `bun run demo`：成功，产生 Friday / revision 2 / not_executed 提案，sidecar 正常退出。
- 真实模型请求数：0。真实原生桌面样本数：0。
