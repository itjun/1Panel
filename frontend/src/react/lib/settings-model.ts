import type { AppOs } from "@/react/lib/platform";
import type { SettingsSection } from "@/react/state/session";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: "look", label: "外观", hint: "调整主题与字体" },
  { id: "session", label: "会话", hint: "控制启动后的打开内容" },
  { id: "board", label: "看板", hint: "配置内网看板访问" },
  { id: "app", label: "应用", hint: "管理本机与应用行为" },
  { id: "shortcuts", label: "快捷键", hint: "查看当前系统的常用快捷键" },
  { id: "about", label: "关于", hint: "版本、更新与相关链接" },
];

export const PLATFORM_SETTINGS = {
  mac: { name: "macOS", sans: "SF Pro / 苹方", mono: "SF Mono / Menlo" },
  win: { name: "Windows", sans: "Segoe UI / 微软雅黑", mono: "Cascadia Mono / Consolas" },
  linux: { name: "Linux", sans: "系统界面字体", mono: "系统等宽字体" },
} satisfies Record<AppOs, { name: string; sans: string; mono: string }>;

export function settingsShortcuts(os: AppOs) {
  const mac = os === "mac";
  return [
    { label: "展开 / 收起侧栏", keys: mac ? ["⌘ B", "⌘ \\"] : ["Ctrl+B", "Ctrl+\\"] },
    { label: "打开设置", keys: mac ? ["⌘ ,"] : ["Ctrl+,"] },
    { label: "后退", keys: mac ? ["⌘ [", "⌘ ←"] : ["Alt+←"] },
    { label: "前进", keys: mac ? ["⌘ ]", "⌘ →"] : ["Alt+→"] },
  ];
}

export function showWindowMaterial(os: AppOs, desktop: boolean, supported: boolean) {
  return os === "win" && desktop && supported;
}

/** Section offsets are relative to the scroll container, not the window. */
export function settingsReadingSection(
  sections: { id: SettingsSection; top: number }[],
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  pointerOffset: number | null,
): SettingsSection {
  // Keyboard/touch reading should reach the final section at the scroll limit;
  // an actual pointer still identifies its own module anywhere in the viewport.
  if (pointerOffset === null && scrollHeight > viewportHeight + 2 && scrollTop + viewportHeight >= scrollHeight - 2) {
    return sections[sections.length - 1]?.id ?? "look";
  }
  const readingLine = scrollTop + Math.max(0, Math.min(pointerOffset ?? 96, viewportHeight - 1));
  let current: SettingsSection = "look";
  for (const section of sections) {
    if (section.top > readingLine) break;
    current = section.id;
  }
  return current;
}
