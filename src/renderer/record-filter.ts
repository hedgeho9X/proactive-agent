/** 原始记录视图的处理状态筛选，列表与计数共用同一规则。 */

/** 只保留尚未成功理解的本地记录；失败可重试，已跳过和已理解的不再展示。 */
export function isUnprocessedRecord(row: {
  status?: string;
  detail?: { axRecord?: unknown; actionTitle?: unknown };
}): boolean {
  return (
    !!row.detail?.axRecord &&
    !row.detail.actionTitle &&
    !["ready", "delivering", "delivered", "filtered"].includes(row.status ?? "")
  );
}
