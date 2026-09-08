import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { captureDiagnostic } from "../observation/capture-diagnostics.ts";
export function CaptureStatus({ snapshot }: { snapshot: any }) {
  const info = captureDiagnostic(snapshot);
  const warnings: string[] = info.detail.warnings ?? [];
  return (
    <Alert
      variant={
        info.reason && info.reason !== "pending" ? "destructive" : "default"
      }
    >
      <AlertTitle>
        {info.reason === "pending"
          ? "正在截图"
          : info.reason
            ? "截图未完成"
            : "已取得目标窗口图片"}
      </AlertTitle>
      <AlertDescription>
        <p>{info.message}</p>
        <p>
          阶段：{info.stage} · 目标窗口：{info.targetId ?? "未确定"} · PID：
          {info.targetPid ?? "未知"}
        </p>
        {info.reason && <p>原因码：{info.reason}</p>}
        {info.detail.domain && (
          <p>
            系统错误：{info.detail.domain} / {info.detail.code} ·{" "}
            {info.detail.message}
          </p>
        )}
        {warnings.some((value) => value.startsWith("foreground_changed")) && (
          <p>前台已切换；本次仍仅尝试事件锁定的窗口，没有改拍新的前台应用。</p>
        )}
        {warnings.includes("target_ax_window_unavailable_image_only") && (
          <p>未能关联目标窗口的 AX；没有拼入其他窗口的 AX。</p>
        )}
        {warnings.includes("ax_window_mismatch_discarded") && (
          <p>已丢弃与图片不一致的 AX 树，仅保留窗口图片和有效区域。</p>
        )}
        {info.detail.frameStableDuringCapture === false && (
          <p>窗口边界发生变化或无法复查，已停止叠加不可靠的区域框。</p>
        )}
        {info.detail.frameChangedSinceEvent && (
          <p>
            同一个窗口在事件之后发生了移动或缩放；点击坐标保留为事件原始坐标。
          </p>
        )}
        <details>
          <summary>完整采集诊断</summary>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(info.detail, null, 2)}
          </pre>
        </details>
      </AlertDescription>
    </Alert>
  );
}
