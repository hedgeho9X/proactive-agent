import { readFile, writeFile, rename } from "node:fs/promises";
import { defaultRouting, routingOptions } from "./routing-policy.ts";
export class RoutingStore {
  private selected = [...defaultRouting];
  constructor(private file: string) {}
  get() {
    return [...this.selected];
  }
  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (
        Array.isArray(value.triggers) &&
        value.triggers.every((id: any) =>
          routingOptions.some((option) => option.id === id),
        )
      )
        this.selected = [...new Set<string>(value.triggers)];
    } catch {}
  }
  async update(value: unknown) {
    if (
      !Array.isArray(value) ||
      !value.every((id) => routingOptions.some((option) => option.id === id))
    )
      throw new Error("invalid_routing_policy");
    const selected = [...new Set<string>(value)];
    await writeFile(
      this.file + ".next",
      JSON.stringify({ triggers: selected }),
      { mode: 0o600 },
    );
    await rename(this.file + ".next", this.file);
    this.selected = selected;
    return this.get();
  }
}
