/** 理解列表的两行正文与花费字段；不把未知费用当成免费或猜测单价。 */
import React from "react";

/** Title 与 Detail 分行展示，完整细节仍可通过点击行查看。 */
export function UnderstandingText({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <span className="event-summary flex flex-col gap-1">
      <span className="truncate font-medium">{title}</span>
      <span className="truncate text-muted-foreground">
        {detail || "暂无详细描述"}
      </span>
    </span>
  );
}

/** 仅展示可追溯的金额、Token 与耗时，金额缺失明确标记。 */
export function understandingCost(value: {
  costUSD?: number | null;
  totalTokens?: number | null;
  elapsedMs?: number | null;
}): string {
  const fee =
    typeof value.costUSD === "number" && Number.isFinite(value.costUSD)
      ? `$${value.costUSD.toFixed(4)}`
      : "费用未提供";
  return [
    fee,
    value.totalTokens == null
      ? null
      : `${value.totalTokens.toLocaleString()} tokens`,
    value.elapsedMs == null ? null : `${(value.elapsedMs / 1000).toFixed(1)}s`,
  ]
    .filter(Boolean)
    .join(" · ");
}
