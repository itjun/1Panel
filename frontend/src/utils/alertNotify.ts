/**
 * 告警通知共享出口：资源告警（wecomHostAlerts）、应用探活告警（appWatchAlerts）、证书告警共用。
 *
 * 三层闸门（调用方先过 1~3，本文件负责频道分发）：
 * 1. 主机订阅
 * 2. 全局内容类型 isContentKindEnabled
 * 3. 恢复事件须 notifyRecoverEnabled
 * 4. 频道：systemNotifyEnabled / inAppNotifyEnabled / notifyEnabled+webhook
 */

import { api } from "@/api";
import type { main } from "@/api";
import { settingsAccess } from "@/utils/settingsAccess";
import type { AlertStartLevel } from "@/utils/alerts";
import {
  buildNotifyMessage,
  type NotifyMessage,
  type NotifyMessageKind,
  type NotifyTextParts,
} from "@/utils/notifyMessage";

export type { NotifyTextParts } from "@/utils/notifyMessage";

/** 按当前「正文带上」勾选生成消息 */
export function notifyMessageFor(opts: {
  state: "down" | "up";
  kind: NotifyMessageKind;
  parts: NotifyTextParts;
  level?: AlertStartLevel;
  escalated?: boolean;
  repeatMs?: number;
}): NotifyMessage {
  return buildNotifyMessage({
    ...opts,
    fields: settingsAccess().notifyContentFields,
  });
}

/** 企微入参：标题与逐行正文取自同一份消息 */
export function hostAlertPayload(opts: {
  webhook: string;
  host: string;
  kind: string;
  state: "down" | "up";
  message: NotifyMessage;
}): main.HostAlertNotify {
  return {
    webhook: opts.webhook,
    host: opts.host,
    kind: opts.kind,
    state: opts.state,
    detail: opts.message.body,
    titleSuffix: "",
    expired: false,
    title: opts.message.title,
    lines: opts.message.lines,
    level: opts.message.level || "",
  };
}

/**
 * 写入应用内历史 → 系统通知（带 eventId）→ 刷新未读。
 * 分别受 inAppNotifyEnabled / systemNotifyEnabled 控制。
 * 返回历史事件 id（未写历史为空串），恢复事件用它作 incidentId 配对。
 */
export async function appendAndNotifyDesktop(opts: {
  host: string;
  kind: string;
  state: "down" | "up";
  message: NotifyMessage;
  /** 结构化读数全量入库，详情页不受「正文带上」影响 */
  parts?: NotifyTextParts;
  /** 恢复事件指向对应告警事件 id */
  incidentId?: string;
  /** 资源告警的阶段：首发 / 升级 / 重复提醒 */
  stage?: "fire" | "escalate" | "repeat";
  /** 本次还会发企微（只用于记录送达渠道） */
  wecom?: boolean;
  /** 系统通知点击要定位到历史行时，应用内关闭也写入历史 */
  historyForClick?: boolean;
}): Promise<string> {
  const settings = settingsAccess();
  const wantInApp = settings.inAppNotifyEnabled;
  const wantSystem = settings.systemNotifyEnabled;
  const wantHistory = wantInApp || (!!opts.historyForClick && wantSystem);

  const channels: string[] = [];
  if (wantSystem) channels.push("system");
  if (wantInApp) channels.push("inApp");
  if (opts.wecom) channels.push("wecom");

  let eventId = "";
  // 只发企微时也写一条历史，保证恢复能配对、消息页能看到送达记录
  if (wantHistory || opts.wecom) {
    try {
      const parts = opts.parts || {};
      const saved = await api.appendAlertHistory({
        id: "",
        incidentId: opts.incidentId || "",
        host: opts.host,
        kind: opts.kind,
        state: opts.state,
        title: opts.message.title,
        detail: opts.message.body,
        level: opts.message.level || "",
        stage: opts.stage || "",
        metric: parts.metric || "",
        value: parts.value || "",
        threshold: parts.threshold || "",
        peak: parts.peak || "",
        service: parts.service || "",
        channels,
        at: 0,
        read: !wantInApp,
      });
      eventId = saved.id || "";
    } catch {
      /* 历史失败不阻断系统通知 */
    }
  }

  if (wantSystem) {
    void api
      .notifyDesktop(opts.message.title, opts.message.body, {
        host: opts.host,
        eventId,
        kind: opts.kind,
      })
      .catch(() => {});
  }

  if (eventId) {
    window.dispatchEvent(new Event("alerts-changed"));
  }
  return eventId;
}

/**
 * 企微告警下发（含去重与失败重试）：
 * webhook 为空或该键已发过（key 在 fired 集合中）则跳过；发送失败回滚，下一拍重试。
 */
export async function sendWecomAlertOnce(
  fired: Set<string>,
  key: string,
  opts: { webhook: string; host: string; kind: string; message: NotifyMessage }
): Promise<void> {
  if (!opts.webhook || fired.has(key)) return;
  fired.add(key);
  try {
    await api.notifyHostAlert(
      hostAlertPayload({ ...opts, state: "down" })
    );
  } catch {
    fired.delete(key);
  }
}

/** 企微补推（升级、重复提醒）：同一次事件额外推一次；失败不重试 */
export async function sendWecomEscalation(opts: {
  webhook: string;
  host: string;
  kind: string;
  message: NotifyMessage;
}): Promise<boolean> {
  if (!opts.webhook) return false;
  try {
    await api.notifyHostAlert(hostAlertPayload({ ...opts, state: "down" }));
    return true;
  } catch {
    return false;
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
  message: NotifyMessage;
}): Promise<void> {
  const webhook = settingsAccess().effectiveWecomWebhook();
  if (!webhook) return;
  try {
    await api.notifyHostAlert(
      hostAlertPayload({ ...opts, webhook, state: "up" })
    );
  } catch {
    /* 恢复通知失败不回填 */
  }
}
