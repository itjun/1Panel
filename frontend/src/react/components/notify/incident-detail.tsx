import { Activity, BellRing, Trash2 } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import {
  formatClock,
  formatDateTime,
  formatDuration,
  isAppKind,
  kindLabel,
  recurrence,
  statusLabel,
  usagePercent,
  type AlertEvent,
  type Incident,
} from "@/react/lib/alert-incidents";
import { usageTone } from "@/react/lib/usage-tone";
import { cn } from "@/react/lib/utils";
import { LEVEL_LABEL } from "@/utils/alerts";

export const CHANNEL_LABEL: Record<string, string> = {
  system: "系统通知",
  inApp: "应用内",
  wecom: "企业微信",
};

const CHANNEL_ORDER = ["system", "inApp", "wecom"];

export function statusTone(inc: Incident): TagTone {
  switch (inc.status) {
    case "active":
      return inc.level === "warn" ? "warn" : "danger";
    case "resolved":
      return "ok";
    case "unclosed":
      return "neutral";
    default:
      return inc.up ? "ok" : "warn";
  }
}

/** 资源告警到过的最高档：警告用 warn 色，危险用 danger 色；旧记录没有档位不显示 */
export function LevelTag({ inc }: { inc: Incident }) {
  if (!inc.level) return null;
  return <Tag tone={inc.level === "danger" ? "danger" : "warn"}>{LEVEL_LABEL[inc.level]}</Tag>;
}

/** 状态灯：机柜面板上的 LED，形状固定、颜色表状态，旁边始终配文字 */
export function StatusLed({ inc, className }: { inc: Incident; className?: string }) {
  const color: Record<TagTone, string> = {
    danger: "bg-danger",
    ok: "bg-success",
    warn: "bg-warn",
    neutral: "bg-line-strong",
    info: "bg-info",
    accent: "bg-accent",
  };
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-tag", color[statusTone(inc)], className)}
    />
  );
}

export function IncidentDetail({
  incident,
  all,
  now,
  onSelect,
  onOpenHost,
  onOpenSubs,
  onDelete,
}: {
  incident: Incident;
  all: Incident[];
  now: number;
  onSelect: (id: string) => void;
  onOpenHost: (host: string) => void;
  onOpenSubs: () => void;
  onDelete?: () => void;
}) {
  const app = isAppKind(incident.kind);
  const pointEvent = incident.status === "notice";
  const subject = app ? incident.service || kindLabel(incident.kind) : kindLabel(incident.kind);
  const endAt = incident.status === "active" ? now : incident.endAt;
  const duration = incident.startAt && endAt ? formatDuration(endAt - incident.startAt) : "";
  const { list: recent, peakHour } = recurrence(incident, all, 7, now);
  const others = recent.filter((inc) => inc.id !== incident.id).slice(0, 5);

  let headline = "";
  if (pointEvent) headline = formatDateTime(incident.startAt);
  else if (incident.status === "resolved") {
    headline = `${formatDateTime(incident.startAt)} 至 ${formatClock(incident.endAt, true)}，持续 ${duration}`;
  } else if (incident.status === "active") {
    headline = `${formatDateTime(incident.startAt)} 起，已持续 ${duration}`;
  } else {
    headline = `${formatDateTime(incident.startAt)} 触发，之后没有收到回落记录`;
  }

  return (
    <div className="gap-section flex flex-col p-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Tag tone={statusTone(incident)}>{statusLabel(incident)}</Tag>
          <LevelTag inc={incident} />
          <h2 className="min-w-0 truncate text-base font-semibold text-ink">
            {incident.host || "—"}
            <span className="ml-2 font-normal text-muted">{subject}</span>
          </h2>
          {onDelete ? (
            <Button size="sm" variant="ghost" className="ml-auto shrink-0" onClick={onDelete}>
              <Trash2 aria-hidden className="size-3.5" strokeWidth={1.5} />
              删除
            </Button>
          ) : null}
        </div>
        <p className="font-mono text-xs text-muted tabular-nums">{headline}</p>
      </header>

      {pointEvent ? (
        <NoticeBody incident={incident} />
      ) : app ? (
        <AppReadout incident={incident} />
      ) : (
        <ResourceReadout incident={incident} />
      )}

      {pointEvent ? null : <Timeline incident={incident} app={app} />}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">送达</h3>
        {incident.channels.length ? (
          <div className="flex flex-wrap gap-2">
            {CHANNEL_ORDER.filter((c) => incident.channels.includes(c)).map((c) => (
              <Tag key={c}>{CHANNEL_LABEL[c]}</Tag>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">没有记录送达渠道</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">近 7 天同类</h3>
        <p className="text-sm text-ink">
          {incident.host} 的{subject}
          {app ? "探活异常" : "告警"}共 {recent.length} 次
          {peakHour !== null ? `，多在 ${String(peakHour).padStart(2, "0")} 点前后触发，可能是定时任务` : ""}
        </p>
        {others.length ? (
          <ul className="mt-2 flex flex-col">
            {others.map((inc) => (
              <li key={inc.id}>
                <button
                  type="button"
                  onClick={() => onSelect(inc.id)}
                  className="motion-colors flex h-8 w-full items-center gap-3 rounded-control px-2 text-left text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent-focus"
                >
                  <StatusLed inc={inc} />
                  <span className="w-36 font-mono text-xs text-muted tabular-nums">
                    {formatDateTime(inc.startAt).slice(5)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{recentSummary(inc)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {incident.host && incident.host !== "菜单检查" &&
      incident.host !== "巡检" &&
      incident.host !== "本机" ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onOpenHost(incident.host)}>
            <Activity size={16} strokeWidth={1.5} aria-hidden />
            打开主机监控
          </Button>
          <Button variant="ghost" onClick={onOpenSubs}>
            <BellRing size={16} strokeWidth={1.5} aria-hidden />
            调整订阅
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function recentSummary(inc: Incident): string {
  if (isAppKind(inc.kind)) {
    const reason = inc.down?.value || "";
    const dur = inc.endAt ? `，${formatDuration(inc.endAt - inc.startAt)}后恢复` : "";
    return `${reason || statusLabel(inc)}${dur}`;
  }
  const peak = inc.up?.peak || inc.down?.value || "";
  const dur = inc.endAt ? `，持续 ${formatDuration(inc.endAt - inc.startAt)}` : `，${statusLabel(inc)}`;
  return `${peak ? `峰值 ${peak}` : statusLabel(inc)}${dur}`;
}

/** 唯一的「大数字」：峰值（未回落时为触发值）+ LED 分段条 */
function ResourceReadout({ incident }: { incident: Incident }) {
  const peak = incident.up?.peak || incident.escalation?.value || incident.down?.value || "";
  const label = incident.up?.peak ? "峰值" : "触发值";
  const threshold =
    incident.escalation?.threshold || incident.down?.threshold || incident.up?.threshold || "";
  const percent = usagePercent(incident.kind, peak);
  const danger = percent !== undefined && usageTone(percent) === "danger";
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={cn(
          "font-mono text-2xl font-semibold leading-8 tabular-nums",
          danger ? "text-danger" : "text-ink",
        )}
      >
        {peak || "—"}
      </span>
      <div className="flex items-center gap-4">
        {percent !== undefined ? (
          <Meter value={percent} showValue={false} className="w-56" />
        ) : null}
        {threshold ? (
          <span className="text-xs text-muted">
            阈值 <span className="font-mono tabular-nums text-ink">{threshold}</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}

function AppReadout({ incident }: { incident: Incident }) {
  const reason = incident.down?.value || incident.down?.detail || "";
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs text-muted">异常原因</span>
      <span className="text-xl font-semibold leading-7 text-ink">{reason || "探活异常"}</span>
      <span className="text-xs text-muted">进程、健康检查、入口任一失败即判定为异常</span>
    </section>
  );
}

function NoticeBody({ incident }: { incident: Incident }) {
  const ev = incident.down || incident.up;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">{ev?.title || "—"}</p>
      <p className="whitespace-pre-line text-sm leading-6 text-ink">{ev?.detail || ev?.value || ""}</p>
    </section>
  );
}

type StepTone = "danger" | "warn" | "ok" | "idle";

function firstStepLabel(incident: Incident, app: boolean): string {
  if (app) return "探活异常";
  const level = incident.down?.level;
  if (level === "warn" || level === "danger") return `进入${LEVEL_LABEL[level]}档`;
  return "超阈值";
}

type Step = { ev?: AlertEvent; label: string; valueLabel: string; tone: StepTone };

const MAX_REPEAT_STEPS = 3;

/** 首发与回落之间：升级节点 + 重复提醒（只列最近 3 次，更早的合并成一行） */
function middleSteps(incident: Incident): Step[] {
  const kept = incident.repeats.slice(-MAX_REPEAT_STEPS);
  const hidden = incident.repeats.length - kept.length;
  const events = [...kept];
  if (incident.escalation) events.push(incident.escalation);
  events.sort((a, b) => (a.at || 0) - (b.at || 0));
  const out: Step[] = [];
  let summarized = hidden === 0;
  for (const ev of events) {
    if (ev === incident.escalation) {
      out.push({ ev, label: "升到危险档", valueLabel: "当前值", tone: "danger" });
      continue;
    }
    if (!summarized) {
      out.push({ label: `另提醒 ${hidden} 次`, valueLabel: "", tone: "idle" });
      summarized = true;
    }
    out.push({ ev, label: "重复提醒", valueLabel: "当前值", tone: ev.level === "warn" ? "warn" : "danger" });
  }
  return out;
}

function Timeline({ incident, app }: { incident: Incident; app: boolean }) {
  const steps: Step[] = [
    {
      ev: incident.down,
      label: firstStepLabel(incident, app),
      valueLabel: app ? "原因" : "当前值",
      tone: incident.down?.level === "warn" ? "warn" : "danger",
    },
  ];
  steps.push(...middleSteps(incident));
  if (incident.up) {
    steps.push({ ev: incident.up, label: app ? "已恢复" : "已回落", valueLabel: app ? "" : "回落值", tone: "ok" });
  } else {
    steps.push({
      label: incident.status === "active" ? "等待回落" : "没有回落记录",
      valueLabel: "",
      tone: "idle",
    });
  }
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">经过</h3>
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <div className="flex w-2 flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "mt-2 inline-block size-2 shrink-0 rounded-tag",
                  step.tone === "danger" && "bg-danger",
                  step.tone === "warn" && "bg-warn",
                  step.tone === "ok" && "bg-success",
                  step.tone === "idle" && "border border-line-strong",
                )}
              />
              {index < steps.length - 1 ? <span aria-hidden className="w-px flex-1 bg-line" /> : null}
            </div>
            <div className="flex min-h-10 flex-1 items-baseline gap-3 pb-2 text-sm leading-6">
              <span className="w-16 font-mono text-xs text-muted tabular-nums">
                {step.ev ? formatClock(step.ev.at, true) : "—"}
              </span>
              <span className={cn("w-20", step.tone === "idle" ? "text-muted" : "text-ink")}>{step.label}</span>
              {step.ev && step.valueLabel && step.ev.value && !(app && step.tone === "ok") ? (
                <span className="text-muted">
                  {step.valueLabel}{" "}
                  <span className="font-mono tabular-nums text-ink">{step.ev.value}</span>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
