/** 验证搜索协议、结果限量和错误脱敏，不访问线上服务。 */
import { expect, test } from "bun:test";
import {
  WebResearch,
  validatePublicUrl,
} from "../src/understanding/web-research.ts";

test("未配置 Key 不联网；搜索返回片段而非生成答案", async () => {
  let calls = 0;
  const transport: typeof fetch = (async (url: any, init: any) => {
    calls++;
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.headers.Authorization).toBe("Bearer fixture-key");
    expect(JSON.parse(init.body).include_answer).toBe(false);
    return Response.json({
      answer: "不要使用",
      results: [
        {
          title: "论文",
          url: "https://example.com",
          content: "x".repeat(5000),
        },
      ],
    });
  }) as any;
  await expect(
    new WebResearch(() => undefined, transport).search("test"),
  ).rejects.toThrow("not_configured");
  expect(calls).toBe(0);
  const result = await new WebResearch(() => "fixture-key", transport).search(
    "test",
  );
  expect(result.results[0].content).toHaveLength(1200);
  expect(JSON.stringify(result)).not.toContain("不要使用");
});

test("HTTP 错误脱敏，拒绝本机和内网URL", async () => {
  const web = new WebResearch(
    () => "fixture",
    (async () => new Response("secret-upstream", { status: 401 })) as any,
  );
  await expect(web.search("test")).rejects.toThrow("web_http_401");
  for (const url of [
    "file:///etc/passwd",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://a.internal",
  ])
    await expect(validatePublicUrl(url)).rejects.toThrow();
});

test("网页提取传递 focus 并标记正文截断，不读取整页进入上下文", async () => {
  const web = new WebResearch(() => "fixture", (async (url: any, init: any) => {
    expect(url).toBe("https://api.tavily.com/extract");
    expect(JSON.parse(init.body)).toMatchObject({
      query: "核心方法",
      chunks_per_source: 3,
      urls: ["https://8.8.8.8/"],
    });
    return Response.json({
      results: [{ url: "https://8.8.8.8/", raw_content: "x".repeat(9000) }],
    });
  }) as any);
  const result = await web.extract("https://8.8.8.8", "核心方法");
  expect(result.content).toHaveLength(8000);
  expect(result.truncated).toBe(true);
});
