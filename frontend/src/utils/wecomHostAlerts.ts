import {
  ALL_ALERT_KINDS,
  isResourceAlertKind,
} from "@/utils/alerts";
import {
  appendAndNotifyDesktop,
  sendWecomAlertOnce,
  sendWecomRecover,
} from "@/utils/alertNotify";
import { useSettingsStore } from "@/stores/settings";

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
  return useSettingsStore().isResourceNotifySubscribed(host, kind);
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

/**
 * 主机资源告警出口（须该主机已订阅该类型）：
 * - 系统通知 + 应用内历史
 * - 总开关开启、该告警类型勾选且有 Webhook：再推企业微信
 * 应用内 toast 由 Overview/GroupOverview 自行弹出，同样按订阅过滤。
 */
export async function fireHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  detail: string;
}): Promise<void> {
  // 客户端与目标主机断开不告警（多监控端各自断线会刷屏）
  if (opts.kind === "conn") return;

  const settings = useSettingsStore();
  if (!settings.isResourceNotifySubscribed(opts.host, opts.kind)) return;

  const title = `「${opts.host}」${kindLabel(opts.kind)}超阈值`;
  const body = opts.detail || title;

  // 系统通知 + 历史：进程内按 key 去重直到回落
  if (!firedLocal.has(opts.key)) {
    firedLocal.add(opts.key);
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "down",
      title,
      body,
    });
  }

  if (!settings.isWecomKindEnabled(opts.kind)) return;
  const webhook = settings.effectiveWecomWebhook();
  if (!webhook) return;
  await sendWecomAlertOnce(firedWecom, opts.key, {
    webhook,
    host: opts.host,
    kind: opts.kind,
    detail: opts.detail,
  });
}

export async function clearHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
}): Promise<void> {
  if (opts.kind === "conn") return;

  const hadLocal = firedLocal.delete(opts.key);
  const hadWecom = firedWecom.delete(opts.key);
  if (!hadLocal && !hadWecom) return;

  if (hadLocal) {
    const title = `「${opts.host}」${kindLabel(opts.kind)}已回落`;
    const body = `${kindLabel(opts.kind)}已恢复到阈值以下`;
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: opts.kind,
      state: "up",
      title,
      body,
    });
  }

  if (!hadWecom) return;
  await sendWecomRecover({ host: opts.host, kind: opts.kind });
}
