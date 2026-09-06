import { readFile, writeFile } from "node:fs/promises";
export type ModelRole = "understanding" | "main" | "subagent";
export interface RoleModelConfig {
  protocol: "gemini" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxCalls?: number;
}
export const roles: ModelRole[] = ["understanding", "main", "subagent"];
export class ModelRoles {
  private values: Record<ModelRole, RoleModelConfig> = Object.fromEntries(
    roles.map((role) => [
      role,
      {
        protocol: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "",
        model: "gemini-3.8-flash",
        maxCalls: 30,
      },
    ]),
  ) as any;
  readonly status: Record<ModelRole, string> = {
    understanding: "unavailable",
    main: "unavailable",
    subagent: "unavailable",
  };
  constructor(private file: string) {}
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      for (const role of roles)
        if (saved[role])
          this.values[role] = {
            ...this.values[role],
            ...saved[role],
            apiKey: "",
          };
    } catch {}
  }
  get(role: ModelRole) {
    return this.values[role].apiKey ? { ...this.values[role] } : undefined;
  }
  snapshot() {
    return Object.fromEntries(
      roles.map((role) => {
        const { apiKey, ...config } = this.values[role];
        return [
          role,
          { ...config, hasKey: !!apiKey, status: this.status[role] },
        ];
      }),
    );
  }
  async update(role: ModelRole, input: Partial<RoleModelConfig>) {
    if (!roles.includes(role)) throw new Error("invalid_model_role");
    const next = { ...this.values[role] };
    for (const key of [
      "protocol",
      "baseUrl",
      "apiKey",
      "model",
      "maxCalls",
    ] as const)
      if (input[key] !== undefined) (next as any)[key] = input[key];
    const url = new URL(next.baseUrl);
    if (
      !["gemini", "openai-compatible"].includes(next.protocol) ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !next.model?.trim() ||
      next.model.length > 200
    )
      throw new Error("invalid_model_config");
    next.baseUrl = next.baseUrl.replace(/\/$/, "");
    next.maxCalls = Math.max(1, Math.min(1000, Number(next.maxCalls) || 30));
    this.values[role] = next;
    this.status[role] = next.apiKey ? "configured_unverified" : "unavailable";
    await writeFile(
      this.file,
      JSON.stringify(
        Object.fromEntries(
          roles.map((role) => {
            const { apiKey, ...publicConfig } = this.values[role];
            return [role, publicConfig];
          }),
        ),
      ),
    );
    return this.snapshot();
  }
}
