/**
 * 证书到期告警。
 *
 * 检测在 spanel-agent：每天主机本地时间 06:00 扫 /etc/nginx/cert，结果留在主机上。
 * 面板在线（含挂后台）时来取。同一张证书（域名 + 颁发者 + 到期时间）每个主机本地日一条，
 * 剩余天数 < 30（含已过期）就继续催，直到这组剩余 ≥ 30 或文件没了。
 * 面板断了几天，打开时按最新一次扫描补一条，不按漏掉的天数补。
 */

import { api } from "@/api";
import type { agentcli, certnotify } from "@/api";
import { useSettingsStore } from "@/stores/settings";
import { appendAndNotifyDesktop } from "@/utils/alertNotify";

const POLL_MS = 60_000;
const UNSUPPORTED_BACKOFF_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastTickAt = 0;
/** 旧 agent 没有 /collect/cert-check 时，这台主机先停一小时再试 */
const unsupportedUntil = new Map<string, number>();

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sentKey(state: "down" | "up", domainKey: string): string {
  return `${state}|${domainKey}`;
}

async function sendLocal(
  host: string,
  state: "down" | "up",
  notice: certnotify.Notice
): Promise<void> {
  await appendAndNotifyDesktop({
    host,
    kind: "cert",
    state,
    title: notice.title,
    body: notice.body,
    historyForClick: true,
  });
}

async function sendWecom(
  host: string,
  state: "down" | "up",
  notice: certnotify.Notice
): Promise<void> {
  const webhook = useSettingsStore().effectiveWecomWebhook();
  if (!webhook) return;
  await api.notifyHostAlert({
    webhook,
    host,
    kind: "cert",
    state,
    detail: notice.body,
    titleSuffix: notice.title,
    expired: false,
  });
}

/** 本进程里已经送到的频道。落盘失败时同一轮进程不再重发。 */
const delivered = new Map<string, { desktop: boolean; wecom: boolean }>();

function deliveryId(host: string, date: string, key: string): string {
  return `${host}|${date}|${key}`;
}

async function pollHost(host: string): Promise<void> {
  const settings = useSettingsStore();
  if (!settings.isCertNotifySubscribed(host)) return;
  if (!settings.isContentKindEnabled("cert")) return;
  if ((unsupportedUntil.get(host) || 0) > Date.now()) return;

  let snap: agentcli.CertCheckSnapshot;
  try {
    snap = await api.collectCertCheck(host);
  } catch (err) {
    if (errorText(err).includes("404")) {
      unsupportedUntil.set(host, Date.now() + UNSUPPORTED_BACKOFF_MS);
    }
    return;
  }
  unsupportedUntil.delete(host);
  if (!snap?.scanned || !snap.localDate) return;

  try {
    const cursor = await api.getCertNotifyCursor(host);
    const day = snap.localDate;
    if ((cursor.appliedDate || "") === day) return;

    const plan = await api.planCertNotify(host, snap, cursor.nagging || []);
    const nags = plan.nags || [];
    const recoveries = settings.notifyRecoverEnabled ? plan.recoveries || [] : [];
    const needDesktop =
      settings.inAppNotifyEnabled || settings.systemNotifyEnabled;
    const needWecom = !!settings.effectiveWecomWebhook();
    const items: { state: "down" | "up"; notice: certnotify.Notice }[] = [
      ...nags.map((notice) => ({ state: "down" as const, notice })),
      ...recoveries.map((notice) => ({ state: "up" as const, notice })),
    ];
    if (items.length && !needDesktop && !needWecom) return;

    let sent: certnotify.Sent[] =
      cursor.partialDate === day ? [...(cursor.sent || [])] : [];

    const flagsOf = (key: string) => {
      const disk = sent.find((item) => item.key === key);
      const mem = delivered.get(deliveryId(host, day, key));
      return {
        desktop: !!(disk?.desktop || mem?.desktop),
        wecom: !!(disk?.wecom || mem?.wecom),
      };
    };
    const remember = (
      key: string,
      patch: { desktop?: boolean; wecom?: boolean }
    ) => {
      const prev = flagsOf(key);
      const next = { ...prev, ...patch };
      delivered.set(deliveryId(host, day, key), next);
      const row = { key, desktop: next.desktop, wecom: next.wecom };
      const index = sent.findIndex((item) => item.key === key);
      if (index >= 0) sent[index] = row;
      else sent = [...sent, row];
    };
    const save = async (done: boolean) => {
      await api.commitCertNotifyCursor(host, {
        appliedDate: done ? day : cursor.appliedDate || "",
        nagging: done ? plan.nextNagging || [] : cursor.nagging || [],
        partialDate: done ? "" : day,
        sent: done ? [] : sent,
      });
    };

    for (const item of items) {
      const key = sentKey(item.state, item.notice.domainKey);
      const flags = flagsOf(key);
      if (needDesktop && !flags.desktop) {
        await sendLocal(host, item.state, item.notice);
        remember(key, { desktop: true });
        await save(false);
      }
      if (needWecom && !flagsOf(key).wecom) {
        try {
          await sendWecom(host, item.state, item.notice);
        } catch {
          await save(false);
          return;
        }
        remember(key, { wecom: true });
        await save(false);
      }
    }
    await save(true);
  } catch {
    /* 落盘失败时本进程的 delivered 挡住重复系统通知，下一轮再补记 */
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  const now = Date.now();
  if (now - lastTickAt < POLL_MS - 400) return;
  lastTickAt = now;
  ticking = true;
  try {
    const hosts = useSettingsStore().hostsWithCertNotifySubs();
    if (!hosts.length) return;
    await Promise.all(hosts.map((host) => pollHost(host)));
  } finally {
    ticking = false;
  }
}

/** 启动证书告警轮询。只打已订阅主机，空名单不扫。 */
export function startCertAlertPoll(): void {
  stopCertAlertPoll();
  void tick();
  timer = window.setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopCertAlertPoll(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function tickCertAlertPoll(): void {
  void tick();
}
