import React from "react";
import { comparisonIssue, canonicalAX, alignDiffLines } from "./ax-diff.ts";
function pretty(value: any) {
  return value === undefined
    ? ""
    : JSON.stringify(JSON.parse(canonicalAX(value)), null, 2);
}
// 红绿仅表达文本差异，不把无法匹配的节点判定成真实增删。
export function AXDiffView({
  before,
  after,
  changes,
}: {
  before: any;
  after: any;
  changes: any[];
}) {
  const issue = comparisonIssue(before, after);
  if (issue) return <p className="text-sm">{issue}</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        优先匹配应用唯一标识；候选匹配和读取状态变化会明确标注。未匹配不等于新增或删除。
        {before.partial || after.partial
          ? " 当前存在截断，不能判断节点是否消失。"
          : ""}
      </p>
      <div className="grid grid-cols-2 gap-px rounded border bg-border text-xs">
        <div className="bg-background p-2">
          左侧 · {before.trigger?.occurredAt ?? before.capturedAt}
          <br />
          {before.snapshotId}
        </div>
        <div className="bg-background p-2">
          右侧 · {after.trigger?.occurredAt ?? after.capturedAt}
          <br />
          {after.snapshotId}
        </div>
      </div>
      {!changes.length && (
        <p className="text-sm">已匹配且可读取的属性未发现变化。</p>
      )}
      {changes.map((change, index) => {
        const left = pretty(change.before).split("\n"),
          right = pretty(change.after).split("\n");
        return (
          <section key={index} className="overflow-hidden rounded border">
            <div className="border-b bg-muted px-3 py-2 text-xs">
              {change.kind} · {change.attribute ?? change.node} ·{" "}
              {change.basis ?? "无可靠对应节点"}
              {change.uncertain ? " · 待确认" : ""}
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[500px] font-mono text-xs">
                {alignDiffLines(left, right).map((row, line) => {
                  const different = row.left !== row.right;
                  return (
                    <div key={line} className="grid grid-cols-2 divide-x">
                      <div
                        className={`flex min-w-0 ${different && row.left !== undefined ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : ""}`}
                      >
                        <span className="w-9 shrink-0 px-1 text-right opacity-50">
                          {row.leftLine ?? ""}
                        </span>
                        <pre className="whitespace-pre-wrap break-all px-2 py-0.5">
                          {different && row.left !== undefined ? "− " : "  "}
                          {row.left ?? ""}
                        </pre>
                      </div>
                      <div
                        className={`flex min-w-0 ${different && row.right !== undefined ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200" : ""}`}
                      >
                        <span className="w-9 shrink-0 px-1 text-right opacity-50">
                          {row.rightLine ?? ""}
                        </span>
                        <pre className="whitespace-pre-wrap break-all px-2 py-0.5">
                          {different && row.right !== undefined ? "+ " : "  "}
                          {row.right ?? ""}
                        </pre>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
