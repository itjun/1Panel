import { api } from "@/api";
import { useSettingsStore } from "@/stores/settings";

/** 已发企微、尚未回落的告警键（host|kind） */
const firedWecom = new Set<string>();
/** 已发系统通知、尚未回落的告警键（未订阅主机也走这条） */
const firedLocal = new Set<string>();

export type HostWecomKind = "mem" | "cpu" | "disk" | "load" | "conn";

function isHostWecomKind(k: string): k is HostWecomKind {
  return (
    k === "mem" || k === "cpu" || k === "disk" || k === "load" || k === "conn"
  );
}

export function hostWecomKindFromKey(key: string): HostWecomKind | "" {
  const i = key.lastIndexOf("|");
  const k = i >= 0 ? key.slice(i + 1) : key;
  return isHostWecomKind(k) ? k : "";
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
 * 主机资源告警出口：
 * - 始终：系统通知（通知中心）；应用内通知由 Overview/GroupOverview 自行弹出
 * - 仅已订阅企微的主机：再推企业微信
 */
export async function fireHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  detail: string;
}): Promise<void> {
  // 客户端与目标主机断开不告警（多监控端各自断线会刷屏）
  if (opts.kind === "conn") return;

  const title = `「${opts.host}」${kindLabel(opts.kind)}超阈值`;
  const body = opts.detail || title;

  // 系统通知：订阅与否都发；进程内按 key 去重直到回落
  if (!firedLocal.has(opts.key)) {
    firedLocal.add(opts.key);
    void api.notifyDesktop(title, body).catch(() => {});
  }

  const settings = useSettingsStore();
  if (!settings.isWecomSubscribed(opts.host)) return;
  const webhook = settings.effectiveWecomWebhook();
  if (!webhook) return;
  if (firedWecom.has(opts.key)) return;
  firedWecom.add(opts.key);
  try {
    await api.notifyHostAlert({
      webhook,
      host: opts.host,
      kind: opts.kind,
      state: "down",
      detail: opts.detail,
    });
  } catch {
    firedWecom.delete(opts.key);
  }
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
    void api
      .notifyDesktop(title, `${kindLabel(opts.kind)}已恢复到阈值以下`)
      .catch(() => {});
  }

  if (!hadWecom) return;
  const settings = useSettingsStore();
  if (!settings.isWecomSubscribed(opts.host)) return;
  const webhook = settings.effectiveWecomWebhook();
  if (!webhook) return;
  try {
    await api.notifyHostAlert({
      webhook,
      host: opts.host,
      kind: opts.kind,
      state: "up",
      detail: "",
    });
  } catch {
    /* 恢复通知失败不回填 */
  }
}
