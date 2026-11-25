import type { AppOs } from "@/react/lib/platform";

export const SETTINGS_SECTIONS = [
  { id: "look", label: "外观" },
  { id: "board", label: "看板" },
  { id: "app", label: "应用" },
  { id: "shortcuts", label: "热键" },
  { id: "about", label: "关于" },
] as const;

export const PLATFORM_SETTINGS = {
  mac: { name: "macOS", sans: "SF Pro / 苹方", mono: "SF Mono / Menlo" },
  win: { name: "Windows", sans: "Segoe UI / 微软雅黑", mono: "Cascadia Mono / Consolas" },
  linux: { name: "Linux", sans: "系统界面字体", mono: "系统等宽字体" },
} satisfies Record<AppOs, { name: string; sans: string; mono: string }>;

export function settingsShortcuts(os: AppOs) {
  const mac = os === "mac";
  return [
    { label: "打开设置", keys: mac ? ["⌘ ,"] : ["Ctrl+,"] },
    { label: "重新载入当前页面", keys: mac ? ["⌘ R"] : ["Ctrl+R"] },
    { label: "打开远程主机", keys: mac ? ["⌘ O"] : ["Ctrl+O"] },
    { label: "切换已打开主机", keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"] },
  ];
}
