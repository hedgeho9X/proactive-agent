/** 以合成 IPC 挂载真实应用，验证设置分类，不启动采集器或请求模型。 */
const roles = Object.fromEntries(
  ["understanding", "main", "subagent"].map((role) => [
    role,
    {
      protocol: "openai-compatible",
      baseUrl: "https://example.com/v1",
      model: `${role}-fixture`,
      hasKey: false,
    },
  ]),
);
const state: any = {
  actions: [],
  events: [],
  activities: [],
  queue: [],
  collector: { state: "stopped", permissions: {} },
  mode: "unavailable",
  modelRoles: roles,
  aiConcurrency: 10,
  prompts: {
    understanding: "理解规则 fixture",
    main: "主 Agent 规则 fixture",
    subagent: "子 Agent 规则 fixture",
  },
  webSearch: { hasKey: false },
  routing: ["enter", "space", "click"],
};
(window as any).settingsFixtureCalls = [];
(window as any).proactive = {
  subscribe: () => () => {},
  onWindowBlur: () => () => {},
  async invoke(method: string, params: any = {}) {
    (window as any).settingsFixtureCalls.push({ method, role: params.role });
    if (method === "ax.history") return [];
    if (method === "ax.apps") return { apps: [] };
    if (method === "prompts.update") state.prompts[params.role] = params.value;
    if (method === "ai.concurrency") state.aiConcurrency = params.value;
    if (method === "config")
      state.modelRoles[params.role] = {
        ...params.config,
        apiKey: undefined,
        hasKey: !!params.config.apiKey,
      };
    return structuredClone(state);
  },
};
void import("../src/renderer/app.tsx");
