/** 将模型步骤转换为本地追踪对象，图片只存哈希引用以免重复复制大字符串。 */
import { createHash } from "node:crypto";

/** 保留消息文本和工具参数，二进制及图片字段用摘要替代。 */
export function traceValue(value: any, key = ""): any {
  if (
    value instanceof Uint8Array ||
    (typeof value === "string" &&
      (key === "image" || value.startsWith("data:image/")))
  ) {
    return {
      kind: "image_reference",
      sha256: createHash("sha256").update(value).digest("hex"),
      size: value.length,
    };
  }
  if (Array.isArray(value)) return value.map((item) => traceValue(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([name]) => !["headers", "apiKey"].includes(name))
        .map(([name, item]) => [name, traceValue(item, name)]),
    );
  return value;
}
