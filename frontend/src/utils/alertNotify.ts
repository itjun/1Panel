/**
 * 告警通知共享出口：资源告警（wecomHostAlerts）与应用探活告警（appWatchAlerts）共用。
 */

import { api } from "@/api";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import {
  expandWecomWebhook,
  useSettingsStore,
} from "@/stores/settings";

/** 写入应用内历史 → 系统通知（带 eventId）→ 刷新未读 */
export async function appendAndNotifyDesktop(opts: {
  host: string;
  kind: string;
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
    });
  } catch {
    fired.delete(key);
  }
}

/**
 * 企微恢复通知：只应在「曾发出过企微告警」后调用（历史事实，由调用方判断）。
 * 不走 effectiveWecomWebhook（受总开关 gating）——订阅/类型开关/总开关以「当下」判断
 * 会吞掉恢复通知，让企微侧永远停在告警态；因此直接取已保存的 webhook。
 * webhook 变更属可接受误差（换群收不到旧告警的恢复）。失败不回填（恢复丢了不重发）。
 */
export async function sendWecomRecover(opts: {
  host: string;
  kind: string;
}): Promise<void> {
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
