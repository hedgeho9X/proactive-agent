# 紧凑时间线与三角色模型验收

日期：2026-09-06。基于当前分支246052c与之前提交；保留中断期间新增的AX观测台、连接测试和默认配置。

## 已实现

- 正式shadcn/ui + Tailwind组件；事件行实际高度36px，月日/时分秒毫秒、一行摘要与状态。
- 选中后打开右侧非模态Sheet，没有全屏遮罩；侧栏打开时可直接点击背景其他事件切换。
- 子代理默认折叠，展开显示其输入、模型输出与工具轨迹。系统上下文和任务结尾用短中文摘要，完整原文在详情保留。
- 屏幕理解、主Agent、Sub-agent分别配置protocol、Base URL、Model ID、API Key；主子代理沿用唯一DSH runtime。
- 动作逐条持久排队，理解成功后才投递；失败保持明确状态，支持重试。

## 实际界面验收

使用独立数据目录/private/tmp/proactive-ui-complete-qa及本机127.0.0.1:9349模拟模型服务，只有3条明确标记的合成Action；未启用真实键鼠采集，未调用付费服务。

通过真实Electron页面操作三组设置，分别保存screen-local-qa、main-local-qa、child-local-qa及三个独立本地路径。未配置主Agent时三条动作均完成理解并处于ready；配置主Agent后全部变为delivered。服务端观察到3次screen请求，以及分别发送到main/child路径的独立模型请求。截图/AX/OCR来自合成SQLite证据；这证明关联与展示，不代表真实视觉准确率。

实际确认：

1. DOM测量前三条事件行均为36px。
2. 非模态Sheet的overlay数量为0；点击背景另一action可更换详情。
3. AX树可展开，点击目标及其祖先保留；Raw/Context和图像/OCR可切换。
4. SQLite图片在详情中成功解码，原始证据与当前action关联。
5. Sub-agent父行可以展开/折叠，不在主流重复平铺内部步骤。
6. 失败项通过界面重试后恢复delivered，原动作只有一条DSH消息，没有新增屏幕理解请求。
7. 窗口关闭后测试进程与sidecar退出；未停止其他任务的应用实例。

## 联调发现并修复

真实UI联调捕获到子代理快速退休与主消息flush竞争：主消息已入队，但全量flush使用已退休child导致错误回执。d8b361c将主消息回执限定为owner session持久化，重复投递重试再次flush确保durable；全量flush按当前session身份检查。最终三动作重跑没有误报失败。

## 自动验证

最终bun run build成功，包含Swift和Tailwind；36 tests / 170 assertions / 0 failures。typecheck与format:check通过。新增测试覆盖独立模型路由、25条繁忙期间动作、失败gap与retry、SSE中断、child退休flush竞争、非重复持久回执、UI短摘要及原文保留。

真实Provider连通性和真实屏幕理解质量仍需要用户在设置中提供自己的API配置后验证。API Key当前仅本次进程内存保存；磁盘保存非secret模型配置。AX观测台中用户另行执行的采集不属于本次合成验收。

## 隔离验收入口

PROACTIVE_QA_HIDDEN=1可在自动验收时隐藏窗口；正常启动不设置该变量，窗口照常显示。PROACTIVE_DATA_DIR可指定独立测试目录，避免影响用户正在使用的实例。
