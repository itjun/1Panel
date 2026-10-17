import type { ReactNode } from "react";
import { parseReleaseNotes, type InlineNode, type ReleaseBlock } from "@/utils/releaseNotes";

const HEADING_TAG = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** 把更新说明从 Markdown 原文画成标题、列表和链接。点链接交给调用方用系统浏览器打开。 */
export function ReleaseNotes({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink?: (href: string) => void;
}) {
  const blocks = parseReleaseNotes(text);
  if (!blocks.length) return <p className="text-muted">本次更新未附说明。</p>;
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} isFirst={index === 0} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  isFirst,
  onOpenLink,
}: {
  block: ReleaseBlock;
  isFirst: boolean;
  onOpenLink?: (href: string) => void;
}) {
  if (block.kind === "heading") {
    const Tag = HEADING_TAG[block.level - 1];
    return (
      <Tag className={isFirst ? "font-semibold" : "mt-2 font-semibold"}>
        {renderInlines(block.inlines, onOpenLink)}
      </Tag>
    );
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    const marker = block.ordered ? "list-decimal pl-5" : "list-disc pl-5";
    return (
      <Tag className={marker}>
        {block.items.map((item, index) => (
          <li key={index}>{renderInlines(item, onOpenLink)}</li>
        ))}
      </Tag>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="overflow-auto rounded-control bg-surface px-2 py-1.5 font-mono text-xs leading-5">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="border-l-2 border-line-strong pl-2 text-muted">
        {renderInlines(block.inlines, onOpenLink)}
      </blockquote>
    );
  }
  return <p>{renderInlines(block.inlines, onOpenLink)}</p>;
}

function renderInlines(nodes: InlineNode[], onOpenLink?: (href: string) => void): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === "text") return <span key={index}>{node.text}</span>;
    if (node.kind === "code") {
      return (
        <code key={index} className="rounded-control bg-surface px-1 font-mono text-[0.85em]">
          {node.text}
        </code>
      );
    }
    if (node.kind === "strong") return <strong key={index}>{renderInlines(node.children, onOpenLink)}</strong>;
    if (node.kind === "em") return <em key={index}>{renderInlines(node.children, onOpenLink)}</em>;
    return (
      <a
        key={index}
        href={node.href}
        className="break-all text-accent underline underline-offset-2"
        onClick={(event) => {
          event.preventDefault();
          if (onOpenLink) onOpenLink(node.href);
        }}
      >
        {renderInlines(node.children, onOpenLink)}
      </a>
    );
  });
}
