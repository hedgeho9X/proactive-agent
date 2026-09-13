/** 搜索凭证表单仅负责提交显式设置，不请求搜索或回显已保存的 Key。 */
import { useState } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** 使用主进程的加密配置入口，保存成功后清空输入框中的凭证。 */
export function SearchSettings({
  hasKey,
  save,
}: {
  hasKey: boolean;
  save: (method: string, params: unknown) => Promise<boolean>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  /** 显式保存或清除搜索凭证，成功后移除表单中的明文。 */
  const update = async (value: string) => {
    setBusy(true);
    setNotice("");
    try {
      if (await save("web.config", { apiKey: value })) {
        setKey("");
        setNotice(value ? "搜索 Key 已加密保存" : "搜索 Key 已清除");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void update(key);
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="tavily-key">
            Agentic Understanding · Tavily Search / Extract
          </FieldLabel>
          <Input
            id="tavily-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              hasKey
                ? "已配置；输入新 Key 可替换"
                : "未配置；本地取证工具仍可使用"
            }
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !key.trim()}>
            保存搜索 Key
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !hasKey}
            onClick={() => void update("")}
          >
            清除搜索 Key
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {notice ||
            "理解 Agent 可按需搜索和读取网页；调用会消耗 Tavily 额度。focus 表示希望提取的主题。"}
        </p>
      </FieldGroup>
    </form>
  );
}
