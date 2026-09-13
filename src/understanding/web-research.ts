/** Tavily 搜索和正文提取服务；不直接访问目标网页，不返回鉴权或原始错误正文。 */
import { isIP, BlockList } from "node:net";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";

const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  blockedV6.addSubnet(ip, prefix, "ipv6");

/** 拒绝带凭证、非 HTTPS、本机及内网 URL，再交给外部提取服务。 */
export async function validatePublicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    /\.(local|internal|localhost)$/.test(host)
  )
    throw new Error("web_url_not_public");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) =>
      item.family === 6
        ? blockedV6.check(item.address, "ipv6")
        : blocked.check(item.address, "ipv4"),
    )
  )
    throw new Error("web_url_not_public");
  url.hash = "";
  return url.href;
}

/** 通过固定 Tavily API 提供有界搜索与网页正文，Key 缺失时不发送请求。 */
export class WebResearch {
  /** 使用凭证 getter 便于设置变更，transport 仅用于协议测试。 */
  constructor(
    private key: () => string | undefined,
    private transport: typeof fetch = fetch,
  ) {}
  /** 暴露可用状态，不暴露凭证。 */
  available() {
    return !!this.key();
  }
  /** 发起有大小和时间上限的 API 请求；禁止重定向携带鉴权。 */
  private async request(endpoint: string, body: unknown, signal?: AbortSignal) {
    const key = this.key();
    if (!key) throw new Error("web_provider_not_configured");
    const response = await this.transport(
      `https://api.tavily.com/${endpoint}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`web_http_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("web_empty_response");
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2_000_000) throw new Error("web_response_too_large");
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return JSON.parse(text + decoder.decode());
  }
  /** 搜索只返回来源片段，不采用供应商生成的答案作为事实。 */
  async search(query: string, signal?: AbortSignal) {
    const result = await this.request(
      "search",
      {
        query: query.slice(0, 500),
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      },
      signal,
    );
    return {
      retrieved_at: new Date().toISOString(),
      results: (result.results ?? [])
        .slice(0, 5)
        .map((item: any, index: number) => ({
          source_id: createHash("sha256")
            .update(String(item.url ?? index))
            .digest("hex")
            .slice(0, 16),
          title: String(item.title ?? "").slice(0, 300),
          url: item.url,
          content: String(item.content ?? "").slice(0, 1200),
        })),
    };
  }
  /** focus 是正文提取关注点；原网页时间与获取时间不等于动作时间。 */
  async extract(url: string, focus?: string, signal?: AbortSignal) {
    if (!this.available()) throw new Error("web_provider_not_configured");
    const target = await validatePublicUrl(url);
    const result = await this.request(
      "extract",
      {
        urls: [target],
        format: "markdown",
        ...(focus ? { query: focus.slice(0, 500), chunks_per_source: 3 } : {}),
      },
      signal,
    );
    const item = result.results?.[0];
    if (!item || typeof item.raw_content !== "string")
      throw new Error("web_extract_failed");
    return {
      url: target,
      source_id: createHash("sha256").update(target).digest("hex").slice(0, 16),
      source_url: item.url,
      retrieved_at: new Date().toISOString(),
      content: item.raw_content.slice(0, 8000),
      truncated: item.raw_content.length > 8000,
    };
  }
}
