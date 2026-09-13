# Agentic Understanding

理解层仅为当前动作按需补充证据，不执行用户任务、不发弹幕、不操作桌面。主 Agent 继续负责主动帮助判断。

证据服务 `EvidenceSession` 从宿主提供的本地索引建立当前动作的可见集合。历史按动作时间和同会话序号约束，模型无法通过传参读取未来 ID。同应用近十条与全局近十条仅包含标题并去重，不等待未完成的理解任务。

`WebResearch` 通过 Tavily Search/Extract 搜索来源和提取正文。`focus` 是提取关注点，不是 AX 焦点。服务限定返回体积、超时和 HTTPS 公网目标；Key 未配置时不发请求。网页只能说明公开背景，不能证明用户当时看过其中的内容。

## 数据链路

过去每条动作只带当前截图与文字调用一次模型。现在桌面宿主从 AX 元数据和队列摘要建立 EvidenceSession，预载全局十条及同应用十条标题（去重），再将只读工具注册到现有 AI SDK `generateText` 循环。模型可直接输出，也可取证后继续输出结构化 title/detail。每条动作独立，不共用主 Agent 会话。

工具包括 `list_actions`（应用 Bundle ID、窗口 ID、时间下界和分页）、`get_action_detail`、`get_action_image`、`get_action_ax`、`get_action_ocr`、`get_app_info`。图像工具返回图片内容块，保留采集时间及原图／当前标注图来源。未知或未来动作被拒绝；工具失败作为显式错误结果交给模型。Web 工具仅在配置 Key 后声明。

每次理解最多四个模型步骤、八次工具调用、两张额外图片，整次请求的取消预算为 60 秒；第四步禁止继续调用工具。没有有效结构化输出仍记为失败，不伪装成已理解。有限步数不保证供应商一定完成请求，错误和取消需从追踪检查。

`prompts/agentic-understanding.ts` 是此阶段的职责说明：输出供下游先读 500–600 条标题，标题应独立保留主题、对象和关键信息。它追加到现有屏幕理解规则，不覆盖用户未提交的默认 Prompt 编辑；不授权执行观察到的需求。

## 配置与追踪

设置中增加 Tavily Search / Extract 的 Key 保存和清除入口。`SearchSettings` 使用 Electron safeStorage 将凭证加密到本应用 `web-search.json`；状态只显示 hasKey，不把 Key 传给模型。清空历史不删除该配置。也可通过本应用 IPC `web.config` / `web.status` 调用，外部 renderer 无权访问。

「查看 AI 请求详情 → 模型步骤」显示每一步消息、输出、工具调用与结果。图片用原动作及哈希引用，完整证据仍按 ID 查询。初始 Prompt 保留历史标题；多步 token 用量汇总计算。Agentic 请求不复用旧的单次理解缓存，以免忽略新增历史和外部网页变化；同批并发的相同请求仍共享在途结果。

本次只给理解 Agent 接入新工具；主 Agent 的 DSH 工具适配和原 Web 占位工具未更改。业务查询通过接口注入，后续复用不需要复制数据库逻辑。窗口归属和截图正确性不属于本次修改。

## 验证边界

测试使用本机 HTTP 模型替身和 Tavily 协议替身，验证先取历史详情及图片、再生成结构化结果，工具预算、未来 ID 拒绝、应用过滤、Key 保存恢复和错误脱敏。合成界面预览验证配置入口与模型步骤显示。未使用真实 Tavily Key，也未上传用户截图做真实模型评测；需配置后再验证线上效果。

API 参考：[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)。
