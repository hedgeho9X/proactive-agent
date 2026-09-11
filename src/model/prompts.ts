/** 加载独立 Prompt 资源及本机覆盖，不包含提示词正文。 */
import { readFile, writeFile } from "node:fs/promises";
import understanding from "../../prompts/understanding.json" with { type: "json" };
import main from "../../prompts/main.json" with { type: "json" };
import subagent from "../../prompts/subagent.json" with { type: "json" };
import messages from "../../prompts/messages.json" with { type: "json" };
import toolDescriptions from "../../prompts/tools.json" with { type: "json" };
/** 默认角色正文，数组元素按换行连接。 */
export const defaultPrompts = {
  understanding: understanding.join("\n"),
  main: main.join("\n"),
  subagent: subagent.join("\n"),
};
/** 模型可见的辅助提示模板。 */
export const promptMessages = messages;
/** 模型可见的工具说明。 */
export const toolPrompts = toolDescriptions;
/** 单次替换变量，不递归解释用户内容中的模板语法。 */
export function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key))
      throw new Error("missing_prompt_variable:" + key);
    return values[key];
  });
}
/** 支持用户覆盖的三个角色。 */
export type PromptRole = keyof typeof defaultPrompts;
/** 合并默认文件与本机设置，保存后不改变历史请求中的 Prompt。 */
export class PromptStore {
  private values = { ...defaultPrompts };
  /** path 是本应用私有的角色覆盖配置。 */
  constructor(private path: string) {}
  /** 读取本机覆盖；未配置的角色使用独立资源文件。 */
  async load() {
    const data = await readFile(this.path, "utf8")
      .then(JSON.parse)
      .catch(() => ({}));
    for (const role of Object.keys(defaultPrompts) as PromptRole[])
      if (typeof data[role] === "string" && data[role].trim())
        this.values[role] = data[role];
  }
  /** 返回当前生效正文的副本。 */
  snapshot() {
    return { ...this.values };
  }
  /** 校验角色及正文后保存本机覆盖，不写入仓库默认文件。 */
  async update(role: PromptRole, value: string) {
    if (
      !Object.hasOwn(defaultPrompts, role) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 20000
    )
      throw new Error("invalid_prompt");
    this.values[role] = value.trim();
    await writeFile(this.path, JSON.stringify(this.values, null, 2), {
      mode: 0o600,
    });
  }
}
