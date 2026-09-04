import { api } from "@/api";
import { useSettingsStore } from "@/stores/settings";

/** 已向企微发出、尚未恢复的告警键（host|kind），进程内去重 */
const fired = new Set<string>();

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

export async function fireHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
  detail: string;
}): Promise<void> {
  // 客户端与目标主机断开不发企微（多监控端各自断线会刷屏）
  if (opts.kind === "conn") return;
  const webhook = useSettingsStore().effectiveWecomWebhook();
  if (!webhook) return;
  if (fired.has(opts.key)) return;
  fired.add(opts.key);
  try {
    await api.notifyHostAlert({
      webhook,
      host: opts.host,
      kind: opts.kind,
      state: "down",
      detail: opts.detail,
    });
  } catch {
    fired.delete(opts.key);
  }
}

export async function clearHostWecom(opts: {
  key: string;
  host: string;
  kind: HostWecomKind;
}): Promise<void> {
  if (opts.kind === "conn") return;
  if (!fired.has(opts.key)) return;
  const webhook = useSettingsStore().effectiveWecomWebhook();
  fired.delete(opts.key);
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
    /* 恢复通知失败不回填 fired */
  }
}
