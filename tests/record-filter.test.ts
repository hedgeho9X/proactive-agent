/** 验证原始记录按理解状态筛选，避免列表与计数口径不同。 */
import { expect, test } from "bun:test";
import { isUnprocessedRecord } from "../src/renderer/record-filter.ts";

test("待采集、待处理、理解中和未理解成功的失败记录保留", () => {
  for (const status of [
    undefined,
    "pending",
    "captured",
    "queued",
    "understanding",
    "failed",
    "skipped_busy",
  ])
    expect(isUnprocessedRecord({ status, detail: { axRecord: {} } })).toBe(
      true,
    );
});

test("理解完成后等待主 Agent、投递中、已投递、已跳过记录隐藏", () => {
  for (const status of ["ready", "delivering", "delivered", "filtered"])
    expect(isUnprocessedRecord({ status, detail: { axRecord: {} } })).toBe(
      false,
    );
  expect(
    isUnprocessedRecord({
      status: "failed",
      detail: { axRecord: {}, actionTitle: "已理解但投递失败" },
    }),
  ).toBe(false);
  expect(isUnprocessedRecord({ status: "queued" })).toBe(false);
});

test("理解结果到达后原始列表和计数同时减少", () => {
  const rows = [
    { status: "queued", detail: { axRecord: {}, actionTitle: "" } },
  ];
  expect(rows.filter(isUnprocessedRecord)).toHaveLength(1);
  rows[0] = {
    status: "ready",
    detail: { axRecord: {}, actionTitle: "打开文件" },
  };
  expect(rows.filter(isUnprocessedRecord)).toHaveLength(0);
});
