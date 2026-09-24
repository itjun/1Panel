import { useMutation, useQuery } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice, Page } from "@/react/components/page";
import {
  updateSettings,
  useSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";
import {
  UNGROUPED_ID,
  useSession,
  type NotifySection,
} from "@/react/state/session";
import { ALERT_RULES, type ResourceAlertKind } from "@/utils/alerts";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import {
  parseAppAlertKind,
  WATCH_SERVICE_META,
  WATCH_SERVICE_ORDER,
  type WatchServiceName,
} from "@/utils/watchServices";

/*
 * INTEGRATION（系统通知点进来 → 定位消息）：
 * 本页会消费 Wails 事件 `alert-open-host`（payload: { host?, eventId? }）以及
 * window 自定义事件 `1pannel-focus-alert`（detail 同结构），并读取
 * sessionStorage 键 `1pannel-focus-alert-id`（仅 eventId 字符串）。
 *
 * 入口路由必须在 App.tsx 监听 `alert-open-host`：切到 workspace=notify、
 * 按告警类型 setNotifySection(metricMessages|appMessages)、focusMainWindow，
 * 再写入上述 sessionStorage 或 dispatch `1pannel-focus-alert`（本页挂载后才能滚到行）。
 * 本文件禁止改 App.tsx，故导航侧留给 App 接线。
 */

const FOCUS_ALERT_STORAGE_KEY = "1pannel-focus-alert-id";
const FOCUS_ALERT_WINDOW_EVENT = "1pannel-focus-alert";

const WECOM_WEBHOOK_PREFIX =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=";

/** 只填 key 时补成完整 URL，便于复制和测试 */
function expandWecomWebhook(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return WECOM_WEBHOOK_PREFIX + v;
}

type FocusAlertPayload = { host?: string; eventId?: string };

const CONTENT_LABEL: Record<AlertContentKind, string> = {
  cpu: "CPU",
  mem: "内存",
  disk: "磁盘",
  load: "负载",
  app: "应用探活",
  cert: "证书到期",
};

const FIELD_LABEL: Record<NotifyContentField, string> = {
  hostName: "主机名",
  metric: "指标",
  threshold: "阈值",
  value: "当前值",
  service: "服务",
};

const METRIC_KIND_FILTERS = [
  { value: "all", label: "全部" },
  { value: "cpu", label: "CPU" },
  { value: "mem", label: "内存" },
  { value: "disk", label: "磁盘" },
  { value: "load", label: "负载" },
  { value: "cert", label: "证书" },
] as const;

const READ_FILTERS = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "read", label: "已读" },
] as const;

const STATE_FILTERS = [
  { value: "all", label: "全部状态" },
  { value: "down", label: "告警" },
  { value: "up", label: "恢复" },
] as const;

export function NotifyPage() {
  const session = useSession();
  const [focusAlertId, setFocusAlertId] = useState("");
  const setNotifySection = session.setNotifySection;

  useEffect(() => {
    let cancelled = false;

    async function applyFocus(payload: FocusAlertPayload) {
      const payloadEventId = (payload.eventId || "").trim();
      const host = (payload.host || "").trim();
      let events: Awaited<ReturnType<typeof api.listAlertHistory>> = [];
      try {
        events = await api.listAlertHistory(300);
      } catch {
        /* 列表失败仍尽量用 payload 里的 id */
      }
      if (cancelled) return;

      let focusId = payloadEventId;
      if (!focusId && host) {
        const list = events.filter((e) => (e.host || "").trim() === host);
        const unread = list.find((e) => !e.read);
        focusId = unread?.id || list[0]?.id || "";
      }
      if (!focusId) return;

      const ev = events.find((e) => e.id === focusId);
      const appEv = ev ? isAppEvent(ev.kind || "") : false;
      setNotifySection(appEv ? "appMessages" : "metricMessages");
      setFocusAlertId(focusId);
      try {
        sessionStorage.removeItem(FOCUS_ALERT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }

    // 挂载时消费 App 预先写入的 id（从其它工作区点进来）
    try {
      const pending = (sessionStorage.getItem(FOCUS_ALERT_STORAGE_KEY) || "").trim();
      if (pending) void applyFocus({ eventId: pending });
    } catch {
      /* ignore */
    }

    const offWails = Events.On(
      "alert-open-host",
      (ev: { data?: FocusAlertPayload }) => {
        void applyFocus(ev?.data || {});
      },
    );

    const onWindowFocus = (ev: Event) => {
      const detail = (ev as CustomEvent<FocusAlertPayload>).detail || {};
      void applyFocus(detail);
    };
    window.addEventListener(FOCUS_ALERT_WINDOW_EVENT, onWindowFocus);

    return () => {
      cancelled = true;
      offWails();
      window.removeEventListener(FOCUS_ALERT_WINDOW_EVENT, onWindowFocus);
    };
  }, [setNotifySection]);

  if (session.notifySection === "setup") return <SetupPage />;
  if (session.notifySection === "metricSubs" || session.notifySection === "appSubs") {
    return <SubsPage kind={session.notifySection} />;
  }
  return (
    <MessagesPage
      kind={session.notifySection}
      focusAlertId={focusAlertId}
      onFocusConsumed={() => setFocusAlertId("")}
    />
  );
}

function isAppEvent(kind: string): boolean {
  return !!parseAppAlertKind(kind) || (kind || "").startsWith("app:");
}

function alertKindLabel(kind: string): string {
  const appSvc = parseAppAlertKind(kind);
  if (appSvc) return appSvc || "应用";
  if (kind === "mem") return "内存";
  if (kind === "cpu") return "CPU";
  if (kind === "disk") return "磁盘";
  if (kind === "load") return "负载";
  if (kind === "conn") return "连接";
  if (kind === "cert") return "证书";
  return kind || "—";
}

function alertStateLabel(state: string, kind = ""): string {
  if (kind === "cert") return state === "up" ? "已续期" : "到期";
  if (state === "up") return "已回落";
  return "超阈值";
}

function formatEventTime(at: number): string {
  if (!at) return "—";
  const d = new Date(at);
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mm}-${day} ${hh}:${mi}:${ss}`;
}

function MessagesPage({
  kind,
  focusAlertId,
  onFocusConsumed,
}: {
  kind: NotifySection;
  focusAlertId: string;
  onFocusConsumed: () => void;
}) {
  const [readFilter, setReadFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [highlightId, setHighlightId] = useState("");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const focusHandledRef = useRef("");
  const refetchTriedRef = useRef("");
  const onFocusConsumedRef = useRef(onFocusConsumed);
  onFocusConsumedRef.current = onFocusConsumed;
  const query = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.listAlertHistory(300),
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllAlertsRead(),
    onSuccess: () => void query.refetch(),
  });
  const rows = useMemo(() => {
    return (query.data || []).filter((event) => {
      const appEvent = isAppEvent(event.kind || "");
      if (kind === "appMessages" && !appEvent) return false;
      if (kind === "metricMessages" && appEvent) return false;
      if (kind === "metricMessages" && kindFilter !== "all" && event.kind !== kindFilter) {
        return false;
      }
      if (readFilter === "unread" && event.read) return false;
      if (readFilter === "read" && !event.read) return false;
      if (stateFilter !== "all" && event.state !== stateFilter) return false;
      return true;
    });
  }, [kind, kindFilter, query.data, readFilter, stateFilter]);

  const unreadCount = (query.data || []).filter((event) => {
    const appEvent = isAppEvent(event.kind || "");
    if (kind === "appMessages" && !appEvent) return false;
    if (kind === "metricMessages" && appEvent) return false;
    return !event.read;
  }).length;

  // 从系统通知点进来：放宽筛选 → 滚到行 → 标已读 → 短暂高亮
  useEffect(() => {
    const id = (focusAlertId || "").trim();
    if (!id) {
      focusHandledRef.current = "";
      refetchTriedRef.current = "";
      return;
    }
    if (focusHandledRef.current === id) return;
    if (!query.data) return;

    const target = query.data.find((e) => e.id === id);
    if (!target) {
      if (refetchTriedRef.current !== id) {
        refetchTriedRef.current = id;
        void query.refetch();
      }
      return;
    }

    const appEv = isAppEvent(target.kind || "");
    if (kind === "appMessages" && !appEv) return;
    if (kind === "metricMessages" && appEv) return;

    if (kind === "metricMessages" && kindFilter !== "all" && target.kind !== kindFilter) {
      setKindFilter("all");
      return;
    }
    if (readFilter === "unread" && target.read) {
      setReadFilter("all");
      return;
    }
    if (readFilter === "read" && !target.read) {
      setReadFilter("all");
      return;
    }
    if (stateFilter !== "all" && target.state !== stateFilter) {
      setStateFilter("all");
      return;
    }

    focusHandledRef.current = id;
    setHighlightId(id);
    window.requestAnimationFrame(() => {
      rowRefs.current[id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    if (!target.read) {
      void api.markAlertRead(id).then(() => query.refetch());
    }
  }, [
    focusAlertId,
    kind,
    kindFilter,
    query.data,
    query.refetch,
    readFilter,
    stateFilter,
  ]);

  // 高亮稍后清除，与列表 refetch 解耦，避免定时器被打断
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => {
      setHighlightId("");
      onFocusConsumedRef.current();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  return (
    <Page
      title={kind === "appMessages" ? "应用消息" : "指标消息"}
      actions={
        <>
          {kind === "metricMessages"
            ? METRIC_KIND_FILTERS.map((item) => (
                <Button
                  key={item.value}
                  variant={kindFilter === item.value ? "primary" : "secondary"}
                  onClick={() => setKindFilter(item.value)}
                >
                  {item.label}
                </Button>
              ))
            : null}
          {READ_FILTERS.map((item) => (
            <Button
              key={item.value}
              variant={readFilter === item.value ? "primary" : "secondary"}
              onClick={() => setReadFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
          {STATE_FILTERS.map((item) => (
            <Button
              key={item.value}
              variant={stateFilter === item.value ? "primary" : "secondary"}
              onClick={() => setStateFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
          <Button
            variant="primary"
            disabled={unreadCount <= 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            全部已读
          </Button>
          <Button onClick={() => void query.refetch()}>刷新</Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <Card className="overflow-hidden p-0">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="h-10 bg-[#f7f8fa]">
                <th className="px-3">时间</th>
                <th className="px-3">主机</th>
                <th className="px-3">类型</th>
                <th className="px-3">状态</th>
                <th className="px-3">摘要</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td className="px-3 text-muted" colSpan={5}>
                    暂无告警消息
                  </td>
                </tr>
              ) : (
                rows.map((event) => (
                  <tr
                    key={event.id}
                    ref={(node) => {
                      if (event.id) rowRefs.current[event.id] = node;
                    }}
                    className={
                      highlightId && event.id === highlightId
                        ? "h-12 cursor-pointer border-t border-line bg-accent/20 font-medium"
                        : event.read
                          ? "h-12 cursor-pointer border-t border-line hover:bg-[#f7f8fa]"
                          : "h-12 cursor-pointer border-t border-line bg-accent/5 font-medium hover:bg-accent/10"
                    }
                    onClick={() => {
                      if (!event.id || event.read) return;
                      void api.markAlertRead(event.id).then(() => query.refetch());
                    }}
                  >
                    <td className="whitespace-nowrap px-3">{formatEventTime(event.at)}</td>
                    <td className="whitespace-nowrap px-3">{event.host || "—"}</td>
                    <td className="whitespace-nowrap px-3">{alertKindLabel(event.kind)}</td>
                    <td
                      className={
                        event.state === "up"
                          ? "whitespace-nowrap px-3 text-[#1f7a3f]"
                          : "whitespace-nowrap px-3 text-[#a83232]"
                      }
                    >
                      {alertStateLabel(event.state, event.kind)}
                    </td>
                    <td className="max-w-[420px] truncate px-3">
                      {(event.title || event.detail || "").trim() || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

function serviceLabel(name: WatchServiceName): string {
  const meta = WATCH_SERVICE_META.find((item) => item.name === name);
  if (meta) return meta.label;
  return name;
}

function SubsPage({ kind }: { kind: "metricSubs" | "appSubs" }) {
  const session = useSession();
  const settings = useSettings();
  const [groupFilter, setGroupFilter] = useState("all");

  // 主机名 → 分组显示名（未分组统一「未分组」）
  const hostGroupLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const host of session.hosts) {
      const name = host.name || "";
      if (!name) continue;
      const gid = session.groupIdOf(name);
      map.set(name, gid ? session.groupName(gid) : session.groupName(UNGROUPED_ID));
    }
    return map;
  }, [session]);

  const groupButtons = useMemo(() => {
    const names = new Set<string>();
    for (const label of hostGroupLabel.values()) names.add(label);
    const sorted = [...names].sort((a, b) => {
      if (a === "未分组") return 1;
      if (b === "未分组") return -1;
      return a.localeCompare(b, "zh-CN");
    });
    return [
      { value: "all", label: "全部" },
      ...sorted.map((g) => ({ value: g, label: g })),
    ];
  }, [hostGroupLabel]);

  const hosts = useMemo(() => {
    const rows: string[] = [];
    for (const host of session.hosts) {
      const name = host.name || "";
      if (!name) continue;
      const label = hostGroupLabel.get(name) || "未分组";
      if (groupFilter !== "all" && label !== groupFilter) continue;
      rows.push(name);
    }
    rows.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return rows;
  }, [groupFilter, hostGroupLabel, session.hosts]);

  return (
    <Page
      title={kind === "metricSubs" ? "指标订阅" : "应用订阅"}
      actions={
        <>
          {groupButtons.map((item) => (
            <Button
              key={item.value}
              variant={groupFilter === item.value ? "primary" : "secondary"}
              onClick={() => setGroupFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </>
      }
    >
      <Card className="overflow-hidden p-0">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="h-10 bg-[#f7f8fa]">
                <th className="sticky left-0 z-10 bg-[#f7f8fa] px-3">主机</th>
                {kind === "metricSubs" ? (
                  <>
                    {ALERT_RULES.map((rule) => (
                      <th key={rule.kind} className="px-3 text-center">
                        {rule.name}
                      </th>
                    ))}
                    <th className="px-3 text-center">证书</th>
                  </>
                ) : (
                  WATCH_SERVICE_ORDER.map((svc) => (
                    <th key={svc} className="px-3 text-center">
                      {serviceLabel(svc)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {hosts.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td className="px-3 text-muted" colSpan={kind === "metricSubs" ? 6 : 9}>
                    没有匹配的主机
                  </td>
                </tr>
              ) : (
                hosts.map((host) => (
                  <tr key={host} className="h-12 border-t border-line">
                    <td className="sticky left-0 z-10 bg-surface px-3">{host}</td>
                    {kind === "metricSubs" ? (
                      <>
                        {ALERT_RULES.map((rule) => (
                          <td key={rule.kind} className="px-3 text-center">
                            <input
                              type="checkbox"
                              checked={(settings.hostResourceNotifySubs[host] || []).includes(
                                rule.kind,
                              )}
                              onChange={(event) =>
                                toggleResource(
                                  host,
                                  rule.kind,
                                  event.target.checked,
                                  settings.hostResourceNotifySubs,
                                )
                              }
                            />
                          </td>
                        ))}
                        <td className="px-3 text-center">
                          <input
                            type="checkbox"
                            checked={!!settings.hostCertNotifySubs[host]}
                            onChange={(event) =>
                              updateSettings({
                                hostCertNotifySubs: {
                                  ...settings.hostCertNotifySubs,
                                  [host]: event.target.checked,
                                },
                              })
                            }
                          />
                        </td>
                      </>
                    ) : (
                      WATCH_SERVICE_ORDER.map((svc) => (
                        <td key={svc} className="px-3 text-center">
                          <input
                            type="checkbox"
                            checked={(settings.hostAppNotifySubs[host] || []).includes(svc)}
                            onChange={(event) =>
                              toggleAppService(
                                host,
                                svc,
                                event.target.checked,
                                settings.hostAppNotifySubs,
                              )
                            }
                          />
                        </td>
                      ))
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

function toggleResource(
  host: string,
  kind: ResourceAlertKind,
  on: boolean,
  current: Record<string, ResourceAlertKind[]>,
) {
  const list = new Set(current[host] || []);
  if (on) list.add(kind);
  else list.delete(kind);
  updateSettings({ hostResourceNotifySubs: { ...current, [host]: [...list] } });
}

function toggleAppService(
  host: string,
  service: string,
  on: boolean,
  current: Record<string, string[]>,
) {
  const list = new Set(current[host] || []);
  if (on) list.add(service);
  else list.delete(service);
  updateSettings({ hostAppNotifySubs: { ...current, [host]: [...list] } });
}

function SetupPage() {
  const settings = useSettings();
  const [webhookDraft, setWebhookDraft] = useState(settings.wecomWebhook);
  const [webhookTested, setWebhookTested] = useState("");
  const [testing, setTesting] = useState(false);
  const [hint, setHint] = useState("");

  const draftNorm = webhookDraft.trim();
  const savedExpanded = expandWecomWebhook(settings.wecomWebhook);
  const draftExpanded = expandWecomWebhook(draftNorm);
  const webhookDirty = draftExpanded !== savedExpanded;
  const testedOk = !!draftNorm && webhookTested === draftNorm;

  // 设置里地址被别处改过时，同步草稿
  useEffect(() => {
    setWebhookDraft(settings.wecomWebhook);
    setWebhookTested("");
  }, [settings.wecomWebhook]);

  return (
    <Page title="通知设置">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card>
          <div className="mb-3 font-medium">送到哪里</div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.systemNotifyEnabled}
                onChange={(event) =>
                  updateSettings({ systemNotifyEnabled: event.target.checked })
                }
              />
              系统通知
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.inAppNotifyEnabled}
                onChange={(event) =>
                  updateSettings({ inAppNotifyEnabled: event.target.checked })
                }
              />
              应用内
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.notifyEnabled}
                onChange={(event) =>
                  updateSettings({ notifyEnabled: event.target.checked })
                }
              />
              企业微信
            </label>
          </div>
        </Card>

        <Card>
          <div className="mb-2 font-medium">企业微信地址</div>
          <input
            className="h-8 w-full rounded-control border border-line px-3 disabled:opacity-50"
            value={webhookDraft}
            disabled={!settings.notifyEnabled}
            placeholder="粘贴完整 Webhook，或只填 key"
            onChange={(event) => {
              const next = event.target.value;
              setWebhookDraft(next);
              // 改过地址后作废上次测试通过状态
              if (webhookTested && webhookTested !== next.trim()) {
                setWebhookTested("");
              }
              setHint("");
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={!settings.notifyEnabled}
              onClick={() => {
                const url = expandWecomWebhook(draftNorm);
                if (!url) {
                  setHint("请先粘贴地址");
                  return;
                }
                void copyText(url)
                  .then(() => setHint("已复制完整地址"))
                  .catch(() => setHint("复制失败"));
              }}
            >
              复制
            </Button>
            <Button
              disabled={!settings.notifyEnabled || testing}
              onClick={() => {
                const url = expandWecomWebhook(draftNorm);
                if (!url) {
                  setHint("请先粘贴地址，再测试");
                  return;
                }
                setTesting(true);
                void api
                  .testWecomWebhook(url)
                  .then(() => {
                    setWebhookTested(draftNorm);
                    setHint("测试已通过，可以保存。");
                  })
                  .catch((error) => {
                    setWebhookTested("");
                    setHint(`测试失败：${formatErr(error)}`);
                  })
                  .finally(() => setTesting(false));
              }}
            >
              测试
            </Button>
            <Button
              variant="primary"
              disabled={!settings.notifyEnabled}
              onClick={() => {
                // 没改地址：按原逻辑直接保存；改了且非空：必须先测试通过
                if (webhookDirty && draftNorm && !testedOk) {
                  setHint("请先测试通过，再保存");
                  return;
                }
                updateSettings({ wecomWebhook: draftExpanded });
                setWebhookDraft(draftExpanded);
                setWebhookTested("");
                setHint(draftNorm ? "已保存。" : "已清除地址。");
              }}
            >
              保存
            </Button>
          </div>
          {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
        </Card>

        <Card>
          <div className="mb-3 font-medium">通知什么</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["cpu", "mem", "disk", "load", "app", "cert"] as AlertContentKind[]).map(
              (kind) => (
                <label key={kind} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.alertContentKinds.includes(kind)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...settings.alertContentKinds, kind]
                        : settings.alertContentKinds.filter((item) => item !== kind);
                      updateSettings({ alertContentKinds: next });
                    }}
                  />
                  {CONTENT_LABEL[kind]}
                </label>
              ),
            )}
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.notifyRecoverEnabled}
                onChange={(event) =>
                  updateSettings({ notifyRecoverEnabled: event.target.checked })
                }
              />
              恢复
            </label>
          </div>
        </Card>

        <Card>
          <div className="mb-3 font-medium">正文带上</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["hostName", "metric", "threshold", "value", "service"] as NotifyContentField[]).map(
              (field) => (
                <label key={field} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.notifyContentFields.includes(field)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...settings.notifyContentFields, field]
                        : settings.notifyContentFields.filter((item) => item !== field);
                      updateSettings({ notifyContentFields: next });
                    }}
                  />
                  {FIELD_LABEL[field]}
                </label>
              ),
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
