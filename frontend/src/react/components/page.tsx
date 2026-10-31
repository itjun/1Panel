import { X } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsHostWorkspace } from "@/react/components/host-tool-tabs";
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
  heading,
  scrollLabel,
}: {
  title?: string;
  actions?: ReactNode;
  /** 内容区顶部工具行（路径提示等），本机 / 主机页都显示在页内，不进通栏 */
  toolbar?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  /** 左右分栏等需要贴边铺满时关掉内边距 */
  flush?: boolean;
  /** 当前页面的刷新动作，由 ⌘R / Ctrl+R 调用。 */
  onRefresh?: () => void | Promise<void | boolean>;
  refreshing?: boolean;
  /** 全局模块可指定内容标题；设备页默认使用工具名称。 */
  heading?: string | false;
  /** 可选的可聚焦滚动区域，让长文档支持 PageUp / PageDown 等原生键盘滚动。 */
  scrollLabel?: string;
}) {
  useRegisterPageRefresh(onRefresh, refreshing);
  // 模块由侧栏高亮标识，标题只在内容区显示，不挂到窗口通栏。
  // 操作按钮全站一律下沉为内容区顶部的页内工具行，不上通栏（docs/design/specification.md §4.6，2026-10-05 起本机等非主机页同规则）
  const hostWorkspace = useIsHostWorkspace();
  const padded = !flush && !dark;
  const inlineTitle = heading === false ? undefined : heading || (title !== "概览" ? title : undefined);

  let inlineToolbar: ReactNode = null;
  if (inlineTitle || toolbar || actions) {
    inlineToolbar = (
      <div
        className={cn(
          "uiux-page-tools drag-region flex min-h-8 shrink-0 flex-wrap items-center gap-3",
          !padded && "px-[var(--gap-card)] pt-[var(--gap-card)]",
        )}
      >
        {inlineTitle ? <h1 className="uiux-page-title">{inlineTitle}</h1> : null}
        <div className="uiux-page-actions">{toolbar}{actions}</div>
      </div>
    );
  }

  return (
    <div className="uiux-page flex h-full min-h-0 min-w-0 flex-col text-ink" data-device={hostWorkspace || undefined}>
      {padded ? null : inlineToolbar}
      <div
        role={scrollLabel ? "region" : undefined}
        aria-label={scrollLabel}
        tabIndex={scrollLabel ? 0 : undefined}
        className={cn(
          "uiux-page-content content-float flex min-w-0 flex-1 flex-col",
          dark && "bg-graphite text-graphite-text",
          /* 默认内容区四周 16px 安全边距，子元素间隙走 --gap-card；区块分段由页面用 gap-section（docs/design/specification.md §4.1 / §4.2） */
          padded && "gap-card p-4",
          scrollLabel && "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
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

/** 页面提示条，视觉按 TDesign Alert（docs/design/specification.md §8.2）。
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

/** 提示条锚定 C 区内容起点，不依赖已移除的全局导航栏。 */
function useContentTop(): number {
  const [bottom, setBottom] = useState(0);
  useLayoutEffect(() => {
    const toolbar = document.querySelector(".glass-chrome-main");
    if (!toolbar) return;
    const measure = () => setBottom(toolbar.getBoundingClientRect().top);
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
 * 浮层不占位，层级压过对话框遮罩（docs/design/specification.md §9「操作提示条浮层」）。
 */
export function FlashNotices({ flash }: { flash: FlashMessage }) {
  const top = useContentTop();

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
