/** 设置的分组侧栏与内容容器；只组织界面，不读写业务配置。 */
import React, { useState, type ReactNode } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import {
  Cpu,
  SlidersHorizontal,
  FileText,
  Globe,
  ScanEye,
  MessageSquare,
  Wrench,
} from "lucide-react";
import { TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** 设置入口与分组，页面内容由宿主注入。 */
export const settingsSections = [
  {
    id: "models",
    group: "AI",
    label: "模型服务",
    description: "分别配置屏幕理解、主 Agent 和子 Agent。",
    icon: Cpu,
  },
  {
    id: "understanding",
    group: "AI",
    label: "理解与触发",
    description: "选择交给 Agent 的操作，以及理解并发数。",
    icon: SlidersHorizontal,
  },
  {
    id: "prompts",
    group: "AI",
    label: "提示词",
    description: "编辑三个角色的中文 Prompt。",
    icon: FileText,
  },
  {
    id: "search",
    group: "AI",
    label: "网页搜索",
    description: "配置可选的 Tavily 搜索与网页提取。",
    icon: Globe,
  },
  {
    id: "capture",
    group: "应用",
    label: "观察与权限",
    description: "选择观察范围，管理 macOS 采集权限。",
    icon: ScanEye,
  },
  {
    id: "danmaku",
    group: "应用",
    label: "桌面弹幕",
    description: "控制 Agent 在桌面展示的提醒。",
    icon: MessageSquare,
  },
  {
    id: "debug",
    group: "应用",
    label: "调试工具",
    description: "手动采集证据、运行合成演示或选择只读目录。",
    icon: Wrench,
  },
] as const;

/** 稳定的分类标识，避免配置内容遗漏或挂到错误分类。 */
export type SettingsSection = (typeof settingsSections)[number]["id"];

/** 已访问的内容保持挂载，分类切换不丢失尚未保存的表单。 */
export function SettingsNavigation({
  panels,
  footer,
}: {
  panels: Record<SettingsSection, ReactNode>;
  footer?: ReactNode;
}) {
  const [current, setCurrent] = useState<SettingsSection>("models");
  const [visited, setVisited] = useState<Set<SettingsSection>>(
    new Set(["models"]),
  );
  // 导航根不携带 group/tabs 样式，避免纵向规则影响右侧嵌套的横向模型页签。
  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={current}
      onValueChange={(value) => {
        const section = value as SettingsSection;
        setCurrent(section);
        setVisited((previous) => new Set([...previous, section]));
      }}
      className="flex min-h-0 flex-1 gap-0"
    >
      <aside className="w-40 shrink-0 overflow-y-auto border-r bg-muted/20 p-3 sm:w-48">
        <TabsList
          aria-label="设置分类"
          className="h-auto w-full flex-col items-stretch gap-1"
        >
          {settingsSections.map((section, index) => (
            <React.Fragment key={section.id}>
              {(index === 0 ||
                settingsSections[index - 1]?.group !== section.group) && (
                <p className="mb-1 mt-4 px-2 text-xs text-muted-foreground">
                  {section.group}
                </p>
              )}
              <TabsTrigger
                value={section.id}
                className="min-h-9 w-full flex-none justify-start"
              >
                <section.icon />
                {section.label}
              </TabsTrigger>
            </React.Fragment>
          ))}
        </TabsList>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {settingsSections
          .filter((section) => visited.has(section.id))
          .map((section) => (
            <TabsContent
              key={section.id}
              value={section.id}
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <header className="mb-6 flex flex-col gap-1">
                <h2 className="text-lg font-semibold">{section.label}</h2>
                <p className="text-sm text-muted-foreground">
                  {section.description}
                </p>
              </header>
              <div className="flex flex-col gap-5">{panels[section.id]}</div>
            </TabsContent>
          ))}
        {footer && <div className="mt-4">{footer}</div>}
      </div>
    </TabsPrimitive.Root>
  );
}
