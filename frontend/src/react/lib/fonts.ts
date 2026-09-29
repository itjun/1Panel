/**
 * 字体选项（DESIGN.md §3.1）：应用不再自带字体，默认用系统字体栈；
 * 设置页按当前系统（lib/platform.ts detectAppOs）只列出这个系统上有的字体。
 *
 * 值的约定：
 * - ""            = 系统默认，不写覆盖变量，globals.css 回落到 --font-sans / --font-mono 的栈
 * - 具体字体 / 自定义 = `"字体名", <系统后备栈>`，本机没装这款字体时也不会显示成乱码
 */
import { detectAppOs, type AppOs } from "@/react/lib/platform";

export type FontKind = "sans" | "mono";

export type FontOption = { label: string; value: string };

/** 与 globals.css 里 --font-sans 的栈保持一致（Mac 优先，后面接 Windows / Linux 的字体） */
export const SYSTEM_SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Helvetica Neue", Arial, system-ui, sans-serif';

/** 与 globals.css 里 --font-mono 回落值的栈保持一致 */
export const SYSTEM_MONO_STACK =
  'ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono CJK SC", monospace';

function systemStack(kind: FontKind): string {
  if (kind === "mono") {
    return SYSTEM_MONO_STACK;
  }
  return SYSTEM_SANS_STACK;
}

/**
 * 把字体名（可含多个，逗号分隔，如 `"Helvetica Neue", "PingFang SC"`）补上系统后备栈。
 * 传空串直接返回空串（= 系统默认）。
 */
export function fontValueWithFallback(names: string, kind: FontKind): string {
  const trimmed = names.trim();
  if (!trimmed) {
    return "";
  }
  return `${trimmed}, ${systemStack(kind)}`;
}

/**
 * 用户手填的字体名转成可存储的值：名字里带空格就加引号，再补系统后备栈。
 * 例如 `Maple Mono NF CN` → `"Maple Mono NF CN", ui-monospace, ...`
 */
export function customFontValue(name: string, kind: FontKind): string {
  let trimmed = name.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) {
    return "";
  }
  if (/\s/.test(trimmed)) {
    trimmed = `"${trimmed}"`;
  }
  return fontValueWithFallback(trimmed, kind);
}

/**
 * 从存储值里还原用户手填的字体名，用于回填输入框：
 * 去掉末尾的系统后备栈，再去掉外层引号。
 */
export function customFontName(value: string, kind: FontKind): string {
  const suffix = `, ${systemStack(kind)}`;
  let name = value;
  if (name.endsWith(suffix)) {
    name = name.slice(0, -suffix.length);
  }
  return name.trim().replace(/^["']|["']$/g, "");
}

/** 各系统的界面字体选项；第一项固定是系统默认（值为空串） */
const SANS_OPTIONS: Record<AppOs, FontOption[]> = {
  mac: [
    { label: "系统默认（SF + 苹方）", value: "" },
    { label: "苹方", value: fontValueWithFallback('"PingFang SC"', "sans") },
    { label: "冬青黑体", value: fontValueWithFallback('"Hiragino Sans GB"', "sans") },
    {
      label: "Helvetica Neue + 苹方",
      value: fontValueWithFallback('"Helvetica Neue", "PingFang SC"', "sans"),
    },
  ],
  win: [
    { label: "系统默认（Segoe UI + 微软雅黑）", value: "" },
    { label: "微软雅黑", value: fontValueWithFallback('"Microsoft YaHei"', "sans") },
    { label: "等线", value: fontValueWithFallback("DengXian", "sans") },
  ],
  linux: [
    { label: "系统默认", value: "" },
    { label: "Noto Sans CJK SC", value: fontValueWithFallback('"Noto Sans CJK SC"', "sans") },
    { label: "文泉驿微米黑", value: fontValueWithFallback('"WenQuanYi Micro Hei"', "sans") },
  ],
};

/** 各系统的等宽字体选项；第一项固定是系统默认（值为空串） */
const MONO_OPTIONS: Record<AppOs, FontOption[]> = {
  mac: [
    { label: "系统默认（SF Mono）", value: "" },
    { label: "Menlo", value: fontValueWithFallback("Menlo", "mono") },
    { label: "Monaco", value: fontValueWithFallback("Monaco", "mono") },
  ],
  win: [
    { label: "系统默认", value: "" },
    { label: "Cascadia Mono", value: fontValueWithFallback('"Cascadia Mono"', "mono") },
    { label: "Consolas", value: fontValueWithFallback("Consolas", "mono") },
  ],
  linux: [
    { label: "系统默认", value: "" },
    { label: "DejaVu Sans Mono", value: fontValueWithFallback('"DejaVu Sans Mono"', "mono") },
    {
      label: "Noto Sans Mono CJK SC",
      value: fontValueWithFallback('"Noto Sans Mono CJK SC"', "mono"),
    },
  ],
};

/** 当前系统的字体选项（不含「自定义…」，那一项由设置页自己画） */
export function fontOptions(kind: FontKind): FontOption[] {
  const os = detectAppOs();
  if (kind === "mono") {
    return MONO_OPTIONS[os];
  }
  return SANS_OPTIONS[os];
}

/** 存储值是否在当前系统的选项列表里；不在就是用户手填的「自定义」 */
export function isPresetFont(value: string, kind: FontKind): boolean {
  return fontOptions(kind).some((option) => option.value === value);
}
