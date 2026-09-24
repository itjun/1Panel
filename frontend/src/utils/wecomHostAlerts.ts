import {
  ALL_ALERT_KINDS,
  isResourceAlertKind,
} from "@/utils/alerts";
import {
  appendAndNotifyDesktop,
  buildNotifyCopy,
  sendWecomAlertOnce,
  sendWecomRecover,
  type NotifyTextParts,
} from "@/utils/alertNotify";
import { settingsAccess } from "@/utils/settingsAccess";

/** 已发企微、尚未回落的告警键（host|kind） */
const firedWecom = new Set<string>();
/** 已发系统通知、尚未回落的告警键 */
const firedLocal = new Set<string>();

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
  switch (kind) {
    case "mem":
      return "内存";
    case "cpu":
      return "CPU";
    case "disk":
      return "磁盘";
    case "load":
      return "负载";
    case "conn":
      return "连接";
    default:
      return kind;
  }
}

function resourceParts(
  host: string,
  kind: HostWecomKind,
  parts?: NotifyTextParts,
  detail?: string
): NotifyTextParts {
  if (parts) {
    return {
      hostName: parts.hostName || host,
      metric: parts.metric || kindLabel(kind),
      threshold: parts.threshold,
      value: parts.value,
      service: parts.service,
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
}): Promise<void> {
  // 客户端与目标主机断开不告警（多监控端各自断线会刷屏）
  if (opts.kind === "conn") return;

  const settings = settingsAccess();
  if (!settings.isResourceNotifySubscribed(opts.host, opts.kind)) return;
  if (!settings.isContentKindEnabled(opts.kind)) return;

  const copy = buildNotifyCopy({
    state: "down",
    kind: "resource",
    parts: resourceParts(opts.host, opts.kind, opts.parts, opts.detail),
  });

  // 系统通知 + 历史：进程内按 key 去重直到回落
  if (!firedLocal.has(opts.key)) {
    firedLocal.add(opts.key);
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "down",
      title: copy.title,
      body: copy.body,
    });
  }

  const webhook = settings.effectiveWecomWebhook();
  if (!webhook) return;
  await sendWecomAlertOnce(firedWecom, opts.key, {
    webhook,
    host: opts.host,
    kind: opts.kind,
    detail: copy.body,
  });
}

export async function clearHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  parts?: NotifyTextParts;
}): Promise<void> {
  if (opts.kind === "conn") return;

  const hadLocal = firedLocal.delete(opts.key);
  const hadWecom = firedWecom.delete(opts.key);
  if (!hadLocal && !hadWecom) return;

  const settings = settingsAccess();
  // 恢复总闸关：清去重态后三通道都不发
  if (!settings.notifyRecoverEnabled) return;
  // 内容类型当下关闭也不发恢复
  if (!settings.isContentKindEnabled(opts.kind)) return;

  if (hadLocal) {
    const copy = buildNotifyCopy({
      state: "up",
      kind: "resource",
      parts: resourceParts(opts.host, opts.kind, opts.parts),
    });
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "up",
      title: copy.title,
      body: copy.body,
    });
  }

  if (!hadWecom) return;
  await sendWecomRecover({ host: opts.host, kind: opts.kind });
}
