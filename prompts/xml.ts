/** 为 Prompt 的 XML 文本节点序列化动态数据；不提供指令隔离或执行能力。 */

/** 转义 XML 文本保留字符，阻止动态内容闭合外层标签。 */
export function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** 将结构化数据作为 XML 文本输出；空值明确写为 null。 */
export function xmlData(value: unknown): string {
  return xmlText(JSON.stringify(value ?? null, null, 2));
}
