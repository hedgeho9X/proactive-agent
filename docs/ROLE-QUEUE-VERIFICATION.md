# 三角色模型与逐动作队列

此切片按用户最新要求取代旧版单Gemini配置和latest扫描自动理解。

## IPC契约

- `config`：`{role:'understanding'|'main'|'subagent',config:{protocol:'gemini'|'openai-compatible',baseUrl,model,apiKey?,maxCalls?}}`。只改指定角色；省略apiKey保留当前值，空串清除。模型ID不使用Gemini正则。
- `snapshot.modelRoles`：每角色返回protocol/baseUrl/model/maxCalls/hasKey/status，不返回key。非secret设置保存在本应用model-roles.json；key只存在内存，重启需重新输入。未实现safeStorage保存，不暗中复制旧应用凭证。
- `snapshot.queue`：按单调seq返回actionId/status/reason/attempts/createdAt。
- `retry {actionId}`：failed项回queued；若已有成功理解结果则回ready，不重复模型调用。
- 人工Prompt可直接进主Agent；桌面动作必须先完成理解，随后投递DSH。

## 角色与协议

Gemini使用官方SDK的httpOptions.baseUrl，OpenAI-compatible使用指定baseUrl追加/chat/completions。两者支持图片、工具、取消和流式输出；没有引入第二Agent loop。DSH主会话provider为main-role；子代理agentOptions明确使用subagent-role和独立模型，不继承main。缺子代理配置时delegate明确失败。

事实理解单独使用understanding角色和结构化输出。缓存manifest含protocol/baseUrl/model，切换角色endpoint不会误命中旧模型缓存。OpenAI兼容端点需要支持chat completions及json_schema结构化输出；不支持时明确failed，可修改配置后重试，不悄悄降级为无验证自由文本。

## 顺序和失败语义

action-queue.sqlite独立持久队列，以原始动作到达顺序分配seq，actionId唯一去重。状态依次queued→understanding→ready→delivered；普通typing及采集策略excluded保留filtered原因。缺配置不抛弃动作：缺理解配置停queued，缺main配置可继续理解后停ready。

理解串行，忙碌时新action继续入库，不扫描latest、不限最近20/200条。启动从本应用原始SQLite动作账本补缺失队列项；重启的understanding回queued，ready结果保留。投递使用稳定understood:actionId，DSH侧消息ID去重。单项失败置failed形成可见gap，后项继续；用户retry该项时使用原seq重新进入候选，因此不会伪称全局严格完成顺序。失败理解绝不进入Agent；投递失败可重试已持久ready结果。

当前队列与理解结果未做新TTL清理，这是新的持久状态域，后续需统一保留策略；不宣称完整S5已交付。

## 验证与退出

- 配置独立、任意model ID、snapshot和磁盘无key。
- mock OpenAI SSE跨chunk、图像、工具、HTTP错误及AbortSignal透传。
- 25个动作在忙碌时全部入库，中间失败显式gap，后续不丢；retry及重启ready保留。
- 真实DSH与本地mock HTTP证明main/subagent分别使用不同baseURL/model/key。
- 窗口已销毁后send有guard；关闭collector/queue/runtime/store以嵌套finally清理，35秒总截止避免孤儿主进程。真实GUI退出由主Agent复核。

本轮没有真实付费模型调用，也未读取旧应用secret。

补充验收：缺理解配置的早seq queued不会阻塞后面的ready投递；主模型缺失时理解可继续完成并持久ready。snapshot.actions提供轻量理解result，详情从持久queue结果回填。模型变更进入transitioning并禁用投递直到ready，理解结果保留角色和非secret协议/地址/模型。Native实际键类别Space/Enter为special已核对；采集退出原生Host会interruptPending，队列另有15秒证据等待失败与定时唤醒。OpenAI EOF没有终止标记时failed，length为max-tokens，content_filter明确拒绝，不伪称正常完成。

针对性结果：角色/队列5 tests通过，其中真实DSH分别路由main与child到不同本地mock endpoint/model/key。既有runtime回归5项也通过，包含20秒并发与冷恢复。Typecheck通过。新界面/打包由UI Agent统一构建，真实付费连接尚未验证。
