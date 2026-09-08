export interface DanmakuInput {
  text: string;
  duration_seconds?: number;
}

// 工具参数在跨进程入口再次检查，不能仅依赖模型遵守 JSON Schema。
export function parseDanmaku(value: unknown): Required<DanmakuInput> {
  if (!value || typeof value !== "object") throw new Error("invalid_danmaku");
  const { text, duration_seconds = 8 } = value as DanmakuInput;
  if (typeof text !== "string" || !text.trim() || [...text].length > 80)
    throw new Error("danmaku_text_must_be_1_to_80_characters");
  if (
    typeof duration_seconds !== "number" ||
    !Number.isFinite(duration_seconds) ||
    duration_seconds < 4 ||
    duration_seconds > 12
  )
    throw new Error("danmaku_duration_must_be_4_to_12_seconds");
  return { text: text.replace(/[\r\n\t]/g, " ").trim(), duration_seconds };
}
