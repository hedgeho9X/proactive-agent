/** 分开展示提示词与并发配置；保存继续使用既有设置接口。 */
import React, { useEffect, useState } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
/** 编辑单一角色的提示词，保存时不影响其他角色的草稿。 */
function PromptField({
  role,
  value,
  save,
}: {
  role: string;
  value: string;
  save: (method: string, args: any) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <Field>
      <FieldLabel htmlFor={`prompt-${role}`}>
        {
          (
            {
              understanding: "屏幕理解",
              main: "主 Agent",
              subagent: "子 Agent",
            } as any
          )[role]
        }{" "}
        Prompt
      </FieldLabel>
      <Textarea
        id={`prompt-${role}`}
        value={draft}
        className="max-h-96 min-h-40"
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={saving || !draft.trim() || draft === value}
        onClick={async () => {
          setSaving(true);
          await save("prompts.update", { role, value: draft });
          setSaving(false);
        }}
      >
        保存中文 Prompt
      </Button>
    </Field>
  );
}
/** 根据所在分类展示提示词或并发设置，维持各自的本地草稿。 */
export function PromptSettings({
  values,
  concurrency,
  save,
  section = "prompts",
}: {
  values: any;
  concurrency: number;
  save: (method: string, args: any) => Promise<boolean>;
  section?: "prompts" | "concurrency";
}) {
  const [parallel, setParallel] = useState(concurrency);
  return (
    <FieldGroup>
      {section === "prompts" && (
        <p className="text-xs text-muted-foreground">
          理解 Prompt 仅影响后续请求；修改主／子 Agent Prompt
          会重启运行时并保留会话。框架内置的协议说明不在此编辑。
        </p>
      )}
      {section === "concurrency" && (
        <Field>
          <FieldLabel htmlFor="ai-concurrency">
            AI 理解并发（1–20，默认 10）
          </FieldLabel>
          <Input
            id="ai-concurrency"
            type="number"
            min={1}
            max={20}
            value={parallel}
            onChange={(event) => setParallel(Number(event.target.value))}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => save("ai.concurrency", { value: parallel })}
          >
            保存并发
          </Button>
        </Field>
      )}
      {section === "prompts" &&
        values &&
        Object.keys(values).map((role) => (
          <PromptField
            key={role}
            role={role}
            value={values[role]}
            save={save}
          />
        ))}
    </FieldGroup>
  );
}
