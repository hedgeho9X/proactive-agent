# Proactive Lab

独立 macOS 主动式 Agent 实验应用：原生动作与证据采集、React 调试工作台、DSH 主子代理，以及可配置的 Gemini 事实理解。默认采集关闭，无模型凭证时显示 unavailable；Fixture 演示不调用真实模型。

使用 Bun 1.3.14+、macOS Swift 工具链。安装执行 `bun install --frozen-lockfile`；`bun run desktop` 编译并启动；`bun run package:mac` 生成独立 `.app`。桌面使用 Electron 自身的 Node 运行编译JS sidecar，不依赖用户机器上的系统 Node。

`bun run typecheck`、`bun run format:check`、`bun run test` 验证代码。运行时测试包含真正20秒后台子任务。`bun run demo` 是无桌面采集、无真实模型的短命令行演示。

API Key 仅保留在本次进程内存；本应用不读取旧应用配置。文件工具只读取用户选定目录，所有外部写工具仅生成 not_executed 提案。Web / 日程读取 provider 尚未配置。跨重启任务业务索引、正式签名、公证及完整PRD验收仍未完成。

- [需求](docs/PRD.md)
- [实施进度](docs/IMPLEMENTATION-STATUS.md)
- [S0 验证](docs/S0-RUNTIME-VERIFICATION.md)
- [桌面与模型验证](docs/DESKTOP-MODEL-VERIFICATION.md)
- [原生采集验证](docs/S1-CAPTURE-VERIFICATION.md)
