import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  Ellipsis,
  SlidersHorizontal,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { api } from "@/api";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import {
  IncidentDetail,
  LevelTag,
  StatusLed,
} from "@/react/components/notify/incident-detail";
import { NotifyPageHeader } from "@/react/components/notify/page-header";
import {
  rememberMessageSource,
  setSubscriptionFocus,
  useNotifyView,
} from "@/react/components/notify/view-state";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { confirmDialog } from "@/react/components/ui/confirm-dialog";
import { Popup } from "@/react/components/ui/popup";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import {
  dayKey,
  dayLabel,
  formatClock,
  formatDuration,
  kindLabel,
  statusLabel,
  type Incident,
} from "@/react/lib/alert-incidents";
import {
  NOTIFY_SOURCE,
  notifySourceOf,
  sourceForSection,
  unreadEventIds,
  selectedIncident,
  type MessageSection,
} from "@/react/lib/notify-model";
import {
  useNotificationHistory,
  notificationHistoryChanged,
} from "@/react/lib/use-notification-history";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { cn } from "@/react/lib/utils";
import { useSession } from "@/react/state/session";
import { useSettings } from "@/react/state/settings";
import { ALERT_RULES } from "@/utils/alerts";
import { formatErr } from "@/utils/format";
import { WATCH_SERVICE_ORDER } from "@/utils/watchServices";

type StatusFilter = "all" | "open" | "closed" | "unclosed";
type MessageView = {
  kindFilter: string;
  statusFilter: StatusFilter;
  unreadOnly: boolean;
  selectedId: string;
  scrollTop: number;
  detailOpen: boolean;
};
const INITIAL_VIEW: MessageView = {
  kindFilter: "all",
  statusFilter: "all",
  unreadOnly: false,
  selectedId: "",
  scrollTop: 0,
  detailOpen: false,
};

export function MessagesPage({
  kind,
  focusAlertId,
  onFocusConsumed,
}: {
  kind: MessageSection;
  focusAlertId: string;
  onFocusConsumed: () => void;
}) {
  const source = sourceForSection(kind);
  const info = NOTIFY_SOURCE[source];
  const appPage = source === "app";
  const certPage = source === "cert";
  const session = useSession();
  const settings = useSettings();
  const flash = useFlashMessage();
  const query = useNotificationHistory();
  const { refetch } = query;
  const [view, setView] = useNotifyView<MessageView>(kind, INITIAL_VIEW);
  const [now, setNow] = useState(Date.now);
  const [narrow, setNarrow] = useState(true);
  const [focusOverride, setFocusOverride] = useState("");
  const layoutRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const autoMarked = useRef(new Set<string>());
  const restoredScroll = useRef(false);
  const refetchTried = useRef("");
  const onFocusConsumedRef = useRef(onFocusConsumed);
  onFocusConsumedRef.current = onFocusConsumed;
  useEffect(() => rememberMessageSource(source), [source]);
  useLayoutEffect(() => {
    const node = layoutRef.current;
    if (!node) return;
    const resize = () => setNarrow(node.clientWidth < 900);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const pageIncidents = useMemo(
    () => query.incidents.filter((inc) => notifySourceOf(inc.kind) === source),
    [query.incidents, source],
  );
  const visible = useMemo(
    () =>
      pageIncidents.filter((inc) => {
        if (inc.id === focusOverride) return true;
        if (
          view.kindFilter !== "all" &&
          (certPage ? inc.host : inc.kind) !== view.kindFilter
        )
          return false;
        if (
          view.statusFilter === "open" &&
          (certPage ? !!inc.up : inc.status !== "active")
        )
          return false;
        if (
          view.statusFilter === "closed" &&
          (certPage ? !inc.up : inc.status !== "resolved")
        )
          return false;
        if (view.statusFilter === "unclosed" && inc.status !== "unclosed")
          return false;
        return !view.unreadOnly || inc.unread || inc.id === view.selectedId;
      }),
    [
      pageIncidents,
      view.kindFilter,
      view.statusFilter,
      view.unreadOnly,
      view.selectedId,
      focusOverride,
      certPage,
    ],
  );
  const selected = selectedIncident(visible, view.selectedId, focusOverride);
  const unreadCount = pageIncidents.filter((inc) => inc.unread).length;
  const clearable = visible.filter((inc) => inc.status !== "active");
  const hasActive = pageIncidents.some((inc) => inc.status === "active");
  const statuses: { value: StatusFilter; label: string }[] = certPage
    ? [
        { value: "all", label: "全部" },
        { value: "open", label: "到期提醒" },
        { value: "closed", label: "已续期" },
      ]
    : [
        { value: "all", label: "全部" },
        { value: "open", label: appPage ? "异常中" : "进行中" },
        { value: "closed", label: "已恢复" },
        { value: "unclosed", label: "未记录恢复" },
      ];
  const kindOptions = useMemo(() => {
    if (certPage)
      return [
        { value: "all", label: "全部主机" },
        ...[...new Set(pageIncidents.map((inc) => inc.host))].map((host) => ({
          value: host,
          label: host,
        })),
      ];
    const options = appPage
      ? WATCH_SERVICE_ORDER.map((service) => ({
          value: `app:${service}`,
          label: service as string,
        }))
      : ALERT_RULES.map((rule) => ({
          value: rule.kind as string,
          label: rule.name as string,
        }));
    for (const inc of pageIncidents)
      if (!options.some((option) => option.value === inc.kind))
        options.push({ value: inc.kind, label: kindLabel(inc.kind) });
    return [
      { value: "all", label: appPage ? "全部服务" : "全部指标" },
      ...options,
    ];
  }, [pageIncidents, certPage, appPage]);
  async function refresh() {
    await refetch();
    notificationHistoryChanged();
  }
  const mark = useMutation({
    mutationFn: async (incidents: Incident[]) => {
      const results = await Promise.allSettled(
        unreadEventIds(incidents, query.data || []).map((id) =>
          api.markAlertRead(id),
        ),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failed) throw new Error(`${failed} 条记录未能标为已读，请重试`);
    },
    onError: (error) => flash.showError(formatErr(error)),
    onSettled: () => {
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api.deleteAlertHistory(ids),
    onError: (error) => flash.showError(formatErr(error)),
    onSettled: () => {
      void refresh();
    },
  });
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);
  useEffect(() => {
    if (!selected?.unread || (narrow && !view.detailOpen)) return;
    const key = unreadEventIds([selected], query.data || []).join("|");
    if (!key || autoMarked.current.has(key)) return;
    autoMarked.current.add(key);
    if (!view.selectedId && !focusOverride)
      setView((previous) => ({ ...previous, selectedId: selected.id }));
    mark.mutate([selected]);
  }, [selected, narrow, view.detailOpen, query.data]);
  useLayoutEffect(() => {
    if (!query.isSuccess || restoredScroll.current || !listRef.current) return;
    listRef.current.scrollTop = view.scrollTop;
    restoredScroll.current = true;
  }, [query.isSuccess, narrow, view.detailOpen]);
  useEffect(() => {
    const id = focusAlertId.trim();
    if (!id || !query.data) return;
    const target = pageIncidents.find((inc) => inc.eventIds.includes(id));
    if (!target) {
      if (refetchTried.current !== id) {
        refetchTried.current = id;
        void refetch();
      }
      return;
    }
    setFocusOverride(target.id);
    setView((previous) => ({ ...previous, detailOpen: true }));
    window.requestAnimationFrame(() => {
      itemRefs.current[target.id]?.scrollIntoView({ block: "center" });
      onFocusConsumedRef.current();
    });
  }, [focusAlertId, pageIncidents, query.data, refetch]);
  function changeFilter(patch: Partial<MessageView>) {
    setFocusOverride("");
    setView((previous) => ({
      ...previous,
      ...patch,
      selectedId: "",
      scrollTop: 0,
      detailOpen: false,
    }));
    if (listRef.current) listRef.current.scrollTop = 0;
  }
  function select(id: string, focus = false) {
    setFocusOverride("");
    setView((previous) => ({ ...previous, selectedId: id, detailOpen: true }));
    if (focus)
      window.requestAnimationFrame(() => {
        const node = itemRefs.current[id];
        node?.focus();
        node?.scrollIntoView({ block: "nearest" });
      });
  }
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
      event.nativeEvent.isComposing ||
      !visible.length
    )
      return;
    event.preventDefault();
    const index = selected
      ? visible.findIndex((inc) => inc.id === selected.id)
      : -1;
    select(
      visible[
        Math.min(
          visible.length - 1,
          Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
        )
      ].id,
      true,
    );
  }
  function openSubscriptions(incident?: Incident) {
    setSubscriptionFocus(source, incident);
    session.setNotifySection(info.subscriptions);
  }
  async function deleteIncident(incident: Incident) {
    const accepted = await confirmDialog({
      title: "删除这条消息？",
      body: `${info.label}的这次事件及关联记录将一起删除。${incident.status === "active" ? "事件仍在进行，之后的恢复记录会单独出现。" : ""}此操作不可撤销。`,
      theme: "danger",
      confirmText: "删除",
    });
    if (!accepted) return;
    const index = visible.findIndex((item) => item.id === incident.id);
    const next = visible[index + 1] || visible[index - 1];
    setView((previous) => ({
      ...previous,
      selectedId: next && next.id !== incident.id ? next.id : "",
    }));
    setFocusOverride("");
    remove.mutate(incident.eventIds);
  }
  async function clearVisible() {
    if (!clearable.length) return;
    const kept = visible.length - clearable.length;
    const accepted = await confirmDialog({
      title: `清理 ${clearable.length} 条历史消息？`,
      body: `仅删除「${info.label}」当前筛选结果中的历史记录。${kept ? `进行中的 ${kept} 条会保留。` : ""}此操作不可撤销。`,
      theme: "danger",
      confirmText: "清理",
    });
    if (!accepted) return;
    remove.mutate(clearable.flatMap((inc) => inc.eventIds));
    setView((previous) => ({ ...previous, selectedId: "", detailOpen: false }));
    setFocusOverride("");
  }
  const groups = useMemo(() => {
    const result: { key: number; label: string; items: Incident[] }[] = [];
    for (const inc of visible) {
      const key = dayKey(inc.startAt || inc.lastAt);
      const last = result[result.length - 1];
      if (last?.key === key) last.items.push(inc);
      else
        result.push({
          key,
          label: dayLabel(inc.startAt || inc.lastAt),
          items: [inc],
        });
    }
    return result;
  }, [visible]);
  const subscribed = appPage
    ? Object.values(settings.hostAppNotifySubs).some(
        (items) => items.length > 0,
      )
    : Object.values(settings.hostResourceNotifySubs).some(
        (items) => items.length > 0,
      );
  return (
    <Page
      heading={false}
      flush
      onRefresh={async () => {
        await refetch();
      }}
    >
      <FlashNotices flash={flash} />
      <div className="notify-workspace">
        <NotifyPageHeader title={info.title}>
          <Button onClick={() => openSubscriptions()}>
            <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden />
            {info.subscriptionLabel}
          </Button>
        </NotifyPageHeader>
        <div className="notify-message-toolbar">
          <Select
            size="sm"
            aria-label={
              certPage ? "按主机筛选" : appPage ? "按服务筛选" : "按指标筛选"
            }
            value={view.kindFilter}
            onChange={(kindFilter) => changeFilter({ kindFilter })}
            options={kindOptions}
            className="w-32"
          />
          <RadioGroup
            aria-label="按状态筛选"
            value={view.statusFilter}
            onChange={(statusFilter) => changeFilter({ statusFilter })}
            options={statuses}
          />
          <Checkbox
            checked={view.unreadOnly}
            onChange={(unreadOnly) => changeFilter({ unreadOnly })}
          >
            只看未读
          </Checkbox>
          <div className="notify-message-menu">
            <ActionMenu
              label="标记已读"
              disabled={unreadCount === 0 || mark.isPending}
              icon={<ChevronDown size={14} strokeWidth={1.5} />}
              items={[
                {
                  label: "当前消息",
                  disabled: !selected?.unread,
                  run: () => {
                    if (selected) mark.mutate([selected]);
                  },
                },
                {
                  label: `当前筛选结果（${visible.filter((inc) => inc.unread).length} 条）`,
                  disabled: !visible.some((inc) => inc.unread),
                  run: () => mark.mutate(visible),
                },
                {
                  label: `当前分类（${unreadCount} 条）`,
                  run: () => mark.mutate(pageIncidents),
                },
              ]}
            />
            <ActionMenu
              label="更多消息操作"
              compact
              icon={<Ellipsis size={16} strokeWidth={1.5} />}
              items={[
                {
                  label: "删除当前消息",
                  disabled: !selected || remove.isPending,
                  run: () => {
                    if (selected) void deleteIncident(selected);
                  },
                },
                {
                  label: `清理当前筛选的历史（${clearable.length} 条）`,
                  disabled: !clearable.length || remove.isPending,
                  run: () => {
                    void clearVisible();
                  },
                },
              ]}
            />
          </div>
        </div>
        {focusOverride ? (
          <div className="notify-context-notice">
            <span>通知定位：临时显示此消息，原筛选已保留。</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFocusOverride("")}
            >
              恢复原筛选
            </Button>
          </div>
        ) : null}
        {query.error ? (
          <div className="p-4">
            <Notice text={`消息读取失败：${formatErr(query.error)}`} />
            <Button size="sm" className="mt-2" onClick={() => void refetch()}>
              重试
            </Button>
          </div>
        ) : null}
        <div
          ref={layoutRef}
          className={cn(
            "notify-message-layout flex min-h-0 flex-1",
            narrow && "is-narrow",
            view.detailOpen && "is-detail-open",
            !selected && "is-empty",
          )}
        >
          <div
            ref={listRef}
            className="notify-message-list flex shrink-0 flex-col overflow-y-auto border-r border-line"
            aria-label={`${info.label}消息列表`}
            onKeyDown={onListKeyDown}
            onScroll={(event) => {
              const scrollTop = event.currentTarget.scrollTop;
              if (!focusOverride)
                setView((previous) => ({ ...previous, scrollTop }));
            }}
          >
            {query.isPending ? (
              <p role="status" className="p-4 text-sm text-muted">
                正在读取消息…
              </p>
            ) : !groups.length && !query.error ? (
              <div className="flex flex-col items-start gap-3 p-4 text-sm leading-6 text-muted">
                <p>
                  {pageIncidents.length
                    ? "没有符合筛选条件的消息。"
                    : certPage
                      ? "暂无证书提醒。等待主机扫描结果；暂无记录不代表证书正常。"
                      : appPage
                        ? subscribed
                          ? "已订阅应用服务，暂无异常与恢复记录。"
                          : "尚未订阅应用服务，选择主机与服务后可接收探活消息。"
                        : subscribed
                          ? "已订阅主机指标，暂无告警与恢复记录。"
                          : "尚未订阅主机指标，选择需要接收告警的主机与指标。"}
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    pageIncidents.length
                      ? changeFilter(INITIAL_VIEW)
                      : openSubscriptions()
                  }
                >
                  {pageIncidents.length
                    ? "重置筛选"
                    : certPage
                      ? "查看提醒规则"
                      : appPage
                        ? "订阅应用服务"
                        : "订阅主机指标"}
                </Button>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.key}>
                  <h3 className="sticky top-0 z-[1] flex h-8 items-center justify-between bg-surface px-4 text-xs text-muted">
                    <span>{group.label}</span>
                    <span className="font-mono tabular-nums">
                      {group.items.length}
                    </span>
                  </h3>
                  <ul>
                    {group.items.map((inc) => (
                      <li key={inc.id}>
                        <IncidentRow
                          inc={inc}
                          now={now}
                          selected={selected?.id === inc.id}
                          appPage={appPage}
                          onClick={() => select(inc.id)}
                          buttonRef={(node) => {
                            itemRefs.current[inc.id] = node;
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
          {selected ? (
            <div className="notify-message-detail min-w-0 flex-1 overflow-y-auto">
              {narrow ? (
                <div className="notify-back-list">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setView((previous) => ({
                        ...previous,
                        detailOpen: false,
                      }));
                      restoredScroll.current = false;
                    }}
                  >
                    <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
                    返回列表
                  </Button>
                </div>
              ) : null}
              <IncidentDetail
                incident={selected}
                all={pageIncidents}
                now={now}
                onSelect={(id) => select(id, true)}
                onOpenHost={(host) => session.openHost(host, "monitor")}
                onOpenSubs={() => openSubscriptions(selected)}
                onDelete={() => void deleteIncident(selected)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

function IncidentRow({
  inc,
  now,
  selected,
  appPage,
  onClick,
  buttonRef,
}: {
  inc: Incident;
  now: number;
  selected: boolean;
  appPage: boolean;
  onClick: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const trigger = inc.escalation?.value || inc.down?.value || "";
  const summary =
    inc.status === "notice"
      ? (inc.down || inc.up)?.title || statusLabel(inc)
      : inc.status === "resolved"
        ? appPage
          ? `异常 ${formatDuration(inc.endAt - inc.startAt)} 后恢复`
          : [
              inc.up?.peak ? `峰值 ${inc.up.peak}` : "",
              inc.up?.value ? `回落 ${inc.up.value}` : "",
              `持续 ${formatDuration(inc.endAt - inc.startAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")
        : inc.status === "unclosed"
          ? `未记录恢复${trigger ? ` · 触发 ${trigger}` : ""}`
          : `${trigger ? `触发 ${trigger} · ` : ""}${statusLabel(inc)} ${formatDuration(now - inc.startAt)}`;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "motion-colors flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-focus",
        selected ? "bg-accent-soft" : "hover:bg-raised",
      )}
    >
      <span className="flex min-h-6 items-center gap-2 text-sm">
        <StatusLed inc={inc} />
        <span
          className={cn(
            "min-w-0 truncate",
            inc.unread && "font-semibold",
            selected && "text-accent",
          )}
        >
          {appPage ? inc.service || kindLabel(inc.kind) : inc.host || "—"}
        </span>
        <LevelTag inc={inc} />
        <span className="shrink-0 text-muted">
          {appPage ? inc.host : kindLabel(inc.kind)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {inc.unread ? (
            <span
              aria-label="未读"
              className="size-1.5 rounded-tag bg-accent"
            />
          ) : null}
          <span className="font-mono text-xs text-muted tabular-nums">
            {formatClock(inc.startAt || inc.lastAt)}
          </span>
        </span>
      </span>
      <span className="truncate pl-6 text-xs leading-5 text-muted">
        {summary}
      </span>
    </button>
  );
}

function ActionMenu({
  label,
  icon,
  items,
  compact = false,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  items: { label: string; disabled?: boolean; run: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      window.requestAnimationFrame(() =>
        panel.current
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus(),
      );
  }, [open]);
  return (
    <>
      <Button
        size="sm"
        ref={anchor}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {compact ? null : label}
        {icon}
      </Button>
      <Popup
        open={open}
        anchorRef={anchor}
        onClose={() => {
          setOpen(false);
          anchor.current?.focus();
        }}
        className="py-1"
      >
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              className="notify-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                anchor.current?.focus();
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Popup>
    </>
  );
}
