/** 验证结果契约迁移不丢失新旧记录、长正文或原始换行。 */
import { expect, test } from "bun:test";
import { understandingResult } from "../src/model/understanding-result.ts";
import { trajectoryLine } from "../src/model/trajectory.ts";

test("优先新字段并兼容旧结果，不截断大段正文", () => {
  const description = "查看测试文档中有关检索流程的正文。".repeat(8);
  const detail = "第一段原文。\n第二段原文。\n".repeat(100);
  expect(understandingResult({ description, detail })).toEqual({
    description,
    detail,
  });
  expect(
    understandingResult({ action_title: description, action_detail: detail }),
  ).toEqual({ description, detail });
  expect(
    understandingResult({
      description,
      detail,
      action_title: "旧标题",
      action_detail: "旧详情",
    }),
  ).toEqual({ description, detail });
  expect(
    understandingResult({ description: " ", action_title: "旧标题" }),
  ).toEqual({ description: "旧标题", detail: "" });
  expect(understandingResult(null)).toEqual({ description: "", detail: "" });
});

test("新旧结果生成相同投递轨迹，不能把缺失结果当成功", () => {
  const action = { occurred_at: "2026-09-15T04:00:00.000Z" };
  const current = {
    description: "查看测试段落",
    detail: "原文第一行\n原文第二行",
  };
  const legacy = {
    action_title: current.description,
    action_detail: current.detail,
  };
  expect(trajectoryLine("fixture", action, current)).toBe(
    trajectoryLine("fixture", action, legacy),
  );
  expect(() => trajectoryLine("fixture", action, {})).toThrow(
    "action_summary_unavailable",
  );
});
