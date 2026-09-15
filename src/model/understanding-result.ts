/** 统一读取理解结果的语义字段；只兼容字段名称，不生成或改写历史正文。 */

/** 单次观察的活动描述与相关原文上下文。 */
export interface UnderstandingResult {
  description: string;
  detail: string;
}

/** 新字段优先，旧 action_title/action_detail 作为回退；缺失字段返回空串。 */
export function understandingResult(value: unknown): UnderstandingResult {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const text = (current: unknown, legacy: unknown): string =>
    typeof current === "string" && current.trim()
      ? current
      : typeof legacy === "string"
        ? legacy
        : "";
  return {
    description: text(record.description, record.action_title),
    detail: text(record.detail, record.action_detail),
  };
}
