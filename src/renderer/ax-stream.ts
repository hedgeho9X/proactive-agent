import {
  meaningfulAXEvent,
  eventOrder,
} from "../observation/ax-history-view.ts";
import { preciseTime, type StreamRow } from "./projection.ts";

// 只投影元数据，图片和完整 AX 在点击详情后按 ID 读取。
export function projectAXRecords(records: any[]): StreamRow[] {
  return records
    .filter(meaningfulAXEvent)
    .sort(eventOrder)
    .map((record) => {
      const time =
        record.trigger?.occurredAt ?? record.capturedAt ?? record.savedAt;
      return {
        id: record.id,
        kind: "action",
        label: record.app ?? "本地记录",
        time: preciseTime(time),
        timestamp: Date.parse(time),
        status: record.captureStatus ?? "captured",
        text: [
          record.trigger?.kind === "click"
            ? "点击"
            : (record.trigger?.key ?? "手动快照"),
          ...(record.trigger?.modifiers ?? []),
          `${record.nodes ?? 0} 节点`,
        "操作证据",
        ].join(" · "),
        detail: { axRecord: record },
      };
    });
}
