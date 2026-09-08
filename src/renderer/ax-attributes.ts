export function attributeText(node: any, name: string): string {
  const value = node.attributes?.[name]?.value;
  return typeof value === "string"
    ? value
    : (value?.text ?? (typeof value === "number" ? String(value) : ""));
}
