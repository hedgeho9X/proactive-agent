import type { DanmakuInput } from "../model/danmaku.ts";
const bridge = (window as any).danmaku;
let current: HTMLElement | undefined;
let animation: Animation | undefined;
function clear() {
  animation?.cancel();
  current?.remove();
  current = undefined;
}
bridge.subscribe((value: Required<DanmakuInput> & { id: string }) => {
  clear();
  const element = document.createElement("div");
  element.className = "danmaku";
  // 不解释 HTML、Markdown 或屏幕中的指令，所有内容只能作为文字显示。
  element.textContent = `Proactive Agent · ${value.text}`;
  document.body.append(element);
  current = element;
  const width = element.getBoundingClientRect().width;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  animation = element.animate(
    reduced
      ? [
          {
            transform: `translateX(${Math.max(16, (innerWidth - width) / 2)}px)`,
          },
          {
            transform: `translateX(${Math.max(16, (innerWidth - width) / 2)}px)`,
          },
        ]
      : [
          { transform: `translateX(${innerWidth}px)` },
          { transform: `translateX(${-width}px)` },
        ],
    { duration: value.duration_seconds * 1000, easing: "linear", fill: "both" },
  );
  animation.onfinish = () => {
    clear();
    bridge.finished(value.id);
  };
  // 第二帧开始后才确认展示；宿主收到确认才向 Agent 返回 shown。
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (current === element) bridge.painted(value.id);
    }),
  );
}, clear);
