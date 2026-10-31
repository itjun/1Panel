import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CurrentTextRefresh } from "@/react/components/current-text-refresh";
import { Page } from "@/react/components/page";
import { copyText } from "@/utils/clipboard";
import { formatBytes, splitTextLines } from "@/utils/format";
import "@/react/styles/text-reader.css";

/** 只统一阅读页面外框，不影响文件预览抽屉或其他页面的 Page。 */
export function TextPage({ title, status, actions, controls, headerControls, onRefresh, isRefreshing = false, isRefreshVisible = true, className = "", children }: {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  controls?: ReactNode;
  headerControls?: ReactNode;
  onRefresh: () => void | Promise<unknown>;
  isRefreshing?: boolean;
  isRefreshVisible?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const isRunning = useRef(false);
  async function refresh() {
    if (isRunning.current || isRefreshing) return false;
    isRunning.current = true;
    setIsBusy(true);
    try {
      await onRefresh();
      return true;
    } catch {
      // 各页面在对应阅读区显示 query.error，避免同一次失败出现两条提示。
      return false;
    } finally {
      isRunning.current = false;
      setIsBusy(false);
    }
  }
  return (
    <Page title={title} heading={false} flush onRefresh={refresh} refreshing={isBusy || isRefreshing}>
      <section className={`text-page ${className}`} aria-label={title}>
        <header className="text-page-header drag-region">
          <h1>{title}</h1>
          {status ? <div className="text-page-status">{status}</div> : null}
          {headerControls ? <div className="text-page-header-controls">{headerControls}</div> : null}
          {actions || isRefreshVisible ? <div className="text-page-actions">
            {actions}
            {isRefreshVisible ? <CurrentTextRefresh onRefresh={() => void refresh()} refreshing={isBusy || isRefreshing} /> : null}
          </div> : null}
        </header>
        {controls ? <div className="text-page-controls">{controls}</div> : null}
        <div className="text-page-content">{children}</div>
      </section>
    </Page>
  );
}

export function TextViewTabs<T extends string>({ label, items, value, onChange }: {
  label: string;
  items: readonly { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="text-view-tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <button type="button" key={item.key} aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}>{item.label}</button>
      ))}
    </div>
  );
}

function TextCopy({ text, label, isDisabled = false, isContent = false }: {
  text: string; label: string; isDisabled?: boolean; isContent?: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const request = useRef(0);
  const isRunning = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setFeedback("");
    setIsBusy(false);
    isRunning.current = false;
    return () => { request.current++; clearTimeout(timer.current); };
  }, [text]);
  async function copy() {
    if (isRunning.current || isDisabled || !text) return;
    isRunning.current = true;
    setIsBusy(true);
    clearTimeout(timer.current);
    const id = ++request.current;
    try {
      await copyText(text);
      if (id !== request.current) return;
      setFeedback("已复制");
      timer.current = setTimeout(() => setFeedback(""), 1600);
    } catch {
      if (id === request.current) setFeedback("复制失败，请重试");
    } finally {
      if (id === request.current) { isRunning.current = false; setIsBusy(false); }
    }
  }
  return (
    <span className={isContent ? "text-copy text-copy--content" : "text-copy"}>
      <button type="button" aria-label={label} title={label} disabled={isDisabled || !text || isBusy}
        aria-busy={isBusy} onClick={() => void copy()}>
        {feedback === "已复制" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
      <span className="text-copy-feedback" role="status">{feedback}</span>
    </span>
  );
}

export function TextReader({ path, sourceLabel, text, isLoading = false, isRefreshing = false, error,
  emptyText = "暂无内容", size, footer, children }: {
  path?: string;
  sourceLabel?: string;
  text: string;
  isLoading?: boolean;
  isRefreshing?: boolean;
  error?: string;
  emptyText?: string;
  size?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const displayPath = path?.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, "~") || "—";
  const slash = Math.max(displayPath.lastIndexOf("/"), displayPath.lastIndexOf("\\"));
  return (
    <section className="text-reader" aria-label={sourceLabel || "文本阅读"} aria-busy={isLoading || isRefreshing}>
      <div className="text-reader-location">
        {sourceLabel ? <span className="text-reader-source-label">{sourceLabel}</span> : null}
        <div className="text-reader-path" tabIndex={0} aria-label={path || "暂无路径"}>
          <span className="text-reader-directory">{slash >= 0 ? displayPath.slice(0, slash + 1) : ""}</span>
          <span className="text-reader-filename">{displayPath.slice(slash + 1)}</span>
          {path ? <span className="text-reader-full-path" aria-hidden>{path}</span> : null}
        </div>
        <TextCopy text={path || ""} label={sourceLabel ? "复制来源" : "复制路径"} />
      </div>
      {error ? <p className="text-reader-error" role="alert">{error}{text ? "；当前显示上次读取的内容。" : ""}</p> : null}
      <div className="text-reader-body">
        <TextCopy text={text} label="复制内容" isContent isDisabled={isLoading} />
        {isLoading ? <p className="text-reader-placeholder" role="status">加载中…</p>
          : text ? children : <p className="text-reader-placeholder">{error ? "内容读取失败" : emptyText}</p>}
      </div>
      <footer className="text-reader-footer">
        <div>
          <span>{isLoading ? "读取中…" : `${text ? splitTextLines(text).length : 0} 行`}</span>
          {size !== undefined && !isLoading ? <span>{formatBytes(size)}</span> : null}
          {footer}
        </div>
        {isRefreshing && !isLoading ? <span role="status">刷新中…</span> : null}
      </footer>
    </section>
  );
}

export function TextFileList({ files, path, onSelect, location, isLoading = false }: {
  files: { path: string; name: string; detail?: string }[];
  path: string;
  onSelect: (path: string) => void;
  location?: string;
  isLoading?: boolean;
}) {
  return (
    <nav className="text-file-list" aria-label="文件列表">
      <div className="text-file-list-heading">
        <span title={location}>{location || "文件"}</span><span>{files.length} 个文件</span>
      </div>
      <div className="text-file-list-items">
        {files.map((file) => (
          <button type="button" key={file.path} aria-current={file.path === path ? "true" : undefined}
            onClick={() => onSelect(file.path)} title={file.name}>
            <span>{file.name}</span>{file.detail ? <small>{file.detail}</small> : null}
          </button>
        ))}
        {!files.length ? <p>{isLoading ? "加载中…" : "暂无文件"}</p> : null}
      </div>
    </nav>
  );
}
