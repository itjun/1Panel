/**
 * 告警通知共享出口：资源告警（wecomHostAlerts）与应用探活告警（appWatchAlerts）共用。
 *
 * 三层闸门（调用方先过 1~3，本文件负责频道分发）：
 * 1. 主机订阅
 * 2. 全局内容类型 isContentKindEnabled
 * 3. 恢复事件须 notifyRecoverEnabled
 * 4. 频道：systemNotifyEnabled / inAppNotifyEnabled / notifyEnabled+webhook
 */

import { api } from "@/api";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import {
  useSettingsStore,
  type NotifyContentField,
} from "@/stores/settings";

/** 拼装系统通知 / 企微文案的结构化字段 */
export type NotifyTextParts = {
  hostName?: string;
  metric?: string;
  threshold?: string;
  value?: string;
  service?: string;
};

function fieldOn(field: NotifyContentField): boolean {
  return useSettingsStore().isNotifyContentFieldEnabled(field);
}

/**
 * 按 notifyContentFields 勾选拼装标题与正文；未勾选的字段不写入。
 * kind=resource：标题偏「超阈值 / 已回落」；kind=app：偏「探活异常 / 已恢复」。
 */
export function buildNotifyCopy(opts: {
  state: "down" | "up";
  kind: "resource" | "app";
  parts: NotifyTextParts;
}): { title: string; body: string } {
  const host = fieldOn("hostName")
    ? (opts.parts.hostName || "").trim()
    : "";
  const metric = fieldOn("metric") ? (opts.parts.metric || "").trim() : "";
  const threshold = fieldOn("threshold")
    ? (opts.parts.threshold || "").trim()
    : "";
  const value = fieldOn("value") ? (opts.parts.value || "").trim() : "";
  const service = fieldOn("service")
    ? (opts.parts.service || "").trim()
    : "";

  const hostPrefix = host ? `「${host}」` : "";

  let title = "";
  if (opts.kind === "app") {
    const svc = service || "";
    if (opts.state === "up") {
      if (hostPrefix || svc) {
        title = `${hostPrefix}${svc}${svc ? " " : ""}已恢复`.trim();
      } else {
        title = "已恢复";
      }
    } else {
      if (hostPrefix || svc) {
        title = `${hostPrefix}${svc}${svc ? " " : ""}探活异常`.trim();
      } else {
        title = "探活异常";
      }
    }
  } else {
    const m = metric || "";
    if (opts.state === "up") {
      if (hostPrefix || m) {
        title = `${hostPrefix}${m}已回落`;
      } else {
        title = "已回落";
      }
    } else {
      if (hostPrefix || m) {
        title = `${hostPrefix}${m}超阈值`;
      } else {
        title = "超阈值";
      }
    }
  }

  const bodyBits: string[] = [];
  if (host) bodyBits.push(host);
  if (metric) bodyBits.push(metric);
  if (service) bodyBits.push(service);
  if (value) bodyBits.push(value);
  if (threshold) bodyBits.push(`阈值 ${threshold}`);

  let body = bodyBits.join(" · ");
  if (!body) {
    body = title;
  }
  return { title, body };
}

/**
 * 写入应用内历史 → 系统通知（带 eventId）→ 刷新未读。
 * 分别受 inAppNotifyEnabled / systemNotifyEnabled 控制。
 */
export async function appendAndNotifyDesktop(opts: {
  host: string;
  kind: string;
  state: "down" | "up";
  title: string;
  body: string;
  /** 系统通知点击要定位到历史行时，应用内关闭也写入历史 */
  historyForClick?: boolean;
}): Promise<void> {
  const settings = useSettingsStore();
  const wantInApp = settings.inAppNotifyEnabled;
  const wantSystem = settings.systemNotifyEnabled;
  const wantHistory = wantInApp || (!!opts.historyForClick && wantSystem);
  if (!wantInApp && !wantSystem) return;

  let eventId = "";
  if (wantHistory) {
    try {
      const saved = await api.appendAlertHistory({
        id: "",
        host: opts.host,
        kind: opts.kind,
        state: opts.state,
        title: opts.title,
        detail: opts.body,
        at: 0,
        read: false,
      });
      eventId = saved.id || "";
    } catch {
      /* 历史失败不阻断系统通知 */
    }
  }

  if (wantSystem) {
    void api
      .notifyDesktop(opts.title, opts.body, {
        host: opts.host,
        eventId,
        kind: opts.kind,
      })
      .catch(() => {});
  }

  if (wantHistory) {
    void useAlertHistoryStore().refresh();
  }
}

/**
 * 企微告警下发（含去重与失败重试）：
 * webhook 为空或该键已发过（key 在 fired 集合中）则跳过；发送失败回滚，下一拍重试。
 */
export async function sendWecomAlertOnce(
  fired: Set<string>,
  key: string,
  opts: { webhook: string; host: string; kind: string; detail: string }
): Promise<void> {
  if (!opts.webhook || fired.has(key)) return;
  fired.add(key);
  try {
    await api.notifyHostAlert({
      webhook: opts.webhook,
      host: opts.host,
      kind: opts.kind,
      state: "down",
      detail: opts.detail,
      titleSuffix: "",
      expired: false,
    });
  } catch {
    fired.delete(key);
  }
}

/**
 * 企微恢复通知：只应在「曾发出过企微告警」后调用。
 * 频道闸门：notifyEnabled + webhook（effectiveWecomWebhook）。
 * 恢复总闸 notifyRecoverEnabled 由调用方在发任何通道前判断。
 */
export async function sendWecomRecover(opts: {
  host: string;
  kind: string;
}): Promise<void> {
  const settings = useSettingsStore();
  const webhook = settings.effectiveWecomWebhook();
  if (!webhook) return;
  try {
    await api.notifyHostAlert({
      webhook,
      host: opts.host,
      kind: opts.kind,
      state: "up",
      detail: "",
      titleSuffix: "",
      expired: false,
    });
  } catch {
    /* 恢复通知失败不回填 */
  }
}
