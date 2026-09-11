/** 按 Bundle ID 提供人工维护的应用背景知识；不判断当前行为，也不替代窗口身份校验。 */

/** 静态应用知识，不保存会话内容、个人偏好或登录信息。 */
export interface AppDefinition {
  display_name: string;
  category: string;
  purpose: string;
  common_features: readonly string[];
}

/** 应用知识表；新增应用时使用实际 Bundle ID，不按窗口标题或名称模糊匹配。 */
export const appInfoMap: Readonly<Record<string, AppDefinition>> = {
  "com.tencent.xinWeChat": {
    display_name: "微信",
    category: "communication",
    purpose: "即时通信与内容浏览应用。",
    common_features: ["私聊和群聊", "文件传输", "公众号及朋友圈浏览"],
  },
  "com.electron.lark": {
    display_name: "飞书",
    category: "collaboration",
    purpose: "团队沟通与办公协作应用。",
    common_features: ["聊天", "文档协作", "日历和会议"],
  },
  "com.brave.Browser": {
    display_name: "Brave",
    category: "browser",
    purpose: "用于访问网站和操作 Web 应用的浏览器。",
    common_features: ["浏览网页", "地址栏搜索", "标签页管理", "下载文件"],
  },
  "dev.zed.Zed": {
    display_name: "Zed",
    category: "development",
    purpose: "用于阅读和编辑代码的编辑器。",
    common_features: ["项目与文件管理", "代码编辑", "搜索", "终端"],
  },
  "com.microsoft.VSCode": {
    display_name: "Visual Studio Code",
    category: "development",
    purpose: "用于代码编辑和开发调试的编辑器。",
    common_features: ["代码编辑", "项目搜索", "终端", "调试"],
  },
  "com.apple.Terminal": {
    display_name: "终端",
    category: "development",
    purpose: "用于与命令行程序交互的终端模拟器。",
    common_features: ["输入命令", "查看程序输出", "管理终端会话"],
  },
  "com.apple.finder": {
    display_name: "访达",
    category: "file_manager",
    purpose: "macOS 文件和文件夹管理应用。",
    common_features: ["浏览文件", "搜索文件", "打开和管理文件夹"],
  },
  "com.openai.codex": {
    display_name: "Codex",
    category: "ai_assistant",
    purpose: "围绕任务和项目与 AI 助手协作的应用。",
    common_features: ["对话与任务管理", "代码阅读和编辑", "查看执行结果"],
  },
  "com.apple.dock": {
    display_name: "程序坞",
    category: "system",
    purpose: "macOS 的应用启动与切换界面。",
    common_features: ["启动应用", "切换应用窗口"],
  },
  "io.github.hedgeho9x.proactive-agent": {
    display_name: "Proactive Lab",
    category: "observation_tool",
    purpose: "本应用的桌面行为采集与 Agent 调试界面。",
    common_features: [
      "查看动作记录和截图",
      "查看 AI 理解",
      "配置模型和 Prompt",
    ],
  },
};

/** 一次请求使用的应用背景快照；观测名称与知识名称分开，避免覆盖原始身份。 */
export interface AppInfo {
  bundle_id: string | null;
  observed_name: string | null;
  source: "local_registry" | "unknown";
  registry_version: number;
  definition: AppDefinition | null;
}

/** 从采集元数据解析背景信息；未知 ID 返回 unknown，不猜测名称对应的用途。 */
export function resolveAppInfo(app?: {
  bundle_id?: unknown;
  name?: unknown;
}): AppInfo {
  const bundle_id = typeof app?.bundle_id === "string" ? app.bundle_id : null;
  const observed_name = typeof app?.name === "string" ? app.name : null;
  const definition =
    bundle_id && Object.hasOwn(appInfoMap, bundle_id)
      ? appInfoMap[bundle_id]
      : null;
  return {
    bundle_id,
    observed_name,
    registry_version: 1,
    source: definition ? "local_registry" : "unknown",
    definition: definition
      ? { ...definition, common_features: [...definition.common_features] }
      : null,
  };
}
