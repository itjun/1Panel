import {
  ALERT_KIND_LABEL,
  ALL_ALERT_KINDS,
  isResourceAlertKind,
  type AlertStartLevel,
} from "@/utils/alerts";
import {
  appendAndNotifyDesktop,
  notifyMessageFor,
  sendWecomAlertOnce,
  sendWecomEscalation,
  sendWecomRecover,
  type NotifyTextParts,
} from "@/utils/alertNotify";
import { settingsAccess } from "@/utils/settingsAccess";

/** 已发企微、尚未回落的告警键（host|kind） */
const firedWecom = new Set<string>();
/** 已发系统通知 / 写历史、尚未回落的告警键 → 告警事件 id（恢复时配对） */
const firedLocal = new Map<string, string>();

/** 告警类型：资源四类 + 连接（conn 仅本地通知，不发企微） */
export type HostWecomKind = (typeof ALL_ALERT_KINDS)[number] | "conn";

export function hostWecomKindFromKey(key: string): HostWecomKind | "" {
  const i = key.lastIndexOf("|");
  const k = i >= 0 ? key.slice(i + 1) : key;
  if (k === "conn") return "conn";
  return isResourceAlertKind(k) ? k : "";
}

/** 页内 toast：连接失败仍提示；资源类须该主机已订阅该类型 */
export function shouldToastHostAlert(
  host: string,
  kind: HostWecomKind | ""
): boolean {
  if (!kind) return false;
  if (kind === "conn") return true;
  return settingsAccess().isResourceNotifySubscribed(host, kind);
}

function kindLabel(kind: HostWecomKind): string {
  if (kind === "conn") return "连接";
  return ALERT_KIND_LABEL[kind] || kind;
}

function resourceParts(
  host: string,
  kind: HostWecomKind,
  parts?: NotifyTextParts,
  detail?: string
): NotifyTextParts {
  if (parts) {
    return {
      ...parts,
      hostName: parts.hostName || host,
      metric: parts.metric || kindLabel(kind),
    };
  }
  return {
    hostName: host,
    metric: kindLabel(kind),
    value: (detail || "").trim() || undefined,
  };
}

/**
 * 主机资源告警出口：
 * 1. 主机订阅该类型
 * 2. 全局内容类型开启
 * 3. 再按频道：系统/应用内 / 企微(notifyEnabled+webhook)
 * 正文字段按 notifyContentFields 勾选。
 */
export async function fireHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  detail?: string;
  parts?: NotifyTextParts;
  /** 资源告警进入的档位 */
  level?: AlertStartLevel;
}): Promise<void> {
  // 客户端与目标主机断开不告警（多监控端各自断线会刷屏）
  if (opts.kind === "conn") return;

  const settings = settingsAccess();
  if (!settings.isResourceNotifySubscribed(opts.host, opts.kind)) return;
  if (!settings.isContentKindEnabled(opts.kind)) return;

  const parts = resourceParts(opts.host, opts.kind, opts.parts, opts.detail);
  const message = notifyMessageFor({ state: "down", kind: "resource", parts, level: opts.level });
  const webhook = settings.effectiveWecomWebhook();

  // 系统通知 + 历史：进程内按 key 去重直到回落
  if (!firedLocal.has(opts.key)) {
    firedLocal.set(opts.key, "");
    const eventId = await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "down",
      stage: "fire",
      message,
      parts,
      wecom: !!webhook,
    });
    if (firedLocal.has(opts.key)) firedLocal.set(opts.key, eventId);
  }

  if (!webhook) return;
  await sendWecomAlertOnce(firedWecom, opts.key, {
    webhook,
    host: opts.host,
    kind: opts.kind,
    message,
  });
}

/**
 * 升级出口：起推档为警告、读数升到危险档时，沿用原告警的 incidentId 再推一条。
 * 系统通知与应用内各一条；企微只在原告警发过时多推这一次。
 */
export async function escalateHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  parts?: NotifyTextParts;
}): Promise<void> {
  if (opts.kind === "conn") return;
  const hadLocal = firedLocal.has(opts.key);
  const hadWecom = firedWecom.has(opts.key);
  if (!hadLocal && !hadWecom) return;

  const settings = settingsAccess();
  if (!settings.isResourceNotifySubscribed(opts.host, opts.kind)) return;
  if (!settings.isContentKindEnabled(opts.kind)) return;

  const parts = resourceParts(opts.host, opts.kind, opts.parts);
  const message = notifyMessageFor({
    state: "down",
    kind: "resource",
    parts,
    level: "danger",
    escalated: true,
  });
  const webhook = hadWecom ? settings.effectiveWecomWebhook() : "";
  if (hadLocal) {
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "down",
      stage: "escalate",
      message,
      parts,
      incidentId: firedLocal.get(opts.key) || "",
      wecom: !!webhook,
    });
  }
  if (webhook) {
    await sendWecomEscalation({ webhook, host: opts.host, kind: opts.kind, message });
  }
}

/**
 * 重复提醒出口：告警未回落、到了重复间隔时再推一条，沿用原告警的 incidentId。
 * 三个渠道各推一条，企微每次都推（需该事件发过企微）。
 */
export async function repeatHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  level: AlertStartLevel;
  durationMs: number;
  parts?: NotifyTextParts;
}): Promise<void> {
  if (opts.kind === "conn") return;
  const hadLocal = firedLocal.has(opts.key);
  const hadWecom = firedWecom.has(opts.key);
  if (!hadLocal && !hadWecom) return;

  const settings = settingsAccess();
  if (!settings.isResourceNotifySubscribed(opts.host, opts.kind)) return;
  if (!settings.isContentKindEnabled(opts.kind)) return;

  const parts = resourceParts(opts.host, opts.kind, opts.parts);
  const message = notifyMessageFor({
    state: "down",
    kind: "resource",
    parts,
    level: opts.level,
    repeatMs: opts.durationMs,
  });
  const webhook = hadWecom ? settings.effectiveWecomWebhook() : "";
  if (hadLocal) {
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "down",
      stage: "repeat",
      message,
      parts,
      incidentId: firedLocal.get(opts.key) || "",
      wecom: !!webhook,
    });
  }
  if (webhook) {
    await sendWecomEscalation({ webhook, host: opts.host, kind: opts.kind, message });
  }
}

export async function clearHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  parts?: NotifyTextParts;
  /** 本次事件到过的最高档 */
  level?: AlertStartLevel;
}): Promise<void> {
  if (opts.kind === "conn") return;

  const hadLocal = firedLocal.has(opts.key);
  const incidentId = firedLocal.get(opts.key) || "";
  firedLocal.delete(opts.key);
  const hadWecom = firedWecom.delete(opts.key);
  if (!hadLocal && !hadWecom) return;

  const settings = settingsAccess();
  // 恢复总闸关：清去重态后三通道都不发
  if (!settings.notifyRecoverEnabled) return;
  // 内容类型当下关闭也不发恢复
  if (!settings.isContentKindEnabled(opts.kind)) return;

  const parts = resourceParts(opts.host, opts.kind, opts.parts);
  const message = notifyMessageFor({ state: "up", kind: "resource", parts, level: opts.level });
  if (hadLocal) {
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "up",
      message,
      parts,
      incidentId,
      wecom: hadWecom && !!settings.effectiveWecomWebhook(),
    });
  }

  if (!hadWecom) return;
  await sendWecomRecover({ host: opts.host, kind: opts.kind, message });
}
