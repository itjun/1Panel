import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { api } from "@/api";
import { Tag } from "@/react/components/ui/tag";
import { cn } from "@/react/lib/utils";
import { hostAlertPayload } from "@/utils/alertNotify";
import { LEVEL_LABEL } from "@/utils/alerts";
import type { NotifyMessage } from "@/utils/notifyMessage";

export type PreviewChannelState = {
  system: boolean;
  inApp: boolean;
  wecom: boolean;
  /** 企业微信开关开着但没填地址 */
  wecomMissingWebhook: boolean;
};

export type PreviewRow = {
  key: string;
  /** 类型名，如「CPU」「应用探活」 */
  name: string;
  host: string;
  kind: string;
  state: "down" | "up";
  /** 行标签，缺省按 state 写「告警」「恢复」；升级行写「升级」 */
  stage?: string;
  message: NotifyMessage;
  /** 非空表示这一行的消息不会发送，写明原因 */
  muted?: string;
};

/**
 * 全部展开的预览矩阵：行 = 消息类型 × 告警 / 恢复，列 = 三个渠道。
 * 文案都来自同一份 NotifyMessage；企业微信格渲染后端 PreviewHostAlertMarkdown 原文，
 * 与真实发送同一个函数。
 */
export function PreviewMatrix({
  rows,
  channels,
}: {
  rows: PreviewRow[];
  channels: PreviewChannelState;
}) {
  const columns = [
    { key: "system", title: "系统通知", off: !channels.system },
    { key: "inApp", title: "应用内", off: !channels.inApp },
    {
      key: "wecom",
      title: "企业微信",
      off: !channels.wecom,
      extra: channels.wecomMissingWebhook ? <Tag tone="warn">未填写地址</Tag> : null,
    },
  ];
  return (
    <div className="grid grid-cols-[88px_repeat(3,minmax(0,1fr))] gap-x-4 gap-y-3">
      <span />
      {columns.map((col) => (
        <div key={col.key} className="sticky top-0 z-[1] flex h-8 items-center gap-2 bg-surface">
          <h3 className="text-xs text-muted">{col.title}</h3>
          {col.off ? <Tag>未开启，不会发送</Tag> : col.extra}
        </div>
      ))}
      {rows.map((row) => {
        const rowOff = !!row.muted;
        return (
          <Fragment key={row.key}>
            <div className="flex flex-col pt-2">
              <span className="text-sm text-ink">{row.name}</span>
              <span className="text-xs text-muted">{row.stage || (row.state === "up" ? "恢复" : "告警")}</span>
              {row.muted ? <span className="mt-1 text-xs text-warn">{row.muted}</span> : null}
            </div>
            <Cell off={rowOff || columns[0].off}>
              <SystemCard message={row.message} />
            </Cell>
            <Cell off={rowOff || columns[1].off}>
              <InAppCard row={row} />
            </Cell>
            <Cell off={rowOff || columns[2].off}>
              <WecomCard row={row} />
            </Cell>
          </Fragment>
        );
      })}
    </div>
  );
}

function Cell({ off, children }: { off: boolean; children: ReactNode }) {
  return <div className={cn("min-w-0", off && "opacity-50")}>{children}</div>;
}

function SystemCard({ message }: { message: NotifyMessage }) {
  return (
    <div className="flex h-full gap-2 rounded-panel bg-raised p-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-control bg-accent text-white">
        <Bell size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5 text-ink">{message.title}</p>
        <p className="text-xs leading-5 text-ink">{message.body}</p>
      </div>
    </div>
  );
}

function statusWord(row: PreviewRow): string {
  const app = row.kind.startsWith("app:");
  if (row.state === "up") return app ? "已恢复" : "已回落";
  if (app) return "探活异常";
  return row.message.level ? LEVEL_LABEL[row.message.level] : "超阈值";
}

function statusTone(row: PreviewRow): "ok" | "warn" | "danger" {
  if (row.state === "up") return "ok";
  return row.message.level === "warn" ? "warn" : "danger";
}

function InAppCard({ row }: { row: PreviewRow }) {
  const { message } = row;
  return (
    <div className="flex h-full flex-col gap-1 rounded-panel bg-raised p-3">
      <div className="flex items-start gap-2">
        <Tag tone={statusTone(row)}>{statusWord(row)}</Tag>
        <span className="min-w-0 text-sm font-semibold leading-5 text-ink">{message.title}</span>
      </div>
      {message.lines.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs leading-5">
          {message.lines.map((line) => (
            <Fragment key={line.label}>
              <dt className="text-muted">{line.label}</dt>
              <dd className="min-w-0 font-mono tabular-nums text-ink">{line.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted">没有勾选读数，只显示标题</p>
      )}
    </div>
  );
}

function WecomCard({ row }: { row: PreviewRow }) {
  const payload = hostAlertPayload({
    webhook: "",
    host: row.host,
    kind: row.kind,
    state: row.state,
    message: row.message,
  });
  const markdown = useQuery({
    queryKey: ["wecom-preview", payload],
    queryFn: () => api.previewHostAlertMarkdown(payload),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="h-full rounded-panel bg-raised p-3">
      <WecomMarkdown text={markdown.data || ""} />
    </div>
  );
}

const WECOM_COLOR: Record<string, string> = {
  red: "text-danger",
  warning: "text-warn",
  info: "text-success-text",
  comment: "text-muted",
};

/** 企微群机器人 markdown 的一个子集：### 标题、<font color>、>引用行 */
function WecomMarkdown({ text }: { text: string }) {
  const rows = text.split("\n").filter((line) => line.trim());
  if (!rows.length) return <p className="text-xs text-muted">正在生成预览…</p>;
  return (
    <div className="flex flex-col gap-0.5 text-xs leading-5">
      {rows.map((row, index) => {
        if (row.startsWith("### ")) {
          return (
            <p key={index} className="mb-0.5 text-sm font-semibold leading-5 text-ink">
              <FontText text={row.slice(4)} />
            </p>
          );
        }
        if (row.startsWith(">")) {
          const body = row.slice(1);
          const colon = body.indexOf(": ");
          return (
            <p key={index} className="border-l-2 border-line-strong pl-2 break-all text-muted">
              {colon > 0 ? (
                <>
                  {body.slice(0, colon)}：<span className="text-ink">{body.slice(colon + 2)}</span>
                </>
              ) : (
                body
              )}
            </p>
          );
        }
        return (
          <p key={index} className="text-ink">
            {row}
          </p>
        );
      })}
    </div>
  );
}

function FontText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /<font color="(\w+)">(.*?)<\/font>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span key={match.index} className={WECOM_COLOR[match[1]] || "text-ink"}>
        {match[2]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
