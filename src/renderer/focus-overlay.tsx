import React, { useState } from "react";
import { projectBBox } from "./bbox.ts";
import { ContextMenu } from "radix-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { screenshotPNG } from "./copy-screenshot.ts";

const reason = (item: any) =>
  item?.status === "not_applicable"
    ? "本次不是点击事件"
    : item?.status === "no_selection"
      ? "只有光标，没有文字选区"
      : (item?.reason ?? "应用未提供范围");
export function FocusOverlay({
  screenshot,
  onSelectNode,
}: {
  screenshot: any;
  onSelectNode?: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [opacity, setOpacity] = useState(0.22);
  const [focusColor, setFocusColor] = useState("#3b82f6");
  const [selectionColor, setSelectionColor] = useState("#f59e0b");
  const [clickColor, setClickColor] = useState("#10b981");
  const [mode, setMode] = useState("both");
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const [naturalWidth, setNaturalWidth] = useState(screenshot.pixelWidth ?? 0);
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const mapped =
    screenshot.coordinateSpace === "screen_top_left_points" &&
    screenshot.shadowsExcluded === true;
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
      const dataUrl = annotated
        ? await screenshotPNG(screenshot.data, visible)
        : "data:image/png;base64," + screenshot.data;
      await window.proactive.invoke("ax.copyImage", { dataUrl });
      setCopyStatus(annotated ? "已复制图片（含当前标注）" : "已复制原图");
    } catch {
      setCopyStatus("复制图片失败，请重试");
    } finally {
      setCopying(false);
    }
  };
  const imageView = (large: boolean) => (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={`relative shrink-0 overflow-hidden rounded border ${large ? "" : "w-full cursor-zoom-in"}`}
          style={
            large
              ? {
                  width: (naturalWidth || screenshot.pixelWidth || 1200) * zoom,
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
            if (!large) setExpanded(true);
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
            onLoad={(event) =>
              setNaturalWidth(event.currentTarget.naturalWidth)
            }
          />
          {enabled &&
            layers
              .filter((layer) => mode === "both" || mode === layer.key)
              .map(
                (layer) =>
                  layer.box && (
                    <div
                      key={layer.key}
                      data-bbox={layer.key}
                      aria-label={`${layer.label}范围`}
                      className="pointer-events-none absolute box-border border-2"
                      style={{
                        left: `${layer.box.left}%`,
                        top: `${layer.box.top}%`,
                        width: `${layer.box.width}%`,
                        height: `${layer.box.height}%`,
                        borderColor: layer.color,
                        backgroundColor:
                          layer.color +
                          Math.round(opacity * 255)
                            .toString(16)
                            .padStart(2, "0"),
                      }}
                    />
                  ),
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          显示 bbox
        </label>
        <select
          aria-label="标注范围"
          className="rounded border bg-background p-1"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="both">全部区域</option>
          <option value="focus">仅焦点控件</option>
          <option value="selection">仅文字选区</option>
          <option value="click">仅点击命中</option>
        </select>
        <label className="flex items-center gap-1">
          透明度{" "}
          <input
            aria-label="bbox 透明度"
            type="range"
            min="0"
            max="0.6"
            step="0.01"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          {Math.round(opacity * 100)}%
        </label>
        <label className="flex items-center gap-1">
          焦点颜色
          <input
            aria-label="焦点颜色"
            type="color"
            value={focusColor}
            onChange={(e) => setFocusColor(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1">
          选区颜色
          <input
            aria-label="选区颜色"
            type="color"
            value={selectionColor}
            onChange={(e) => setSelectionColor(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1">
          点击颜色
          <input
            aria-label="点击颜色"
            type="color"
            value={clickColor}
            onChange={(e) => setClickColor(e.target.value)}
          />
        </label>
      </div>
      {!mapped && (
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
                <span className="ml-2">采样完成 {layer.source.sampledAt}</span>
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
            </p>
          ))}
          <p>
            焦点表示键盘输入控件，绿色表示点击位置命中的控件，文字选区为外接矩形。区域采样：
            {screenshot.regionsSampledAt ?? "未记录"}。颜色不修改原图。
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        点击图片放大，右键复制原图或当前标注图。
      </p>
      {imageView(false)}
      <p role="status" className="text-xs">
        {copying ? "正在复制…" : copyStatus}
      </p>
      <Dialog open={expanded} onOpenChange={setExpanded}>
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
                min="0.5"
                max="3"
                step="0.25"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="rounded border px-2 py-1"
              onClick={() => setZoom(1)}
            >
              原始大小
            </button>
            <span role="status">{copying ? "正在复制…" : copyStatus}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded bg-muted/30 p-2">
            {imageView(true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
