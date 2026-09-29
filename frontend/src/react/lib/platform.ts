/**
 * 平台判断的唯一出口（DESIGN.md §8.2 / §10.4）。
 * 业务代码禁止再直接读 navigator.platform / userAgent，统一从这里引入。
 */

/** 真实运行平台：mac / win / linux（窗控、快捷键文案按此判断）。 */
export type AppOs = "mac" | "win" | "linux";

/** 运行期间平台不会变，判断一次后缓存。 */
let cachedOs: AppOs | null = null;

export function detectAppOs(): AppOs {
  if (cachedOs) return cachedOs;

  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad/.test(platform)) {
    cachedOs = "mac";
  } else if (/Win/.test(platform) || /Windows/.test(ua)) {
    cachedOs = "win";
  } else {
    // Linux / Android / ChromeOS 等非 Windows 桌面，统一标 linux；
    // 未知非 mac 平台同样走 linux 分支（frameless，自绘窗控）。
    cachedOs = "linux";
  }
  return cachedOs;
}

export function isMacPlatform(): boolean {
  return detectAppOs() === "mac";
}

export function isWindowsPlatform(): boolean {
  return detectAppOs() === "win";
}

/** 只需要读修饰键，原生事件与 React 合成事件都能传。 */
type ModifierEvent = { metaKey: boolean; ctrlKey: boolean };

/**
 * 是否按下了「主修饰键」：Mac 用 ⌘（且没按 Ctrl），其他平台用 Ctrl（且没按 ⌘）。
 * 用于多选、快捷键等需要区分平台的判断。
 */
export function isPrimaryModifier(event: ModifierEvent): boolean {
  if (isMacPlatform()) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}

/**
 * 快捷键展示文案：Mac 返回 `⌘F`，其他平台返回 `Ctrl+F`。
 * key 传按键本身，如 "F"、"B"、","。
 */
export function shortcutLabel(key: string): string {
  if (isMacPlatform()) {
    return `⌘${key}`;
  }
  return `Ctrl+${key}`;
}
