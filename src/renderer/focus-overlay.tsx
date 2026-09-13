/** 使用固定默认样式展示截图标注，支持放大和复制；不修改原图。 */
import React, { useEffect, useState } from "react";
import { projectBBox, projectPoint } from "./bbox.ts";
import { ContextMenu } from "radix-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DetailDisclosure } from "./detail-disclosure.tsx";
import { screenshotPNG } from "./copy-screenshot.ts";

/** 将标注缺失原因转为说明文字。 */
const reason = (item: any) =>
  item?.status === "not_applicable"
    ? "本次不是点击事件"
    : item?.status === "no_selection"
      ? "只有光标，没有文字选区"
      : ({
          region_window_mismatch: "控件属于另一窗口，未叠加",
          region_window_unverified: "无法确认控件所属窗口，未叠加",
          empty_selection_bounds: "应用返回了空的选区范围",
        }[item?.reason as string] ??
        item?.reason ??
        "应用未提供范围");
/** 标注默认开启且仅画轮廓；放大视图按可用屏幕空间适配。 */
export function FocusOverlay({
  screenshot,
  trigger,
  onSelectNode,
}: {
  screenshot: any;
  trigger?: any;
  onSelectNode?: (id: string) => void;
}) {
  const enabled = true,
    opacity = 0,
    mode = "both";
  const focusColor = "#3b82f6",
    selectionColor = "#f59e0b",
    clickColor = "#10b981";
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(screenshot.pixelWidth ?? 0);
  const [naturalHeight, setNaturalHeight] = useState(
    screenshot.pixelHeight ?? 0,
  );
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState({ width: 1, height: 1 });
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  const fit = Math.min(
    Math.max(1, available.width - 4) / Math.max(1, naturalWidth),
    Math.max(1, available.height - 4) / Math.max(1, naturalHeight),
    1,
  );
  const scale = zoom || fit;
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const baked = screenshot.annotated === true;
  const mapped =
    screenshot.coordinateSpace === "screen_top_left_points" &&
    screenshot.shadowsExcluded === true;
  const clickPoint =
    mapped && trigger?.kind === "click"
      ? projectPoint(trigger.x, trigger.y, screenshot.frame)
      : null;
  const layers = [
    { key: "focus", label: "焦点控件", color: focusColor },
    { key: "selection", label: "文字选区", color: selectionColor },
    { key: "click", label: "点击命中", color: clickColor },
  ].map((layer) => ({
    ...layer,
    source: screenshot.regions?.[layer.key],
    box: mapped
      ? projectBBox(screenshot.regions?.[layer.key]?.rect, screenshot.frame)
      : null,
  }));
  /** 根据当前默认标注生成复制图，原图复制保留原始像素。 */
  const copy = async (annotated: boolean) => {
    setCopying(true);
    setCopyStatus("");
    try {
      const visible = enabled
        ? layers
            .filter(
              (layer) => layer.box && (mode === "both" || mode === layer.key),
            )
            .map((layer) => ({ box: layer.box!, color: layer.color, opacity }))
        : [];
      // 相同范围只画一次，优先保留点击颜色，避免重复填色加深。
      const unique = visible.filter(
        (layer, index) =>
          !visible
            .slice(index + 1)
            .some((other) =>
              ["left", "top", "width", "height"].every(
                (key) =>
                  Math.abs((layer.box as any)[key] - (other.box as any)[key]) <
                  0.001,
              ),
            ),
      );
      const dataUrl = annotated
        ? await screenshotPNG(
            screenshot.data,
            unique,
            enabled && clickPoint && (mode === "both" || mode === "click")
              ? { ...clickPoint, color: clickColor }
              : undefined,
          )
        : "data:image/png;base64," + screenshot.data;
      await window.proactive.invoke("ax.copyImage", { dataUrl });
      setCopyStatus(annotated ? "已复制图片（含当前标注）" : "已复制原图");
    } catch {
      setCopyStatus("复制图片失败，请重试");
    } finally {
      setCopying(false);
    }
  };
  /** 缩略图和放大图共享标注和复制入口。 */
  const imageView = (large: boolean) => (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={`relative shrink-0 overflow-hidden rounded border ${large ? "" : "w-full cursor-zoom-in"}`}
          style={
            large
              ? {
                  width:
                    (naturalWidth || screenshot.pixelWidth || 1200) * scale,
                  maxWidth: "none",
                }
              : {
                  maxWidth:
                    (screenshot.pixelWidth ?? naturalWidth) || undefined,
                }
          }
          role={large ? undefined : "button"}
          tabIndex={large ? undefined : 0}
          aria-label={large ? "放大截图" : "点击放大截图"}
          onClick={() => {
            if (!large) {
              setZoom(0);
              setExpanded(true);
            }
          }}
          onKeyDown={(event) => {
            if (!large && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setExpanded(true);
            }
          }}
        >
          <img
            alt={large ? "放大的目标窗口快照" : "目标应用窗口快照"}
            draggable={false}
            className="block h-auto w-full"
            src={`data:image/png;base64,${screenshot.data}`}
            onLoad={(event) => {
              setNaturalWidth(event.currentTarget.naturalWidth);
              setNaturalHeight(event.currentTarget.naturalHeight);
            }}
          />
          {enabled &&
            layers
              .filter((layer) => mode === "both" || mode === layer.key)
              .map(
                (layer) =>
                  layer.box &&
                  !layers
                    .slice(layers.indexOf(layer) + 1)
                    .some(
                      (other) =>
                        other.box &&
                        (mode === "both" || mode === other.key) &&
                        ["left", "top", "width", "height"].every(
                          (key) =>
                            Math.abs(
                              (layer.box as any)[key] - (other.box as any)[key],
                            ) < 0.001,
                        ),
                    ) && (
                    <div
                      key={layer.key}
                      data-bbox={layer.key}
                      aria-label={`${layer.label}范围`}
                      className="pointer-events-none absolute box-border"
                      style={{
                        left: `${layer.box.left}%`,
                        top: `${layer.box.top}%`,
                        width: `${layer.box.width}%`,
                        height: `${layer.box.height}%`,
                        boxShadow: `0 0 0 1px ${layer.color}`,
                        backgroundColor:
                          layer.color +
                          Math.round(opacity * 255)
                            .toString(16)
                            .padStart(2, "0"),
                      }}
                    />
                  ),
              )}
          {enabled && clickPoint && (mode === "both" || mode === "click") && (
            <div
              data-click-point
              aria-label="事件点击位置"
              className="pointer-events-none absolute h-3 w-3 rounded-full"
              style={{
                left: `${clickPoint.left}%`,
                top: `${clickPoint.top}%`,
                transform: "translate(-50%, -50%)",
                boxShadow: `0 0 0 1px ${clickColor}`,
                background: "transparent",
              }}
            />
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[100] min-w-44 rounded border bg-background p-1 text-sm shadow-lg">
          <ContextMenu.Item
            disabled={copying}
            onSelect={() => void copy(true)}
            className="cursor-default rounded px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
          >
            复制图片（含标注）
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={copying}
            onSelect={() => void copy(false)}
            className="cursor-default rounded px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
          >
            复制原图
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
  return (
    <div className="flex flex-col gap-2">
      {imageView(false)}
      <DetailDisclosure title="标注说明">
        {!mapped && !baked && (
          <p className="text-sm text-muted-foreground">
            这份旧快照缺少准确坐标映射，请重新采集后查看 bbox。
          </p>
        )}
        {mapped && (
          <div className="text-xs text-muted-foreground">
            {layers.map((layer) => (
              <p key={layer.key}>
                {layer.label}：
                {layer.box
                  ? `${Math.round(layer.source.rect.width)} × ${Math.round(layer.source.rect.height)} pt${layer.box.clipped ? "（已裁剪到窗口内）" : ""}`
                  : reason(layer.source)}
                {layer.source?.sampledAt && (
                  <span className="ml-2">
                    采样完成 {layer.source.sampledAt}
                  </span>
                )}
                {layer.source?.nodeId && (
                  <button
                    className="ml-2 underline"
                    onClick={() => onSelectNode?.(layer.source.nodeId)}
                  >
                    {layer.source.nodeId} ·{" "}
                    {layer.source.sampledAttributes?.AXRole?.value?.text ??
                      "查看节点"}
                  </button>
                )}
                {layer.box && layer.box.width * layer.box.height > 6000 && (
                  <span> · 范围较粗，覆盖大部分窗口</span>
                )}
              </p>
            ))}
            <p>
              默认不填色，轮廓画在范围外侧。绿色空心圈是事件点击坐标，绿色框是
              AX 返回的命中控件范围；大框不代表精确到文字。区域采样：
              {screenshot.regionsSampledAt ?? "未记录"}。颜色不修改原图。
            </p>
          </div>
        )}
      </DetailDisclosure>
      <p role="status" className="text-xs">
        {copying ? "正在复制…" : copyStatus}
      </p>
      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          if (open) setZoom(0);
          setExpanded(open);
        }}
      >
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-none flex-col sm:max-w-none">
          <DialogHeader>
            <DialogTitle>截图预览</DialogTitle>
            <DialogDescription>
              滚动查看大图；右键可复制。按 Esc 关闭。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 text-sm">
            <label>
              缩放{" "}
              <input
                aria-label="图片缩放"
                type="range"
                min="0.01"
                max="3"
                step="0.01"
                value={scale}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <span>
              {Math.round(scale * 100)}%{zoom === 0 ? " · 适应窗口" : ""}
            </span>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setZoom(0)}
            >
              适应窗口
            </button>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setZoom(1)}
            >
              原始大小
            </button>
            <span role="status">{copying ? "正在复制…" : copyStatus}</span>
          </div>
          <div
            ref={setViewport}
            className="min-h-0 flex-1 overflow-auto rounded bg-muted/30 p-2"
          >
            {imageView(true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
