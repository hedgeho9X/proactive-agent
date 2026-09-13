/** 为一次理解建立有时间边界的只读证据视图，不触发采集或历史重理解。 */
import { resolveAppInfo } from "../model/app-info.ts";
import { projectVisualEvidence } from "../model/understanding-evidence.ts";

/** 索引行只包含查询所需的元数据与摘要，不携带图片或完整 AX。 */
export interface EvidenceRow {
  id: string;
  time: string;
  app: { bundle_id?: string; name?: string };
  sequence?: number;
  session?: string;
  window_id?: number;
  title?: string;
  status?: string;
}
/** 宿主提供本应用的数据访问，工具服务不依赖 SQLite 或 Electron。 */
export interface EvidenceSource {
  list(): Promise<EvidenceRow[]>;
  read(id: string): Promise<any>;
  result(id: string): any;
}

/** 有界文本结果保留截断标记，原始内容仍可在本机追踪查看。 */
export function bounded(value: unknown, maxChars = 12000) {
  const content = JSON.stringify(value ?? null);
  return {
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars,
  };
}

/** 固定本次可见的动作集合，所有按 ID 取证都先校验时间边界。 */
export class EvidenceSession {
  private constructor(
    private source: EvidenceSource,
    readonly anchor: EvidenceRow,
    readonly rows: EvidenceRow[],
  ) {}

  /** 以当前动作和采集序号限定历史，不接受模型扩大时间上界。 */
  static async create(source: EvidenceSource, anchor: EvidenceRow) {
    const time = Date.parse(anchor.time);
    if (!Number.isFinite(time)) throw new Error("invalid_action_time");
    const rows = (await source.list())
      .filter((row) => {
        if (row.id === anchor.id) return true;
        const at = Date.parse(row.time);
        if (at < time) return true;
        return (
          at === time &&
          row.session === anchor.session &&
          row.session !== undefined &&
          row.sequence !== undefined &&
          anchor.sequence !== undefined &&
          row.sequence < anchor.sequence
        );
      })
      .map((row) => structuredClone(row));
    if (!rows.some((row) => row.id === anchor.id))
      rows.push(structuredClone(anchor));
    rows.sort(
      (a, b) =>
        Date.parse(b.time) - Date.parse(a.time) ||
        (b.sequence ?? 0) - (a.sequence ?? 0) ||
        a.id.localeCompare(b.id),
    );
    return new EvidenceSession(source, anchor, rows);
  }

  /** 返回标题级索引，最多 50 条，支持应用、窗口和时间下界过滤。 */
  list({
    limit = 10,
    offset = 0,
    app,
    window_id,
    since,
  }: {
    limit?: number;
    offset?: number;
    app?: string;
    window_id?: number;
    since?: string;
  } = {}) {
    const rows = this.rows.filter(
      (row) =>
        row.id !== this.anchor.id &&
        (!app || row.app.bundle_id === app) &&
        (window_id === undefined || row.window_id === window_id) &&
        (!since || Date.parse(row.time) >= Date.parse(since)),
    );
    const count = Math.max(1, Math.min(50, Math.trunc(limit))),
      start = Math.max(0, Math.trunc(offset));
    return {
      records: rows.slice(start, start + count),
      next_offset: start + count < rows.length ? start + count : null,
      cutoff: this.anchor.time,
    };
  }

  /** 预载全局及同应用近十条标题，去重后保持时间顺序。 */
  initial() {
    const global = this.list().records;
    const same = this.anchor.app.bundle_id
      ? this.list({ app: this.anchor.app.bundle_id }).records
      : [];
    return [
      ...new Map([...global, ...same].map((row) => [row.id, row])).values(),
    ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  }

  /** 查指定 ID，拒绝当前边界之外的动作。 */
  private row(id: string) {
    const row = this.rows.find((row) => row.id === id);
    if (!row) throw new Error("action_outside_context_boundary");
    return row;
  }

  /** 读取当前或历史证据，保护标记优先于工具输出。 */
  async get(
    id: string,
    part: "detail" | "ax" | "ocr" | "image",
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const row = this.row(id);
    const item = await this.source.read(id);
    signal?.throwIfAborted();
    if (
      item.evidence?.some((e: any) => e.status === "excluded") ||
      item.action?.policy_status === "excluded"
    )
      return { status: "excluded", action_id: id };
    // 未完成理解的记录不等待其他工作线程，避免理解队列互相阻塞。
    const result = row.title ? this.source.result(id) : null;
    if (part === "detail")
      return {
        action_id: id,
        ...bounded({
          ...row,
          detail: result?.result?.action_detail ?? null,
          event: item.action,
          evidence: item.evidence,
        }),
      };
    if (part === "ax")
      return {
        action_id: id,
        ...bounded(
          projectVisualEvidence(
            item.artifacts?.ax?.payload?.content,
            item.artifacts?.screenshot?.payload?.content,
            null,
          ),
        ),
      };
    if (part === "ocr") {
      let ocr =
        result?.debug?.promptInput?.ocr ??
        item.artifacts?.ocr?.payload?.content;
      if (!ocr && result?.debug?.userPrompt) {
        try {
          ocr = JSON.parse(result.debug.userPrompt).artifacts?.ocr?.payload
            ?.content;
        } catch {}
      }
      return {
        action_id: id,
        status: ocr ? "available" : "unavailable",
        ...bounded(ocr),
      };
    }
    const image = item.artifacts?.screenshot?.bytes;
    if (!image || image.length > 12 * 1024 * 1024)
      return { status: "unavailable", action_id: id };
    return {
      status: "available",
      action_id: id,
      image,
      image_kind: "captured_original",
      captured_at: item.artifacts.screenshot.captured,
    };
  }

  /** 只为本次可见动作涉及的应用提供背景知识。 */
  appInfo(bundle_id: string) {
    if (!this.rows.some((row) => row.app.bundle_id === bundle_id))
      return { status: "unavailable" };
    return resolveAppInfo({ bundle_id });
  }
}
