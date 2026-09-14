/** 验证取证工具名称、预算、图像输出和隔离边界，不请求模型或网络。 */
import { expect, test } from "bun:test";
import { EvidenceSession } from "../src/understanding/evidence-session.ts";
import { createUnderstandingTools } from "../src/understanding/tools.ts";

test("工具拒绝未来ID、限制图片次数并输出真实图片内容块", async () => {
  const anchor = { id: "now", time: new Date(1000).toISOString(), app: {} };
  const session = await EvidenceSession.create(
    {
      list: async () => [],
      read: async () => ({
        action: {},
        evidence: [],
        artifacts: { screenshot: { bytes: "aW1hZ2U=" } },
      }),
      result: () => null,
    },
    anchor,
  );
  const traces: any[] = [],
    tools = createUnderstandingTools(session, undefined, traces) as any;
  expect(tools.get_action_detail).toBeDefined();
  expect(tools.web_search).toBeUndefined();
  expect(tools.get_action_ocr).toBeUndefined();
  const options = { toolCallId: "fixture", messages: [] };
  expect(
    await tools.get_action_detail.execute({ action_id: "future" }, options),
  ).toMatchObject({
    status: "error",
    reason: "action_outside_context_boundary",
  });
  const output = await tools.get_action_image.execute(
    { action_id: "now" },
    options,
  );
  const modelOutput = tools.get_action_image.toModelOutput({ output });
  expect(modelOutput.value[1]).toMatchObject({
    type: "file",
    data: { type: "data", data: "aW1hZ2U=" },
    mediaType: "image/png",
  });
  await tools.get_action_image.execute({ action_id: "now" }, options);
  expect(
    await tools.get_action_image.execute({ action_id: "now" }, options),
  ).toMatchObject({ reason: "understanding_image_budget_exhausted" });
  expect(JSON.stringify(traces)).not.toContain("aW1hZ2U=");
  for (let i = 0; i < 4; i++) await tools.list_actions.execute({}, options);
  expect(await tools.list_actions.execute({}, options)).toMatchObject({
    reason: "understanding_tool_budget_exhausted",
  });
});
