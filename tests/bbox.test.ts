import { test, expect } from "bun:test";
import { projectBBox } from "../src/renderer/bbox.ts";

test("bbox转换使用窗口坐标及比例，支持负坐标多屏、裁剪和无效输入", () => {
  expect(
    projectBBox(
      { x: 120, y: 80, width: 100, height: 40 },
      { x: 100, y: 40, width: 500, height: 200 },
    ),
  ).toEqual({ left: 4, top: 20, width: 20, height: 20, clipped: false });
  expect(
    projectBBox(
      { x: -900, y: 50, width: 200, height: 80 },
      { x: -1000, y: 10, width: 1000, height: 400 },
    ),
  ).toEqual({ left: 10, top: 10, width: 20, height: 20, clipped: false });
  expect(
    projectBBox(
      { x: 50, y: 20, width: 100, height: 60 },
      { x: 100, y: 40, width: 500, height: 200 },
    ),
  ).toEqual({ left: 0, top: 0, width: 10, height: 20, clipped: true });
  expect(
    projectBBox(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 100, width: 100, height: 100 },
    ),
  ).toBeNull();
  expect(
    projectBBox(undefined, { x: 0, y: 0, width: 1, height: 1 }),
  ).toBeNull();
  expect(
    projectBBox(
      { x: NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
    ),
  ).toBeNull();
  expect(
    projectBBox(
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
    ),
  ).toBeNull();
});
