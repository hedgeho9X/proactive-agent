/** 将理解结果投影为单行时间轨迹，不把结构化证据复制到主 Agent 消息中。 */
import { understandingResult } from "./understanding-result.ts";

/** 接受新旧理解字段，保留原始发生时间、活动描述、详情与 Action ID。 */
export function trajectoryLine(actionId: string, action: any, result: any) {
  const { description, detail } = understandingResult(result);
  if (!description || !detail) throw new Error("action_summary_unavailable");
  const date = new Date(action.occurred_at);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const time = Number.isFinite(date.getTime())
    ? `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    : "时间未知";
  const line = (value: string) => value.replace(/[\r\n]/g, " ");
  return `[${time}] ${line(description)} / ${line(detail)} / ${actionId}`;
}
