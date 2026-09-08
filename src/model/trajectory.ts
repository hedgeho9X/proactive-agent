export function trajectoryLine(actionId: string, action: any, result: any) {
  if (!result?.action_title || !result?.action_detail)
    throw new Error("action_summary_unavailable");
  const date = new Date(action.occurred_at);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const time = Number.isFinite(date.getTime())
    ? `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    : "时间未知";
  const line = (value: string) => value.replace(/[\r\n]/g, " ");
  return `[${time}] ${line(result.action_title)} / ${line(result.action_detail)} / ${actionId}`;
}
