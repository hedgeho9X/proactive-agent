# Prompt 管理

本目录是本项目模型可见提示词的源码入口。静态 Prompt 使用反引号多行字符串；动态 Prompt 使用带类型参数的函数及 `${变量}` 插值，不使用通用字符串模板解析器。插入的用户文本不会作为代码执行。

- `understanding.ts`：`systemPrompt` 保存事实理解规则；`buildUserPrompt` 是实际发送的完整中文正文，集中注入 action、app_info、evidence、axTree、focusTitle、ocr、screenshot、view。图片字节由调用方单独附加。
- `main.ts`：`systemPrompt` 保存主 Agent 规则；`buildUserPrompt({ trajectory, app_info })` 生成本批观察和按 Action ID 关联的应用背景。历史消息和工具结果仍由 DSH 管理，不在模板里重复拼接。
- `subagent.ts`：`systemPrompt` 保存子 Agent 职责；`buildUserPrompt({ system, task, taskId, revision, target })` 生成完整委派消息。system 可接收用户设置的覆盖内容。
- `messages.ts`：仅保留连接测试和工具返回图片的辅助说明，不拆分角色请求的正文。
- `tools.ts`：本项目注册的工具描述。工具名、参数 Schema 和执行逻辑仍由业务模块管理。

屏幕理解的规则与输入使用 XML 标签区分来源；动态变量通过 `xmlData` 转义后注入，不重复传入原始 AX 属性树。硬件事件和定位信息保留，输出描述聚焦操作对象。详见 [XML 请求边界](../docs/UNDERSTANDING-XML.md)。

修改后执行 `bun run desktop` 重新构建并启动。资源由静态导入打包进入桌面主进程及 sidecar，不依赖启动目录或运行时读取源码文件。

设置中保存的角色 Prompt 位于本应用用户数据目录的 `prompts.json`，优先于仓库默认文件。本次不覆盖既有设置。要让已自定义的角色使用新的正文，可把对应文件正文复制到设置中保存。其他模板和工具说明使用构建中的资源。

历史追踪保存当时实际使用的正文，不因修改默认文件变化。用户输入、截图、AX、OCR、工具结果属于动态数据，不写入本目录。

屏幕理解缓存包含最终渲染后的 User Prompt，修改模板会影响后续请求的缓存键。追踪同时保存模板变量 `promptInput`，OCR 工具从独立变量取证，不从中文排版反解析数据；旧 JSON 输入记录仍兼容。设置编辑器目前覆盖角色规则，不覆盖源码里的 User Prompt 模板。

第三方 DeepSeek Harness 内置的身份说明和协议提示仍由依赖管理，不修改 node_modules，也不把这些不可编辑内容伪装成这里的模板。Fixture 的模拟响应不是生产 Prompt。

应用知识维护在 `src/model/app-info.ts`，仅提供匹配应用的用途和常见功能，不替代硬件事件或具体画面证据。未知应用明确标记，主 Agent 使用理解当时的背景快照。详见 [应用背景边界](../docs/APP-INFO.md)。
