import { X } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsHostWorkspace } from "@/react/components/host-tool-tabs";
import { ShellToolbarPortal } from "@/react/components/shell-toolbar";
import type { FlashMessage } from "@/react/lib/use-flash-message";
import { cn } from "@/react/lib/utils";
import { useRegisterPageRefresh } from "@/react/state/page-refresh";

export function Page({
  title,
  actions,
  toolbar,
  children,
  dark = false,
  flush = false,
  onRefresh,
  refreshing = false,
}: {
  title?: string;
  actions?: ReactNode;
  /** 内容区顶部工具行（路径提示等），本机 / 主机页都显示在页内，不进通栏 */
  toolbar?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  /** 左右分栏等需要贴边铺满时关掉内边距 */
  flush?: boolean;
  /** 挂到红绿灯旁刷新图标；无则 chrome 回退 session.refresh */
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}) {
  useRegisterPageRefresh(onRefresh, refreshing);
  // 主机页：通栏被功能标签占用，标题由标签高亮代替，操作下沉为内容区顶部的工具行（DESIGN.md §4.6）
  const hostWorkspace = useIsHostWorkspace();
  const padded = !flush && !dark;

  let inlineToolbar: ReactNode = null;
  const inlineActions = hostWorkspace ? actions : null;
  if (toolbar || inlineActions) {
    inlineToolbar = (
      <div
        className={cn(
          "flex min-h-8 shrink-0 flex-wrap items-center gap-2",
          !padded && "px-[var(--gap-card)] pt-[var(--gap-card)]",
        )}
      >
        {toolbar}
        {inlineActions}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col text-ink">
      {hostWorkspace ? null : (
        <ShellToolbarPortal>
          <div className="flex h-full w-full items-center gap-3 px-[var(--gap-card)]">
            {title ? <h1 className="text-sm font-semibold leading-none text-ink">{title}</h1> : null}
            {/* 右侧操作区：按钮间距 8px；各页面的操作按钮用 size="sm"（28px） */}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
        </ShellToolbarPortal>
      )}
      {padded ? null : inlineToolbar}
      <div
        className={cn(
          "content-float flex min-w-0 flex-1 flex-col",
          dark && "bg-graphite text-graphite-text",
          /* 默认内容区四周 16px 安全边距，子元素间隙走 --gap-card；区块分段由页面用 gap-section（DESIGN.md §4.1 / §4.2） */
          padded && "gap-card p-4",
        )}
      >
        {padded ? inlineToolbar : null}
        {children}
      </div>
    </div>
  );
}

/** TDesign Alert 的四种 theme；warn 是 warning 的旧名 */
type NoticeTone = "success" | "info" | "warning" | "warn" | "error";

/** 底色 = 功能色浅底；text-* 只给状态图标着色，正文另用 ink */
const NOTICE_TONE_CLASS: Record<NoticeTone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warn-soft text-warn",
  warn: "bg-warn-soft text-warn",
  error: "bg-danger-soft text-danger",
};

/** 实心圆状态图标：圆面 = 主题色（currentColor），符号用 surface 色，亮 / 暗主题都有足够对比 */
function NoticeIcon({ tone }: { tone: NoticeTone }) {
  let symbol: ReactNode;
  if (tone === "success") {
    symbol = <path d="M7.5 12.5l3 3 6-6" fill="none" strokeWidth={2} />;
  } else if (tone === "info") {
    symbol = (
      <>
        <circle cx={12} cy={7.5} r={1.25} className="fill-surface" stroke="none" />
        <path d="M12 11v6" fill="none" strokeWidth={2} />
      </>
    );
  } else {
    symbol = (
      <>
        <path d="M12 7v6" fill="none" strokeWidth={2} />
        <circle cx={12} cy={16.5} r={1.25} className="fill-surface" stroke="none" />
      </>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-1 size-4 shrink-0 stroke-surface"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx={12} cy={12} r={11} fill="currentColor" stroke="none" />
      {symbol}
    </svg>
  );
}

/** 页面提示条，视觉按 TDesign Alert（DESIGN.md §8.2）。
 *  warning 只用于常驻的状态说明（如「未检测到…」）或需用户处理的事项；操作结果用 FlashNotices。 */
export function Notice({
  text,
  tone = "error",
  onClose,
  leaving = false,
  onMouseEnter,
  onMouseLeave,
}: {
  text: string;
  tone?: NoticeTone;
  /** 传了才显示右侧关闭按钮 */
  onClose?: () => void;
  /** true 时播放淡出 */
  leaving?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      className={cn(
        /* 行高 24 + 上下 8 = 最小 40px；图标 / 关闭按钮与首行对齐，长文字换行 */
        "flex min-h-10 shrink-0 items-start gap-2 rounded-panel px-4 py-2 text-sm leading-6",
        leaving ? "motion-notice-out" : "motion-notice-in",
        NOTICE_TONE_CLASS[tone],
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <NoticeIcon tone={tone} />
      <p className="min-w-0 flex-1 break-words text-ink">{text}</p>
      {onClose ? (
        <button
          type="button"
          aria-label="关闭提示"
          onClick={onClose}
          className="motion-colors -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-control text-muted hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** 顶栏底边（视口坐标）；提示条浮层贴在其下方 */
function useToolbarBottom(): number {
  const [bottom, setBottom] = useState(0);
  useLayoutEffect(() => {
    const toolbar = document.querySelector(".shell-app-toolbar");
    if (!toolbar) return;
    const measure = () => setBottom(toolbar.getBoundingClientRect().bottom);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return bottom;
}

/**
 * 渲染 useFlashMessage 的错误 / 待处理 / 成功提示条；三者互斥，同一时刻最多一条。
 * 浮层不占位，层级压过对话框遮罩（DESIGN.md §9「操作提示条浮层」）。
 */
export function FlashNotices({ flash }: { flash: FlashMessage }) {
  const top = useToolbarBottom();

  let notice: ReactNode = null;
  if (flash.error) {
    notice = <Notice text={flash.error} onClose={flash.clearError} />;
  } else if (flash.warn) {
    notice = <Notice text={flash.warn} tone="warning" onClose={flash.clearWarn} />;
  } else if (flash.toast) {
    notice = (
      <Notice
        text={flash.toast}
        tone="success"
        leaving={flash.toastLeaving}
        onClose={flash.clearToast}
        onMouseEnter={flash.pauseToast}
        onMouseLeave={flash.resumeToast}
      />
    );
  }
  if (!notice) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4 pt-4"
      style={{ top }}
    >
      {/* 阻止冒泡：点提示条（如关闭）不被对话框当作外部点击而关掉 */}
      <div
        className="pointer-events-auto w-fit max-w-[min(560px,100%)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {notice}
      </div>
    </div>,
    document.body,
  );
}
