/**
 * 窗口控制、拖动行为与打开设置快捷键。
 * 窗口右上角（非 macOS）：最小化、最大化/还原、关闭。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Window } from "@wailsio/runtime";
import { useSession } from "@/react/state/session";
import { isMacPlatform } from "@/react/lib/platform";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable='true'], .xterm, .cm-editor");
}

/** 顶栏里这些元素的双击交给自身（按钮/输入框/终端），不触最大化。 */
const TOOLBAR_INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, label, [role='button'], [role='tab'], .xterm, .cm-editor";

/**
 * Linux frameless：GTK 拖动区只认拖动，没有原生「双击标题栏最大化/还原」，补上。
 * Win 走 NC 区命中（HTCAPTION）、mac 走系统标题栏双击偏好，都不装这个监听。
 * 用 window 捕获阶段的原生监听而不是 header 上的 React onDoubleClick：顶栏
 * 右侧槽位的内容经 portal 渲染，React 合成事件在这条路径上收不到（实测），
 * 原生捕获监听稳定。
 */
export function useToolbarDoubleClickMaximize(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".shell-app-toolbar, .workspace-rail-heading, .module-rail-drag, .uiux-page-tools, .settings-header")) return;
      if (target.closest(TOOLBAR_INTERACTIVE_SELECTOR)) return;
      void Window.ToggleMaximise();
    };
    window.addEventListener("dblclick", onDoubleClick, { capture: true });
    return () => window.removeEventListener("dblclick", onDoubleClick, { capture: true });
  }, [enabled]);
}

/** 保留设置入口快捷键；全局历史导航和侧栏开关已移除。 */
export function useSettingsShortcut() {
  const session = useSession();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target) || event.altKey || event.shiftKey) return;
      const isModifier = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (isModifier && event.code === "Comma") {
        event.preventDefault();
        session.openSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);
}

function CaptionButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      className={`no-drag grid h-7 w-[38px] shrink-0 place-items-center rounded-control leading-none text-ink ${
        danger
          ? "hover:bg-danger hover:text-on-danger"
          : "hover:bg-line"
      }`}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/** 非 macOS：Frameless 窗口没有系统按钮，右上角自绘 最小化/最大化/关闭。
 *  关闭走 Window.Close → Go 侧 WindowClosing 钩子，与系统关闭一致地退到后台托盘。 */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      Window.IsMaximised()
        .then((value) => {
          if (alive) setMaximised(!!value);
        })
        .catch(() => {});
    };
    sync();
    // 双击标题栏最大化等原生行为不走按钮，窗口尺寸一变就重新对齐图标
    window.addEventListener("resize", sync);
    return () => {
      alive = false;
      window.removeEventListener("resize", sync);
    };
  }, []);

  return (
    <div className="flex h-full items-center gap-0.5">
      <CaptionButton label="最小化" onClick={() => void Window.Minimise()}>
        <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </CaptionButton>
      <CaptionButton
        label={maximised ? "还原" : "最大化"}
        onClick={() => void Window.ToggleMaximise()}
      >
        {maximised ? (
          <>
            <rect x="8" y="4" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
            <rect x="4" y="8" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </>
        ) : (
          <rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </CaptionButton>
      <CaptionButton label="关闭" danger onClick={() => void Window.Close()}>
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </CaptionButton>
    </div>
  );
}
