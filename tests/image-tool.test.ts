import { expect, test } from "bun:test";
import { registerCapabilities } from "../src/model/tools.ts";
import { OpenAIAdapter } from "../src/model/openai.ts";
test("取图工具产出图片内容，OpenAI 请求不把附件引用当成图片", async () => {
  const registry = new Map<string, any>();
  const ref = {
    attachmentId: "fixture-ref",
    mediaType: "image/png",
    width: 1,
    height: 1,
    bytes: 7,
  };
  let saved: any;
  const ctx: any = {
    tools: { register: (tool: any) => registry.set(tool.name, tool) },
    attachments: {
      saveImage: async (input: any) => {
        saved = input.data;
        return ref;
      },
      readImage: async () => ({ ref, data: Buffer.from("fixture") }),
    },
  };
  registerCapabilities(
    ctx,
    {
      readEvidence: async (id, kind) => ({
        action_id: id,
        status: "available",
        imageBase64: Buffer.from("fixture").toString("base64"),
        imageHash: "source",
      }),
    },
    () => {},
  );
  const tool = registry.get("get_annotated_image");
  const result = await tool.execute({ action_id: "a" });
  expect(saved.toString()).toBe("fixture");
  const content = tool.output.render({}, result);
  expect(content[1].type).toBe("image");
  const adapter = new OpenAIAdapter(
    {
      protocol: "openai-compatible",
      model: "fixture",
      apiKey: "fixture",
      baseUrl: "https://example.com",
    },
    ctx,
    () => {},
  );
  const messages = await adapter.messages({
    messages: [
      {
        role: "user",
        content: [{ type: "tool-result", toolCallId: "call-1", content }],
      },
    ],
  } as any);
  expect(messages[0].role).toBe("tool");
  expect(messages[1].content[1].image_url.url).toBe(
    "data:image/png;base64," + Buffer.from("fixture").toString("base64"),
  );
});
