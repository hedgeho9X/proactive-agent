# Proactive Lab

独立的 macOS 主动式 Agent 实验应用。当前完成 S0：真正 DSH 原子组成的 Node sidecar、连续主会话、可继续子代理、修正与取消、仅提案工具、JSONL 历史和合成图片通道。原生采集和 UI 尚未实现。

使用 Bun 1.3.14+ 安装依赖，sidecar 需要 Node 22.19+ 或 Node 24+。执行 `bun install --frozen-lockfile`、`bun run typecheck`、`bun test`；`bun run demo` 启动无付费模型的短演示。测试包含真实 20 秒延迟子任务，通常约 21 秒完成。

所有模型响应明确标为 deterministic fixture，不能理解真实屏幕。没有真实模型凭证配置；不读取旧应用配置或用户数据。演示的会话和附件位于本项目忽略的 `.runtime` 目录。

- [需求](docs/PRD.md)
- [实施进度](docs/IMPLEMENTATION-STATUS.md)
- [S0 验证与已知边界](docs/S0-RUNTIME-VERIFICATION.md)
- [下一切片交接](docs/IMPLEMENTATION-HANDOFF.md)
