/**
 * 窗口左上角：后退、前进、收起/展开侧栏。
 */

import { useEffect, type ReactNode } from "react";
import { useNavHistory } from "@/react/state/session";
import { useSidebar } from "@/react/state/sidebar";

export function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** 收起后顶栏要让开红绿灯（Mac 72px）和三个 28px 按钮。 */
export function windowChromeInset(isMac: boolean) {
  return isMac ? "168px" : "108px";
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
      className="no-drag grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink hover:bg-raised disabled:cursor-default disabled:opacity-30"
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.code === "BracketLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.code === "BracketRight") {
        event.preventDefault();
        goForward();
        return;
      }
      if (event.code === "Backslash") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack, goForward, toggle]);

  return (
    <div className="flex items-center gap-0.5">
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
    </div>
  );
}
