# Prompt 管理

本目录是本项目模型可见静态提示词的源码入口。角色文件使用 JSON 字符串数组，每个元素是一行；辅助模板与工具说明按语义键管理。

- `understanding.json`：屏幕动作事实理解 System Prompt。
- `main.json`：主 Agent System Prompt。
- `subagent.json`：子 Agent 职责提示。
- `messages.json`：动作提示、理解任务、子任务包装、工具图片说明和连接测试提示。变量使用 `{{name}}`，仅单次替换，不递归解析用户文本。
- `tools.json`：本项目注册的工具描述。工具名、参数 Schema 和执行逻辑仍由 TypeScript 管理。

修改后执行 `bun run desktop` 重新构建并启动。资源由静态导入打包进入桌面主进程及 sidecar，不依赖启动目录或运行时读取源码文件。

设置中保存的角色 Prompt 位于本应用用户数据目录的 `prompts.json`，优先于仓库默认文件。本次不覆盖既有设置。要让已自定义的角色使用新的正文，可把对应文件正文复制到设置中保存。其他模板和工具说明使用构建中的资源。

历史追踪保存当时实际使用的正文，不因修改默认文件变化。用户输入、截图、AX、OCR、工具结果属于动态数据，不写入本目录。

第三方 DeepSeek Harness 内置的身份说明和协议提示仍由依赖管理，不修改 node_modules，也不把这些不可编辑内容伪装成这里的模板。Fixture 的模拟响应不是生产 Prompt。
