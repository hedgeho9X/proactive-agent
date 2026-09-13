/** 使用应用的本机图标，按 Bundle ID 缓存；不可用时显示名称首字。 */
import React, { useEffect, useState } from "react";
const icons = new Map<string, Promise<string | null>>();

/** 图标读取不阻塞列表，组件卸载后不更新状态。 */
export function ApplicationIcon({
  bundleId,
  name,
}: {
  bundleId?: string;
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSrc(null);
    if (bundleId) {
      if (!icons.has(bundleId))
        icons.set(
          bundleId,
          window.proactive
            .invoke("app.icon", { bundleId })
            .then((value) => (typeof value === "string" ? value : null))
            .catch(() => null),
        );
      void icons.get(bundleId)!.then((value) => {
        if (active) setSrc(value);
      });
    }
    return () => {
      active = false;
    };
  }, [bundleId]);
  return src ? (
    <img
      className="size-4 shrink-0 object-contain"
      src={src}
      alt=""
      onError={() => setSrc(null)}
    />
  ) : (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground"
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}
