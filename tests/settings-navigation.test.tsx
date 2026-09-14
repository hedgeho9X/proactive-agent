/** 设置分类初始只挂载当前内容，提示词与并发不再混放。 */
import { test, expect } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SettingsNavigation,
  settingsSections,
  type SettingsSection,
} from "../src/renderer/settings-navigation.tsx";
import { PromptSettings } from "../src/renderer/prompt-settings.tsx";

test("七个分类分两组，初始只挂载模型内容", () => {
  const panels = Object.fromEntries(
    settingsSections.map((section) => [
      section.id,
      <p>{`panel-${section.id}`}</p>,
    ]),
  ) as Record<SettingsSection, React.ReactNode>;
  const html = renderToStaticMarkup(<SettingsNavigation panels={panels} />);
  expect(settingsSections).toHaveLength(7);
  expect(new Set(settingsSections.map((section) => section.group)).size).toBe(
    2,
  );
  expect(html).toContain('aria-orientation="vertical"');
  expect(html).toContain("panel-models");
  expect(html).not.toContain("panel-capture");
  expect(html).not.toContain("panel-search");
});

test("提示词页不含并发输入，并发页不含提示词", () => {
  const props = {
    values: { understanding: "fixture prompt" },
    concurrency: 10,
    save: async () => true,
  };
  const prompts = renderToStaticMarkup(<PromptSettings {...props} />);
  expect(prompts).toContain("fixture prompt");
  expect(prompts).not.toContain('id="ai-concurrency"');
  const concurrency = renderToStaticMarkup(
    <PromptSettings {...props} section="concurrency" />,
  );
  expect(concurrency).toContain('id="ai-concurrency"');
  expect(concurrency).not.toContain("fixture prompt");
});
