import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { parseDanmaku } from "../model/danmaku.ts";

// 独立窗口只接收纯文本，点击穿透，不提供主应用的通用 IPC 能力。
export class DesktopDanmaku {
  private window?: BrowserWindow;
  private loading?: Promise<void>;
  private active?: {
    id: string;
    timer: ReturnType<typeof setTimeout>;
    settle: (shown: boolean) => void;
  };
  private lastShown = -Infinity;
  private closed = false;
  enabled = true;

  constructor() {
    ipcMain.on("danmaku:painted", this.painted);
    ipcMain.on("danmaku:finished", this.finished);
  }

  private painted = (event: Electron.IpcMainEvent, id: string) => {
    if (event.sender === this.window?.webContents && this.active?.id === id)
      this.active.settle(true);
  };
  private finished = (event: Electron.IpcMainEvent, id: string) => {
    if (event.sender === this.window?.webContents && this.active?.id === id)
      this.clear();
  };

  private async ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.loading;
    const overlay = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        preload: join(app.getAppPath(), "dist/desktop/danmaku-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window = overlay;
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, "floating");
    overlay.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    overlay.webContents.on("render-process-gone", () => {
      this.clear();
      overlay.destroy();
    });
    overlay.on("closed", () => this.clear());
    this.loading = overlay.loadFile(
      join(app.getAppPath(), "dist/renderer/danmaku.html"),
    );
    return this.loading;
  }

  async show(value: unknown) {
    const input = parseDanmaku(value);
    if (this.closed || !this.enabled) return { status: "disabled" };
    // 不排队过期提醒；最多同时一条，避免遮挡与 Agent 连续刷屏。
    if (this.active || Date.now() - this.lastShown < 5000)
      return {
        status: "rate_limited",
        reason: "one_at_a_time_and_5s_cooldown",
      };
    const id = crypto.randomUUID();
    let settle!: (shown: boolean) => void;
    const painted = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => this.clear(), 3000);
    this.active = { id, timer, settle };
    try {
      await this.ensureWindow();
      if (this.active?.id !== id || this.closed || !this.enabled)
        return { id, status: "cancelled" };
      const overlay = this.window!;
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      );
      overlay.setBounds(workArea);
      overlay.showInactive();
      overlay.webContents.send("danmaku:show", { id, ...input });
      if (!(await painted))
        return {
          id,
          status: "unavailable",
          reason: "display_cancelled_or_timeout",
        };
      if (this.active?.id !== id) return { id, status: "cancelled" };
      clearTimeout(timer);
      this.active.timer = setTimeout(
        () => this.clear(),
        input.duration_seconds * 1000 + 1000,
      );
      this.lastShown = Date.now();
      return { id, status: "shown", ...input };
    } catch {
      this.clear();
      this.window?.destroy();
      return { id, status: "unavailable", reason: "overlay_failed" };
    }
  }

  clear() {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.settle(false);
    }
    this.active = undefined;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("danmaku:clear");
      this.window.hide();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  close() {
    this.closed = true;
    this.clear();
    ipcMain.removeListener("danmaku:painted", this.painted);
    ipcMain.removeListener("danmaku:finished", this.finished);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
