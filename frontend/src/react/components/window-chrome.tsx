/**
 * 窗口左上角（Firefox 式）：侧栏收起/展开、后退、前进、刷新、主页。
 * 窗口右上角（非 macOS）：最小化、最大化/还原、关闭。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Window } from "@wailsio/runtime";
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

/** 收起后顶栏要让开红绿灯（Mac 72px）和五个 28px 按钮（侧栏/后退/前进/刷新/主页）。 */
export function windowChromeInset(isMac: boolean) {
  return isMac ? "228px" : "168px";
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
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className="no-drag grid h-7 w-7 shrink-0 place-items-center rounded-control leading-none text-ink hover:bg-raised disabled:cursor-default disabled:opacity-30"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function WindowChrome() {
  const { canBack, canForward, goBack, goForward } = useNavHistory();
  const { open, toggle } = useSidebar();
  const session = useSession();

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
    <div className="flex h-full items-center gap-0.5">
      <ChromeButton label={open ? "收起侧栏" : "展开侧栏"} pressed={open} onClick={toggle}>
        <rect
          x="4"
          y="5"
          width="16"
          height="14"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M9 5v14" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </ChromeButton>
      <ChromeButton label="后退" disabled={!canBack} onClick={goBack}>
        <path
          d="M14 6l-6 6 6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </ChromeButton>
      <ChromeButton label="前进" disabled={!canForward} onClick={goForward}>
        <path
          d="M10 6l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </ChromeButton>
      <ChromeButton
        label="刷新"
        disabled={session.loading}
        onClick={() => {
          void session.refresh();
        }}
      >
        <path
          d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4M19.5 12a7.5 7.5 0 0 1-12.7 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M17.2 3.8v3.8h-3.8M6.8 20.2v-3.8h3.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </ChromeButton>
      <ChromeButton label="主页" onClick={() => session.goHome()}>
        <path
          d="M4.5 11.5L12 5l7.5 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7 10.5V19h10v-8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
