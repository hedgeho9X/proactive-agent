/** 展示阅读证据及其边界，不将采集片段渲染成模型生成的解释。 */
import React from "react";
import { DetailDisclosure } from "./detail-disclosure.tsx";

/** 选区与正文可分别缺失；保留原文、时间和截断说明供人工核对。 */
export function ReadingContextPanel({ value }: { value: any }) {
  if (!value?.selectedText && !value?.context)
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        阅读证据：{value?.reason ?? "未采集"}
      </p>
    );
  return (
    <DetailDisclosure title="阅读证据 · 选中文字与相关正文">
      <div className="mb-4 flex flex-col gap-3 text-sm">
        {(
          [
            ["选中文字", value.selectedText],
            ["相关正文", value.context],
          ] as const
        ).map(
          ([label, part]) =>
            part && (
              <section key={label} className="flex flex-col gap-1">
                <h4 className="font-medium">{label}</h4>
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                  {part.text}
                </p>
                <p className="text-xs text-muted-foreground">
                  来源：{part.source ?? "未记录"} · 范围：
                  {part.scope ?? "文本选区"} ·{" "}
                  {part.truncated ? "存在截断" : "未标记截断，不等于完整回复"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {part.sampledAt ??
                    (part.capturedBetween
                      ? `${part.capturedBetween.from ?? "?"} → ${part.capturedBetween.to ?? "?"}`
                      : "采样时刻未记录")}{" "}
                  {part.reason ?? part.alignmentReason}{" "}
                  {part.selectionRelation === "unverified_different_anchors"
                    ? "选区与正文的关联未验证"
                    : ""}
                </p>
              </section>
            ),
        )}
        <p className="text-xs text-muted-foreground">
          正文可能包含屏幕外的已加载内容；不能据此认定用户看过全部文字。
        </p>
      </div>
    </DetailDisclosure>
  );
}
