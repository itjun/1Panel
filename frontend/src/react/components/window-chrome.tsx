/**
 * 整窗通栏左侧（Firefox 式）：侧栏收起/展开、后退、前进、刷新、主页。
 * 窗口右上角（非 macOS）：最小化、最大化/还原、关闭。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Window } from "@wailsio/runtime";
import { usePageRefresh } from "@/react/state/page-refresh";
import { useNavHistory, useSession } from "@/react/state/session";
import { useSidebar } from "@/react/state/sidebar";
import { isMacPlatform } from "@/react/lib/platform";
import { FlashNotices } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";

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
      if (!target.closest(".shell-app-toolbar, .module-rail-drag")) return;
      if (target.closest(TOOLBAR_INTERACTIVE_SELECTOR)) return;
      void Window.ToggleMaximise();
    };
    window.addEventListener("dblclick", onDoubleClick, { capture: true });
    return () => window.removeEventListener("dblclick", onDoubleClick, { capture: true });
  }, [enabled]);
}

function ChromeButton({
  label,
  disabled,
  expanded,
  onClick,
  children,
  spinning = false,
}: {
  label: string;
  disabled?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: ReactNode;
  spinning?: boolean;
}) {
  // Firefox Proton：图标 16×16，inner-padding 6 → 按钮 28×28，outer-padding 2，圆角 4
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      className="no-drag mx-0.5 flex size-7 shrink-0 items-center justify-center rounded-control leading-none text-ink hover:bg-line disabled:cursor-default disabled:opacity-40"
      onClick={onClick}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        className={spinning ? "block animate-spin motion-reduce:animate-none" : "block"}
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const flash = useFlashMessage();
  const flashRef = useRef(flash);
  flashRef.current = flash;
  const isRefreshPending = useRef(false);

  const refresh = useCallback(async () => {
    if (isRefreshPending.current || pageRefresh.busy || session.loading) return;
    isRefreshPending.current = true;
    flashRef.current.clear();
    setIsRefreshing(true);
    const started = Date.now();
    let message: string;
    let isFailed = false;
    try {
      const result = await pageRefresh.run();
      message = result === "page" ? "刷新成功" : result === "hosts" ? "主机列表已刷新" : "已触发刷新";
    } catch {
      message = "刷新失败";
      isFailed = true;
    }
    const remaining = 600 - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    isRefreshPending.current = false;
    setIsRefreshing(false);
    if (isFailed) flashRef.current.showError(message);
    else flashRef.current.showToast(message);
  }, [pageRefresh, session.loading]);

  useEffect(() => {
    function onRefreshKey(event: KeyboardEvent) {
      const isRefresh = isMacPlatform()
        ? event.metaKey && !event.ctrlKey && event.code === "KeyR"
        : event.ctrlKey && !event.metaKey && event.code === "F5";
      if (!isRefresh || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (!event.repeat) void refresh();
    }
    window.addEventListener("keydown", onRefreshKey, true);
    return () => window.removeEventListener("keydown", onRefreshKey, true);
  }, [refresh]);

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
      {/* Firefox（MPL 2.0）导航图标为 16×16，侧栏保持相近的视觉尺寸、描边粗细。 */}
      <ChromeButton label={open ? "收起侧栏" : "展开侧栏"} expanded={open} onClick={toggle}>
        <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x={1.75} y={1.75} width={12.5} height={12.5} rx={1.25} />
          <path d="M5.75 1.75V14.25" strokeLinecap="butt" />
          <path
            d={open ? "M11.5 5.25 8.75 8l2.75 2.75" : "M8.75 5.25 11.5 8l-2.75 2.75"}
          />
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
        disabled={pageRefresh.busy || session.loading || isRefreshing}
        spinning={isRefreshing}
        onClick={() => void refresh()}
      >
        <path d="M10.707 6 14.7 6l.3-.3 0-3.993a.5.5 0 0 0-.854-.354l-1.459 1.459A6.95 6.95 0 0 0 8 1C4.141 1 1 4.141 1 8s3.141 7 7 7a6.97 6.97 0 0 0 6.968-6.322.626.626 0 0 0-.562-.682.635.635 0 0 0-.682.562A5.726 5.726 0 0 1 8 13.75c-3.171 0-5.75-2.579-5.75-5.75S4.829 2.25 8 2.25a5.71 5.71 0 0 1 3.805 1.445l-1.451 1.451a.5.5 0 0 0 .353.854z" />
      </ChromeButton>
      <ChromeButton label="主页" onClick={() => session.goHome()}>
        <path d="M14.817 7.507 8.852 1.542a1.918 1.918 0 0 0-2.703 0L.183 7.507A.618.618 0 0 0 1 8.436L1 14a2 2 0 0 0 2 2l9 0a2 2 0 0 0 2-2l0-5.564a.62.62 0 0 0 .375.139.626.626 0 0 0 .442-1.068zM8.75 14.75l-2.5 0 0-4 .5-.5 1.5 0 .5.5 0 4zm4-.581-.6.581-2.15 0L10 11a2 2 0 0 0-2-2L7 9a2 2 0 0 0-2 2l0 3.75-2.15 0-.6-.581-.001-6.96 4.783-4.783a.663.663 0 0 1 .936 0L12.75 7.21l0 6.959z" />
      </ChromeButton>
      <FlashNotices flash={flash} />
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
