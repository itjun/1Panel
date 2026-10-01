/**
 * 告警消息体的唯一出处：系统通知、应用内历史、企业微信、设置页预览都从这里取文案，
 * 保证「正文带上」勾了什么，三个渠道就一起带什么。
 */

import type { NotifyContentField } from "@/react/state/settings";
import { LEVEL_LABEL, type AlertStartLevel } from "@/utils/alerts";

/** 持续时长：45 秒 / 25 分钟 / 2 小时 10 分 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

export type NotifyMessageKind = "resource" | "app";

/** 告警现场的结构化读数（全量；是否写进正文由 fields 决定） */
export type NotifyTextParts = {
  hostName?: string;
  metric?: string;
  threshold?: string;
  value?: string;
  /** 仅恢复：告警期间峰值 */
  peak?: string;
  service?: string;
};

export type NotifyLine = { label: string; value: string };

export type NotifyMessage = {
  title: string;
  /** 正文逐行（企微引用行、应用内详情） */
  lines: NotifyLine[];
  /** 系统通知单行正文 */
  body: string;
  /** 资源告警所在档位；企微按它显示 [警告] 或 [严重] */
  level?: AlertStartLevel;
};

export function buildNotifyMessage(opts: {
  state: "down" | "up";
  kind: NotifyMessageKind;
  parts: NotifyTextParts;
  fields: readonly NotifyContentField[];
  /** 资源告警档位：告警为当前档，恢复为事件到过的最高档 */
  level?: AlertStartLevel;
  /** 从警告档升到危险档的那条 */
  escalated?: boolean;
  /** 重复提醒：告警已持续的毫秒数 */
  repeatMs?: number;
}): NotifyMessage {
  const on = (field: NotifyContentField) => opts.fields.includes(field);
  const pick = (field: NotifyContentField, raw?: string) =>
    on(field) ? (raw || "").trim() : "";

  const host = pick("hostName", opts.parts.hostName);
  const metric = pick("metric", opts.parts.metric);
  const service = pick("service", opts.parts.service);
  const value = pick("value", opts.parts.value);
  const peak = pick("value", opts.parts.peak);
  const threshold = pick("threshold", opts.parts.threshold);
  const up = opts.state === "up";

  const hostPrefix = host ? `「${host}」` : "";
  let title: string;
  if (opts.kind === "app") {
    const verb = up ? "已恢复" : "探活异常";
    title = `${hostPrefix}${service}${service ? " " : ""}${verb}`;
  } else {
    title = `${hostPrefix}${metric}${metric ? " " : ""}${resourceVerb(opts)}`;
  }

  const lines: NotifyLine[] = [];
  if (opts.kind === "app") {
    if (value) lines.push({ label: up ? "状态" : "异常", value });
  } else {
    if (value) lines.push({ label: up ? "回落值" : "当前值", value });
    if (up && peak) lines.push({ label: "峰值", value: peak });
    if (threshold) lines.push({ label: "阈值", value: threshold });
  }

  const body = lines.length
    ? lines.map((line) => `${line.label} ${line.value}`).join(" · ")
    : title;
  return { title, lines, body, level: opts.kind === "resource" ? opts.level : undefined };
}

function resourceVerb(opts: {
  state: "down" | "up";
  level?: AlertStartLevel;
  escalated?: boolean;
  repeatMs?: number;
}) {
  if (opts.state === "up") return "已回落";
  if (opts.escalated) return "升到危险档";
  if (opts.repeatMs !== undefined && opts.level) {
    return `仍在${LEVEL_LABEL[opts.level]}档（已持续 ${formatDuration(opts.repeatMs)}）`;
  }
  if (opts.level) return `进入${LEVEL_LABEL[opts.level]}档`;
  return "超阈值";
}
