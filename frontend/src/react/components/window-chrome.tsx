/**
 * 整窗通栏左侧（Firefox 式）：侧栏收起/展开、后退、前进、刷新、主页。
 * 窗口右上角（非 macOS）：最小化、最大化/还原、关闭。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Window } from "@wailsio/runtime";
import { usePageRefresh } from "@/react/state/page-refresh";
import { useNavHistory, useSession } from "@/react/state/session";
import { useSidebar } from "@/react/state/sidebar";

/** 真实运行平台：mac / win / linux（窗控与配色各自按此判断）。 */
export type AppOs = "mac" | "win" | "linux";

export function detectAppOs(): AppOs {
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad/.test(platform)) return "mac";
  if (/Win/.test(platform) || /Windows/.test(ua)) return "win";
  // Linux / Android / ChromeOS 等非 Windows 桌面，统一标 linux
  if (/Linux/.test(platform) || /Linux|Android|CrOS/.test(ua)) return "linux";
  // 未知非 mac 平台：按 frameless 处理，走 linux 分支（自绘窗控）
  return "linux";
}

export function isMacPlatform() {
  return detectAppOs() === "mac";
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable='true'], .xterm, .cm-editor");
}

function ChromeButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  // Firefox Proton：图标 16×16，inner-padding 6 → 按钮 28×28，outer-padding 2，圆角 4
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`no-drag mx-0.5 flex size-7 shrink-0 items-center justify-center rounded-[4px] leading-none text-ink hover:bg-black/[0.08] disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/10 ${
        pressed ? "bg-black/[0.1] dark:bg-white/12" : ""
      }`}
      onClick={onClick}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        className="block"
        fill="currentColor"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

export function WindowChrome() {
  const { canBack, canForward, goBack, goForward } = useNavHistory();
  const { open, toggle } = useSidebar();
  const session = useSession();
  const pageRefresh = usePageRefresh();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;

      const isMac = isMacPlatform();

      // 前进/后退：对齐各平台浏览器（Mac ⌘+[ / ⌘+] / ⌘+←→；Win/Linux Alt+←→）
      if (isMac) {
        if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          if (event.code === "BracketLeft" || event.code === "ArrowLeft") {
            event.preventDefault();
            goBack();
            return;
          }
          if (event.code === "BracketRight" || event.code === "ArrowRight") {
            event.preventDefault();
            goForward();
            return;
          }
        }
      } else if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        if (event.code === "ArrowLeft") {
          event.preventDefault();
          goBack();
          return;
        }
        if (event.code === "ArrowRight") {
          event.preventDefault();
          goForward();
          return;
        }
      }

      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      if (event.code === "Backslash" || event.code === "KeyB") {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.code === "Comma") {
        event.preventDefault();
        session.openSettings(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goForward, toggle, session]);

  return (
    <div className="flex h-full items-center">
      {/* 下列 path 直接取自 Firefox（MPL 2.0）16×16 填充图标 */}
      <ChromeButton label={open ? "收起侧栏" : "展开侧栏"} pressed={open} onClick={toggle}>
        <g fillRule="evenodd">
          <path d="M16 12.25 16 4a2 2 0 0 0-2-2L2 2a2 2 0 0 0-2 2l0 8.25a2 2 0 0 0 2 2l12 0a2 2 0 0 0 2-2zm-14.75.15 0-8.55.6-.6 4.9 0 0 9.75-4.9 0-.6-.6zM8 13l6.15 0 .6-.6 0-8.55-.6-.6-6.15 0L8 13z" />
          <path d="M5.5 10.5A.5.5 0 0 0 5 10l-2 0a.5.5 0 0 0 0 1l2 0a.5.5 0 0 0 .5-.5z" />
          <path d="M5.5 8a.5.5 0 0 0-.5-.5l-2 0a.5.5 0 0 0 0 1l2 0a.5.5 0 0 0 .5-.5z" />
          <path d="M5.5 5.5A.5.5 0 0 0 5 5L3 5a.5.5 0 0 0 0 1l2 0a.5.5 0 0 0 .5-.5z" />
        </g>
      </ChromeButton>
      <ChromeButton label="后退" disabled={!canBack} onClick={goBack}>
        <path d="M6.69 2.25 1.22 7.72a.75.75 0 0 0 0 1.06l5.47 5.47 1.06-1.061L3.56 9H15V7.5H3.56l4.19-4.19-1.06-1.06z" />
      </ChromeButton>
      <ChromeButton label="前进" disabled={!canForward} onClick={goForward}>
        <path d="M12.44 9H1V7.5h11.44L8.25 3.31l1.06-1.06 5.47 5.47a.75.75 0 0 1 0 1.06l-5.47 5.47-1.06-1.061L12.44 9z" />
      </ChromeButton>
      <ChromeButton
        label="刷新"
        disabled={pageRefresh.busy || session.loading}
        onClick={() => {
          void pageRefresh.run();
        }}
      >
        <path d="M10.707 6 14.7 6l.3-.3 0-3.993a.5.5 0 0 0-.854-.354l-1.459 1.459A6.95 6.95 0 0 0 8 1C4.141 1 1 4.141 1 8s3.141 7 7 7a6.97 6.97 0 0 0 6.968-6.322.626.626 0 0 0-.562-.682.635.635 0 0 0-.682.562A5.726 5.726 0 0 1 8 13.75c-3.171 0-5.75-2.579-5.75-5.75S4.829 2.25 8 2.25a5.71 5.71 0 0 1 3.805 1.445l-1.451 1.451a.5.5 0 0 0 .353.854z" />
      </ChromeButton>
      <ChromeButton label="主页" onClick={() => session.goHome()}>
        <path d="M14.817 7.507 8.852 1.542a1.918 1.918 0 0 0-2.703 0L.183 7.507A.618.618 0 0 0 1 8.436L1 14a2 2 0 0 0 2 2l9 0a2 2 0 0 0 2-2l0-5.564a.62.62 0 0 0 .375.139.626.626 0 0 0 .442-1.068zM8.75 14.75l-2.5 0 0-4 .5-.5 1.5 0 .5.5 0 4zm4-.581-.6.581-2.15 0L10 11a2 2 0 0 0-2-2L7 9a2 2 0 0 0-2 2l0 3.75-2.15 0-.6-.581-.001-6.96 4.783-4.783a.663.663 0 0 1 .936 0L12.75 7.21l0 6.959z" />
      </ChromeButton>
    </div>
  );
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
      title={label}
      aria-label={label}
      className={`no-drag grid h-7 w-[38px] shrink-0 place-items-center rounded-control leading-none text-ink ${
        danger
          ? "hover:bg-danger hover:text-white"
          : "hover:bg-raised"
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
        <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </CaptionButton>
      <CaptionButton
        label={maximised ? "还原" : "最大化"}
        onClick={() => void Window.ToggleMaximise()}
      >
        {maximised ? (
          <>
            <rect x="8" y="4" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
            <rect x="4" y="8" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </>
        ) : (
          <rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        )}
      </CaptionButton>
      <CaptionButton label="关闭" danger onClick={() => void Window.Close()}>
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </CaptionButton>
    </div>
  );
}
