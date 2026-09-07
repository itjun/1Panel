import { api } from "@/api";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import {
  expandWecomWebhook,
  useSettingsStore,
} from "@/stores/settings";
import {
  ALL_ALERT_KINDS,
  isResourceAlertKind,
} from "@/utils/alerts";

/** 已发企微、尚未回落的告警键（host|kind） */
const firedWecom = new Set<string>();
/** 已发系统通知、尚未回落的告警键（未订阅主机也走这条） */
const firedLocal = new Set<string>();

/** 告警类型：资源四类 + 连接（conn 仅本地通知，不发企微） */
export type HostWecomKind = (typeof ALL_ALERT_KINDS)[number] | "conn";

export function hostWecomKindFromKey(key: string): HostWecomKind | "" {
  const i = key.lastIndexOf("|");
  const k = i >= 0 ? key.slice(i + 1) : key;
  if (k === "conn") return "conn";
  return isResourceAlertKind(k) ? k : "";
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

/** 写入应用内历史 → 系统通知（带 eventId）→ 刷新未读 */
async function appendAndNotifyDesktop(opts: {
  host: string;
  kind: HostWecomKind;
  state: "down" | "up";
  title: string;
  body: string;
}): Promise<void> {
  let eventId = "";
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
  void api
    .notifyDesktop(opts.title, opts.body, {
      host: opts.host,
      eventId,
      kind: opts.kind,
    })
    .catch(() => {});
  void useAlertHistoryStore().refresh();
}

/**
 * 主机资源告警出口：
 * - 始终：系统通知（通知中心）+ 应用内历史；应用内 toast 由 Overview/GroupOverview 自行弹出
 * - 仅已订阅企微、且该告警类型在设置中勾选的主机：再推企业微信
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

  // 系统通知 + 历史：订阅与否都发；进程内按 key 去重直到回落
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

  const settings = useSettingsStore();
  if (!settings.isWecomSubscribed(opts.host)) return;
  if (!settings.isWecomKindEnabled(opts.kind)) return;
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
  // 恢复只看历史事实（曾发过企微）；订阅/类型开关/总开关以「当下」判断会吞掉恢复通知，
  // 让企微侧永远停在告警态。因此这里直接取已保存的 webhook（不走 effectiveWecomWebhook，
  // 那个受总开关 gating）。webhook 变更属可接受误差（换群收不到旧告警的恢复）。
  const settings = useSettingsStore();
  const webhook = expandWecomWebhook(settings.wecomWebhook);
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
