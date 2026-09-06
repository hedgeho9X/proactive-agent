import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
// 统一合并组件变体与布局类名。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
