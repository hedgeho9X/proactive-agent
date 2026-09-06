# Proactive Lab 协作规则

- 本项目是独立 macOS 主动式实验应用；需求与验收以 docs/PRD.md 为准。
- 使用 Bun 与 bun.lock；DSH sidecar 可以使用其支持的 Node 运行时。
- 优先复用 DeepSeek Harness 同一套原子，只保留一个 Agent loop；先完成 S0 接入验证。
- 首版业务写工具只生成 proposal，返回 not_executed，不写真实日历、业务文件或外部记忆。
- 文档与代码注释用中文，标识符和协议字段保持英文。
- 每个独立可验证行为切片完成实现、测试、说明后提交。
- 不读取旧应用用户数据，不改现有业务仓库，不执行 Supabase CLI、Management API、数据库直连或等价绕过。
- 不复制其他应用凭证。实时模型测试使用本应用显式配置；未配置时报告 unavailable，不能用 fixture 冒充真实模型。
- 对编排/回放测试可使用明确标记的 deterministic fixture；采集与模型实测分开报告。
