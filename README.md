# Proactive Agent

把桌面操作转成可追溯的行为轨迹，让 Agent 按需取证、理解上下文并提出建议。

macOS 实验项目，基于 Electron、Swift、Vercel AI SDK 和 DeepSeek Harness。

## 功能

- 采集窗口截图、AX（辅助功能树）和输入活动，保留原始证据。
- 将操作理解为 Action title / detail；编辑过程持续记录，不逐条触发理解。
- 查看实际模型输入、标注截图和 Agent Trace，追踪工具调用与错误。
- 主 Agent 接收行为轨迹、按 ID 查看证据，通过桌面弹幕提出建议。

## 快速开始

需要 **macOS 15+**、**Bun 1.3.14+** 和 **Xcode Command Line Tools / Swift**。

```bash
git clone https://github.com/hedgeho9X/proactive-agent.git # 获取源码
cd proactive-agent # 进入项目
bun install --frozen-lockfile # 安装依赖
bun run desktop # 构建并启动
```

在设置中配置屏幕理解模型的 **Base URL、Model ID、API Key**，支持 OpenAI-compatible 和 Gemini。使用主动式建议或子任务时，再配置主 Agent / Sub-agent；Web 搜索可选配 Tavily Key。

按提示授予 macOS **辅助功能、输入监控、屏幕录制**权限，然后点击「开始观察」。

## 开发

```bash
bun run typecheck # 类型检查
bun run test # 构建运行时并执行测试
bun run demo # 无真实采集和模型调用的演示
bun run package:mac # 打包 macOS 应用
```

中文 Prompt 集中在 [prompts/](prompts/README.md)，可以独立修改。

## 数据与边界

采集默认关闭。本地记录保存在 `~/Library/Application Support/Proactive Agent`；API Key 使用系统凭据能力加密保存，截图、AX 和草稿记录并非加密资料库。启用 AI 理解后，相关文字和图片会发送给你配置的模型服务。

当前仍是原型：AX 和截图可用性取决于目标应用，自动确认发送成功、跨应用行为归并尚未完成。敏感控件过滤不能保证覆盖所有隐私内容，请勿在处理敏感信息时开启观察，也不要上传未经脱敏的记录。详见 [安全说明](SECURITY.md)。

## 文档

[理解与取证](docs/AGENTIC-UNDERSTANDING.md) · [编辑会话](docs/EDITING-SESSIONS.md) · [Trace 调试](docs/UNDERSTANDING-TRACE.md) · [设计与范围](docs/PRD.md)

## 许可证

[Apache-2.0](LICENSE)
