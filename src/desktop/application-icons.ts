/** 本机应用图标缓存；输入只接受 Bundle ID，渲染进程不能指定任意文件路径。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** 同一应用并发请求共享一次原生读取，失败只返回空图标。 */
export class ApplicationIcons {
  private cache = new Map<string, Promise<string | null>>();
  constructor(private binary: string) {}
  get(bundleId: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(bundleId))
      return Promise.resolve(null);
    const prior = this.cache.get(bundleId);
    if (prior) return prior;
    const work = promisify(execFile)(this.binary, ["--app-icon", bundleId], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    })
      .then(({ stdout }) => {
        const data = JSON.parse(stdout).data;
        return typeof data === "string" && /^[A-Za-z0-9+/=]+$/.test(data)
          ? `data:image/png;base64,${data}`
          : null;
      })
      .catch(() => null);
    if (this.cache.size >= 100)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(bundleId, work);
    return work;
  }
}
