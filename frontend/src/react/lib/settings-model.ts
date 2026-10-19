import { sectionReadingPosition } from "@/react/lib/section-scroll";
import type { AppOs } from "@/react/lib/platform";
import type { ConfigSection, SettingsSection } from "@/react/state/session";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "look", label: "外观" },
  { id: "session", label: "会话" },
  { id: "board", label: "看板" },
  { id: "app", label: "应用" },
  { id: "backups", label: "备份" },
  { id: "config", label: "配置" },
  { id: "shortcuts", label: "热键" },
  { id: "about", label: "关于" },
];

/** Preserve the selected destination when restoring a retired configuration page. */
export function configSettingsRoute(section: ConfigSection, currentSettingsSection?: SettingsSection) {
  return {
    workspace: "remote" as const,
    settingsOpen: true,
    settingsSection: currentSettingsSection ?? (section === "backups" ? "backups" : "config"),
  };
}

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
  return sectionReadingPosition(sections, scrollTop, viewportHeight, scrollHeight, pointerOffset, "look");
}
