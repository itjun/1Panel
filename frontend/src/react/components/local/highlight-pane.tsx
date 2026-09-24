import { useEffect, useRef, useState } from "react";
import { copyText } from "@/utils/clipboard";
import "./local.css";

/** 语法高亮只读面板（nginx / hosts / 日志），对齐 Vue CodePane 的展示 */
export function HighlightPane({
  html,
  text,
  pinBottom = false,
  wrap = false,
}: {
  html: string;
  text: string;
  /** 内容更新后滚到最底，日志用 */
  pinBottom?: boolean;
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!pinBottom || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [html, pinBottom]);

  async function onCopy() {
    if (!text) return;
    try {
      await copyText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="local-code-pane">
      {text ? (
        <button
          type="button"
          className={copied ? "local-code-copy is-copied" : "local-code-copy"}
          onClick={() => void onCopy()}
          title={copied ? "已复制" : "复制"}
        >
          {copied ? "✓" : "⧉"}
        </button>
      ) : null}
      {html ? (
        <pre
          ref={preRef}
          className={wrap ? "local-code-pre is-wrap" : "local-code-pre"}
          tabIndex={-1}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="local-code-pre muted">暂无内容</pre>
      )}
    </div>
  );
}
