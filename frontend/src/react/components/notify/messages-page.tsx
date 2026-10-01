import { useMutation, useQuery } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/api";
import { IncidentDetail, LevelTag, StatusLed } from "@/react/components/notify/incident-detail";
import { Notice, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { Switch } from "@/react/components/ui/switch";
import {
  buildIncidents,
  dayKey,
  dayLabel,
  formatClock,
  formatDuration,
  isAppKind,
  kindLabel,
  statusLabel,
  type Incident,
} from "@/react/lib/alert-incidents";
import { cn } from "@/react/lib/utils";
import { ALERT_RULES } from "@/utils/alerts";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";
import { WATCH_SERVICE_ORDER } from "@/utils/watchServices";

type StatusFilter = "all" | "open" | "closed";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "open", label: "进行中" },
  { value: "closed", label: "已结束" },
];

const METRIC_KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  ...ALERT_RULES.map((rule) => ({ value: rule.kind as string, label: rule.name as string })),
  { value: "cert", label: "证书" },
];

const APP_SERVICE_OPTIONS = [
  { value: "all", label: "全部服务" },
  ...WATCH_SERVICE_ORDER.map((svc) => ({ value: `app:${svc}`, label: svc })),
];

function notifyAlertsChanged() {
  window.dispatchEvent(new Event("alerts-changed"));
}

export function MessagesPage({
  kind,
  focusAlertId,
  onFocusConsumed,
}: {
  kind: "metricMessages" | "appMessages";
  focusAlertId: string;
  onFocusConsumed: () => void;
}) {
  const session = useSession();
  const appPage = kind === "appMessages";
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const refetchTriedRef = useRef("");
  const onFocusConsumedRef = useRef(onFocusConsumed);
  onFocusConsumedRef.current = onFocusConsumed;

  const query = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.listAlertHistory(500),
  });
  const refetch = query.refetch;

  useEffect(() => {
    const onChanged = () => void refetch();
    window.addEventListener("alerts-changed", onChanged);
    const off = Events.On("alert-history-updated", onChanged);
    return () => {
      window.removeEventListener("alerts-changed", onChanged);
      off();
    };
  }, [refetch]);

  const markAll = useMutation({
    mutationFn: () => api.markAllAlertsRead(),
    onSuccess: () => {
      void refetch();
      notifyAlertsChanged();
    },
  });

  // 当前页（指标 / 应用）的全部事件，不受筛选影响：详情里的「近 7 天同类」要看全量
  const pageIncidents = useMemo(
    () =>
      buildIncidents(query.data || []).filter((inc) => isAppKind(inc.kind) === appPage),
    [appPage, query.data],
  );

  const visible = useMemo(
    () =>
      pageIncidents.filter((inc) => {
        if (kindFilter !== "all" && inc.kind !== kindFilter) return false;
        if (statusFilter === "open" && inc.status !== "active") return false;
        if (statusFilter === "closed" && inc.status === "active") return false;
        if (unreadOnly && !inc.unread) return false;
        return true;
      }),
    [kindFilter, pageIncidents, statusFilter, unreadOnly],
  );

  const unreadCount = pageIncidents.filter((inc) => inc.unread).length;
  const hasActive = visible.some((inc) => inc.status === "active");

  useEffect(() => {
    if (!hasActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const selected =
    visible.find((inc) => inc.id === selectedId) ||
    pageIncidents.find((inc) => inc.id === selectedId) ||
    visible[0];

  // 选中即已读：一次事件里的告警和恢复一起标
  useEffect(() => {
    if (!selected?.unread) return;
    const ids = [selected.down, selected.up]
      .filter((ev) => ev && !ev.read)
      .map((ev) => ev!.id);
    if (!ids.length) return;
    void Promise.all(ids.map((id) => api.markAlertRead(id).catch(() => {}))).then(() => {
      void refetch();
      notifyAlertsChanged();
    });
  }, [refetch, selected]);

  // 从系统通知点进来：找到事件 → 放宽筛选 → 选中并滚到可见
  useEffect(() => {
    const id = focusAlertId.trim();
    if (!id || !query.data) return;
    const target = pageIncidents.find((inc) => inc.eventIds.includes(id));
    if (!target) {
      // 通知刚发出、列表还是旧的：补拉一次
      if (refetchTriedRef.current !== id) {
        refetchTriedRef.current = id;
        void refetch();
      }
      return;
    }
    setKindFilter("all");
    setStatusFilter("all");
    setUnreadOnly(false);
    setSelectedId(target.id);
    window.requestAnimationFrame(() => {
      itemRefs.current[target.id]?.scrollIntoView({ block: "center" });
      onFocusConsumedRef.current();
    });
  }, [focusAlertId, pageIncidents, query.data, refetch]);

  function select(id: string, focus = false) {
    setSelectedId(id);
    if (focus) {
      window.requestAnimationFrame(() => {
        const node = itemRefs.current[id];
        node?.focus();
        node?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!visible.length) return;
    const index = selected ? visible.findIndex((inc) => inc.id === selected.id) : -1;
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = Math.min(visible.length - 1, Math.max(0, index + step));
    select(visible[next].id, true);
  }

  const groups = useMemo(() => {
    const out: { key: number; label: string; items: Incident[] }[] = [];
    for (const inc of visible) {
      const key = dayKey(inc.startAt || inc.lastAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(inc);
      else out.push({ key, label: dayLabel(inc.startAt || inc.lastAt), items: [inc] });
    }
    return out;
  }, [visible]);

  return (
    <Page
      title={appPage ? "应用消息" : "指标消息"}
      flush
      actions={
        <>
          <Select
            size="sm"
            aria-label={appPage ? "按服务筛选" : "按类型筛选"}
            value={kindFilter}
            onChange={setKindFilter}
            options={appPage ? APP_SERVICE_OPTIONS : METRIC_KIND_OPTIONS}
            className="w-28"
          />
          <RadioGroup
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
          <Switch checked={unreadOnly} onChange={setUnreadOnly}>
            只看未读
          </Switch>
          <Button
            size="sm"
            disabled={unreadCount <= 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            全部已读
          </Button>
        </>
      }
      onRefresh={() => void refetch()}
    >
      {query.error ? (
        <div className="p-4">
          <Notice text={formatErr(query.error)} />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div
          className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-r border-line"
          onKeyDown={onListKeyDown}
        >
          {groups.length === 0 ? (
            <EmptyList
              filtered={pageIncidents.length > 0}
              appPage={appPage}
              onOpenSubs={() => session.setNotifySection(appPage ? "appSubs" : "metricSubs")}
            />
          ) : (
            groups.map((group) => (
              <section key={group.key}>
                <h3 className="sticky top-0 z-[1] flex h-8 items-center justify-between bg-surface px-4 text-xs text-muted">
                  <span>{group.label}</span>
                  <span className="font-mono tabular-nums">{group.items.length}</span>
                </h3>
                <ul>
                  {group.items.map((inc) => (
                    <li key={inc.id}>
                      <IncidentRow
                        inc={inc}
                        now={now}
                        selected={selected?.id === inc.id}
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
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <IncidentDetail
              incident={selected}
              all={pageIncidents}
              now={now}
              onSelect={(id) => select(id, true)}
              onOpenHost={(host) => session.openHost(host, "monitor")}
              onOpenSubs={() => session.setNotifySection(appPage ? "appSubs" : "metricSubs")}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              在左侧选择一条消息查看详情
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

function rowSummary(inc: Incident, now: number): string[] {
  const app = isAppKind(inc.kind);
  const trigger = inc.escalation?.value || inc.down?.value || "";
  switch (inc.status) {
    case "active":
      return [`${statusLabel(inc)} ${formatDuration(now - inc.startAt)}`, app ? trigger : `触发 ${trigger}`];
    case "resolved":
      if (app) return [`异常 ${formatDuration(inc.endAt - inc.startAt)}后恢复`, trigger];
      return [
        inc.up?.peak || trigger ? `峰值 ${inc.up?.peak || trigger}` : "",
        `持续 ${formatDuration(inc.endAt - inc.startAt)}`,
      ];
    case "unclosed":
      return [statusLabel(inc), trigger ? (app ? trigger : `触发 ${trigger}`) : ""];
    default:
      return [(inc.down || inc.up)?.title || statusLabel(inc)];
  }
}

function IncidentRow({
  inc,
  now,
  selected,
  onClick,
  buttonRef,
}: {
  inc: Incident;
  now: number;
  selected: boolean;
  onClick: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const subject = isAppKind(inc.kind) ? inc.service || kindLabel(inc.kind) : kindLabel(inc.kind);
  const summary = rowSummary(inc, now).filter(Boolean);
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "motion-colors flex w-full flex-col gap-0.5 border-b border-line px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-focus",
        selected ? "bg-accent-soft" : "hover:bg-raised",
      )}
    >
      <span className="flex h-6 items-center gap-2 text-sm">
        <StatusLed inc={inc} />
        <span
          className={cn(
            "min-w-0 truncate",
            inc.unread ? "font-semibold text-ink" : "text-ink",
            selected && "text-accent",
          )}
        >
          {inc.host || "—"}
        </span>
        <LevelTag inc={inc} />
        <span className="shrink-0 text-muted">{subject}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {inc.unread ? (
            <span aria-label="未读" className="inline-block size-1.5 rounded-tag bg-accent" />
          ) : null}
          <span className="font-mono text-xs text-muted tabular-nums">
            {formatClock(inc.startAt || inc.lastAt)}
          </span>
        </span>
      </span>
      <span className="flex min-w-0 gap-3 pl-4 text-xs leading-5 text-muted">
        {summary.map((part, index) => (
          <span key={index} className={cn("truncate", index === 0 && inc.status === "active" && (inc.level === "warn" ? "text-warn" : "text-danger"))}>
            {part}
          </span>
        ))}
      </span>
    </button>
  );
}

function EmptyList({
  filtered,
  appPage,
  onOpenSubs,
}: {
  filtered: boolean;
  appPage: boolean;
  onOpenSubs: () => void;
}) {
  if (filtered) {
    return <p className="p-4 text-sm text-muted">没有符合筛选条件的消息，换个条件试试。</p>;
  }
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p className="text-sm leading-6 text-muted">
        {appPage
          ? "还没有应用消息。订阅服务探活后，异常和恢复都会记在这里。"
          : "还没有指标消息。订阅主机的指标后，每次超阈值和回落都会记在这里。"}
      </p>
      <Button size="sm" onClick={onOpenSubs}>
        {appPage ? "去订阅应用" : "去订阅指标"}
      </Button>
    </div>
  );
}
