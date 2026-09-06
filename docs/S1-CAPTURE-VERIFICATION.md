# S1/S2 采集与证据切片验证

本切片是原生采集 spike 与本地证据存储，不代表 PRD CAP-01/02 全部验收。下文保留当时的验证记录。后续已补齐“所有应用”和显式系统授权入口，当前行为见 [初始化与观察授权](SETUP-DEFAULTS.md)。采集默认关闭，启动仍要求三项 preflight 均通过。

已实现：Swift listen-only CGEventTap 的 down/up、拖拽、普通键类别（无字符）、修饰键、scroll phase/momentum；应用激活事件；有预算的 AX 树和预算外命中节点；仅截取允许前台进程的一个可见窗口，使用 ScreenCaptureKit PNG 与 Vision OCR；NDJSON 独立时间戳。AX 发现安全节点时整组证据排除。高负载原始元数据保留，重证据显示 dropped_by_backpressure。

Node 22 `node:sqlite` 单 owner 使用 WAL；截图实际 BLOB、AX/OCR JSON、hash 去重、每 action 三项状态、epoch/sequence 唯一、activity 归组、revision 历史、事务 outbox、TTL/体积预算及 pin/unpin。上下文过滤保留目标/焦点/变化节点及祖先，受保护后代不依赖输入顺序。

验证：`swift build --package-path native/collector` 成功；Bun 测试调用独立 Node 22 worker，临时 SQLite 验证 BLOB 读取、三类证据、OCR 来源约束、typing down/up 归组、共享证据与 TTL、pin/unpin、目标及祖先保留、乱序受保护后代。测试未访问任何既有数据库。

明确未完成/未实测：真实输入监听权限、输入法/多屏/坐标对齐；AXObserver、窗口和系统通知；before 帧缓存；精准焦点窗口选择（当前为进程第一个 on-screen window，metadata 明确标记，overlay 禁用）；完整属性级 AX 错误覆盖；恢复 outbox 投递、固定评估40样本、真实性能测试与模型理解。Swift 使用 Swift5 language mode 构建，存在 Sendable 警告，不能宣称并发隔离已完整验收。实际仅运行 permissions 命令，三项 preflight 为 true；request_id 匹配 ack 后 shutdown 并等待子进程 exit 成功。未发送 start，未启动真实屏幕或键盘采集。

接口：`src/observation/types.ts` 为公共类型；`store.ts` 导出 EvidenceStore；`native-host.ts` 导出 NativeCollectorHost。Host onEvent 传递 NDJSON 原始对象（type=action 含 action，type=artifact 含 action_id/kind/status），只用于触发 UI 刷新，历史证据从 Store 读取。图片由 getArtifact 按需返回 base64 PNG；AX 为 payload.content.nodes 扁平有序树，过滤投影位于 payload.content.context。


## 后续窗口与槽位补强

已补：AXFocusedWindow bounds 与 ScreenCaptureKit 窗口匹配必须唯一，捕获前后重新确认前台与焦点窗口；不匹配返回 unavailable。AXObserver 为当前允许应用订阅焦点/窗口/title/value/selection，逐项发出实际订阅错误码；NSWorkspace sleep/wake/session 切换作为系统事件，非活跃会话暂停重证据。OCR失败不覆盖成功截图。

新增 screenshot_before 独立槽位，默认三槽位向后兼容，SQLite user_version=2 迁移保留旧数据。只共享两秒内、同进程、精确窗口 bounds 一致的内存缓存截图，保留真实 capturedAt/window_id/source_action_id；无匹配则 unavailable。该缓存不是连续屏幕环，窗口在AX查询前已关闭时仍可能没有可证明对应的before，不能宣称覆盖E02。

Collector跨线程共享缓存以NSLock保护，其他可变控制状态仅主线程访问；以明确不变量声明unchecked Sendable，最新构建无warning，不代表竞态压力测试完成。新增before/after独立关联、旧schema迁移以及重开库测试通过。上述原生扩展仅编译验证，未发送start。
