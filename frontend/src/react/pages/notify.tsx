import { Events } from "@wailsio/runtime";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { TH_STICKY_LINE } from "@/react/components/data-table";
import { MessagesPage } from "@/react/components/notify/messages-page";
import { SetupPage } from "@/react/components/notify/setup-page";
import { Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Checkbox } from "@/react/components/ui/checkbox";
import { isAppKind } from "@/react/lib/alert-incidents";
import { cn } from "@/react/lib/utils";
import { updateSettings, useSettings } from "@/react/state/settings";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import { ALERT_RULES, type ResourceAlertKind } from "@/utils/alerts";
import {
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
 */

const FOCUS_ALERT_STORAGE_KEY = "1pannel-focus-alert-id";
const FOCUS_ALERT_WINDOW_EVENT = "1pannel-focus-alert";

type FocusAlertPayload = { host?: string; eventId?: string };

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
        events = await api.listAlertHistory(500);
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
      const appEv = ev ? isAppKind(ev.kind || "") : false;
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
              size="sm"
              variant={groupFilter === item.value ? "primary" : "secondary"}
              onClick={() => setGroupFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </>
      }
    >
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            {/* z-20 压过主机列 body 单元格的 z-10，纵向滚动时表头盖住吸左列 */}
            <thead className="sticky top-0 z-20 bg-surface text-xs font-normal text-muted">
              <tr className="h-table-head">
                <th
                  className={cn(
                    "relative w-12 px-2 text-center font-normal",
                    TH_STICKY_LINE,
                  )}
                >
                  序
                </th>
                <th
                  className={cn(
                    "sticky left-0 z-10 bg-surface px-3 font-normal",
                    TH_STICKY_LINE,
                  )}
                >
                  主机
                </th>
                {kind === "metricSubs" ? (
                  <>
                    {ALERT_RULES.map((rule) => (
                      <th
                        key={rule.kind}
                        className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}
                      >
                        {rule.name}
                      </th>
                    ))}
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>
                      证书
                    </th>
                  </>
                ) : (
                  WATCH_SERVICE_ORDER.map((svc) => (
                    <th
                      key={svc}
                      className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}
                    >
                      {serviceLabel(svc)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {hosts.length === 0 ? (
                <tr className="h-table-row border-t border-line">
                  <td className="px-3 text-muted" colSpan={kind === "metricSubs" ? 7 : 10}>
                    没有匹配的主机
                  </td>
                </tr>
              ) : (
                hosts.map((host, index) => (
                  <tr key={host} className="h-table-row border-t border-line">
                    <td className="px-2 text-center font-mono text-xs tabular-nums text-muted">
                      {index + 1}
                    </td>
                    <td className="sticky left-0 z-10 bg-surface px-3">{host}</td>
                    {kind === "metricSubs" ? (
                      <>
                        {ALERT_RULES.map((rule) => (
                          <td key={rule.kind} className="p-0">
                            <Checkbox
                              className="sub-check"
                              aria-label={`${host} ${rule.kind}`}
                              checked={(settings.hostResourceNotifySubs[host] || []).includes(
                                rule.kind,
                              )}
                              onChange={(checked) =>
                                toggleResource(
                                  host,
                                  rule.kind,
                                  checked,
                                  settings.hostResourceNotifySubs,
                                )
                              }
                            />
                          </td>
                        ))}
                        <td className="p-0">
                          <Checkbox
                            className="sub-check"
                            aria-label={`${host} 证书`}
                            checked={!!settings.hostCertNotifySubs[host]}
                            onChange={(checked) =>
                              updateSettings({
                                hostCertNotifySubs: {
                                  ...settings.hostCertNotifySubs,
                                  [host]: checked,
                                },
                              })
                            }
                          />
                        </td>
                      </>
                    ) : (
                      WATCH_SERVICE_ORDER.map((svc) => (
                        <td key={svc} className="p-0">
                          <Checkbox
                            className="sub-check"
                            aria-label={`${host} ${svc}`}
                            checked={(settings.hostAppNotifySubs[host] || []).includes(svc)}
                            onChange={(checked) =>
                              toggleAppService(
                                host,
                                svc,
                                checked,
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
