# 桌面与模型接入切片

日期：2026-09-06。本轮建立可启动的 Electron / React 调试应用和模型适配，不代表所有 PRD 验收已完成。

## 启动与打包

- `bun install --frozen-lockfile` 安装固定依赖。
- `bun run desktop` 先编译 Swift 采集器与 JS，再启动独立应用。
- `bun run package:mac` 生成 `out/Proactive Lab-darwin-arm64/Proactive Lab.app`。
- `PROACTIVE_DATA_DIR` 可设置专用验收数据目录；默认是 `~/Library/Application Support/Proactive Lab`。
- 新应用 bundle ID 为 `io.github.hedgeho9x.proactive-agent`，默认采集关闭，允许列表为空。

Electron 锁定 44.1.1，本机包内 Node 24.19.0，实际确认 `node:sqlite.DatabaseSync` 可用。44.2.0 下载受网络阻塞，改用本机已有的官方 44.1.1 缓存，旧下载进程已按精确 PID 停止。

应用使用自身 Electron 可执行文件和 `ELECTRON_RUN_AS_NODE=1` 运行编译后的 `dist/sidecar.mjs`；不依赖系统 Node，不再使用 S0 的 experimental TS transform。Swift 二进制经普通文件复制到 `dist/native/ProactiveCollector`，避免 .build/debug 符号链接在打包后悬空。

## 界面

- Raw / 活动 / Agent / 混合实时流，80ms 固定刷新窗口；滚动离开底部会停止自动跟随，继续记录。
- Action 详情展示时序、证据状态及 screenshot_after / screenshot_before 各自关联。
- AX 树可展开折叠，Raw / Context 实际切换不同节点集，目标/焦点高亮，coverage 与过滤原因可见。
- OCR、事实理解、完整事件详情和工具参数/结果可查看。
- 主代理/子代理的 live 与 final 使用同一行，按 session/seq 去重回补；任务卡片支持修正和取消，显示真实 idle/stopped。
- 运行时重启后旧内存任务标 interrupted；持久会话只读回放，不宣称旧任务自动继续。
- 模型状态区分 unavailable、configured_unverified、connected、last_request_failed；无 Key 不发真实请求。

## Gemini 与事实理解

直接使用官方 `@google/genai` 2.21.0 的 `models.generateContent/Stream`。参考 [GenerateContent API](https://ai.google.dev/api/generate-content)、[Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)、[Function calling](https://ai.google.dev/gemini-api/docs/function-calling)。默认模型字段为 gemini-3.8-flash，可编辑；配置成功不代表上游模型已验证。

Key 从界面经父子私有 IPC 传给 runtime，仅存在当前进程内存，不写文件、不放命令行参数、不读旧应用凭证。真实 GeminiAdapter 实现 DSH LlmAdapter，继续只有 DSH 一个 Agent loop。原生 Part/thoughtSignature 保存在 DSH opaque replay 中，工具 ID 旁路映射，不修改原生 Part；UI 不显示 opaque replay 数据。可见输出和 tool calls 被转成真实 DSH StreamChunk，输入、输出和缓存 token 有独立计数，美元费用未配置所以显示未知。

事实理解是无 Agent loop 的单次结构化模型调用：一句事实陈述、证据 action 引用、不确定性、单独的意图假设。指令在 systemInstruction，屏幕内容当作不可信数据。Raw/Context 会实际裁剪输入 AX，避免 raw/context/normalized 重复发送；首版只发送 After 截图。

理解缓存当前为本应用目录内 JSON 文件，尚未整合进 SQLite。缓存键含模型、prompt/schema版本、action、时序、证据状态、选定AX/OCR内容和图片 hash。文本缓存按 24h TTL 在启动和定时清理，与证据默认 TTL 一致；容量驱逐后的旧文件最多保留至该 TTL，不会用旧键覆盖缺失证据状态。固定微批最多6次/分钟，普通逐键输入不自动调用，special Space/Enter保留资格。自动理解显式开启；fixture模式强制关闭自动真实理解。

## 原子与边界

- 真实内部工具：read_observation 通过父进程只读桥接证据；read_file 只读明确选定目录，realpath 校验阻止路径/符号链接逃逸，最大128KB。
- 外部写工具 calendar_create/update/delete、file_write/edit、memory_write 仅生成 not_executed 提案。
- calendar_list/get、web_search/fetch 无provider时返回 unavailable，不造结果。
- 主代理通过 continuable delegate 委派；live模式必须提供子任务prompt，不注册合成延迟工具。
- live每个runtime实例最多30次模型调用；完整持久预算、Webhook、跨重启任务索引、全量子会话冷恢复仍是后续S4/S5工作。

## 已执行验证

1. typecheck 与 build 成功。
2. S0 的编译JS回归3项31断言通过，含真实20秒子代理并发和取消。
3. 模型/投影4项19断言通过：实际Raw/Context投影、完整manifest失效、mock Gemini工具多轮Part保真、live/final去重、受限文件读取。
4. `.app` 内自身Node运行包内DSH sidecar，ready → 合成assistant → flush → exit成功。
5. `.app` 内原生二进制存在且可执行；permissions-only三项true，shutdown exit0。此项没有启动采集。
6. 真实视觉准确率、真实Gemini凭证/费用、系统签名/公证、全部PRD交互场景尚未验证。UI与真实采集的人工验收由主Agent另行记录。

最终自动检查：`bun run typecheck`、`bun run format:check`、`bun run test`、`bun run package:mac` 全部成功。全仓 8 tests / 52 assertions / 22.07 秒。最终包额外以包内 Node 跑了一次带有效 PNG 的 DSH 请求并正常退出。真实模型请求数为 0；人工桌面交互与真实捕获结果由主Agent独立补充，本文不将其记为已通过。

## GUI 启动修复与人工复核

主Agent首次实际GUI启动发现进程存活但无窗口、无CDP端口、无数据目录；采样停在ElectronMain/Node事件循环。原因是Electron的ESM入口在模块求值完成前不进入ready，本入口顶层 `await app.whenReady()` 形成循环。改为同步注册 `app.whenReady().then(bootstrap)`，after-ready初始化全部进入异步bootstrap，增加阶段日志和启动失败归因。参考 [Electron ESM lifecycle](https://www.electronjs.org/docs/latest/tutorial/esm)。

无GUI回归通过：使用真实编译入口和SourceTextModule，保持mock ready永久pending，入口仍须完成求值，避免相同死锁。主Agent随后实际启动确认 bootstrap:ready / window-loaded、9337 file页面和Fixture主子轨迹，截图布局正常。此验证与前面的Node模式验证分别记录。

## 已退休子代理的续聊修复

主Agent在真实UI中发现：子代理完成并retire后发送修正，DSH提示缺少session query。S0只覆盖了运行中的steering，不能证明冷恢复。现挂载同版本 `dsh-session-query-sqlite`（`openAt: never`），仅启用公开的exact-read/cold-resume，不打开全文索引数据库。新增真实 `agent.disposed` 后续聊回归，确认同一child ID恢复并生成 revision 2 / Friday / not_executed 提案；再次retire后的取消返回stopped且不重执行工具。入队失败同时回滚revision/target，不能UI报错却悄悄修改版本。两项针对性测试6断言通过。这仍不代表应用重启后业务task map已恢复。
