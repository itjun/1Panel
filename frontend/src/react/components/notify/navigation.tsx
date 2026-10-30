import {
  Blocks,
  BookKey,
  Server,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { NOTIFY_SOURCE, type NotifySource } from "@/react/lib/notify-model";
import { useNotificationHistory } from "@/react/lib/use-notification-history";
import { cn } from "@/react/lib/utils";
import { useSession, type NotifySection } from "@/react/state/session";
import {
  CHANNEL_SECTIONS,
  requestChannelSection,
  useChannelReadingSection,
} from "@/react/state/notify-channels-navigation";

const groups: { source: NotifySource; icon: LucideIcon }[] = [
  { source: "metric", icon: Server },
  { source: "app", icon: Blocks },
  { source: "cert", icon: BookKey },
];

export function NotifyNavigation() {
  const session = useSession();
  const { unread } = useNotificationHistory();
  const channelSection = useChannelReadingSection();
  function entry(section: NotifySection, label: string, count?: number) {
    const active = session.notifySection === section;
    return (
      <button
        key={section}
        type="button"
        className={cn(
          "notify-nav-entry motion-colors",
          active && "rail-item-active",
        )}
        aria-current={active ? "page" : undefined}
        aria-label={`${NOTIFY_SOURCE[section.startsWith("app") ? "app" : section.startsWith("cert") ? "cert" : "metric"].label} · ${label}`}
        onClick={() => session.setNotifySection(section)}
      >
        <span>{label}</span>
        {count !== undefined && count > 0 ? (
          <span className={cn("notify-nav-count", count > 0 && "text-accent")}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <nav className="notify-navigation" aria-label="通知中心">
      {groups.map(({ source, icon: Icon }) => {
        const info = NOTIFY_SOURCE[source];
        return (
          <section key={source} aria-label={info.label}>
            <h3>
              <Icon size={20} strokeWidth={1.5} aria-hidden />
              {info.label}
            </h3>
            {entry(info.messages, "消息记录", unread[source])}
            {source !== "cert"
              ? entry(info.subscriptions, info.subscriptionLabel)
              : null}
            {entry(info.rules, source === "cert" ? "提醒规则" : "告警规则")}
          </section>
        );
      })}
      <button
        type="button"
        className={cn(
          "notify-channel-entry motion-colors",
          session.notifySection === "setup" && "rail-item-active",
        )}
        aria-current={session.notifySection === "setup" ? "page" : undefined}
        onClick={() => {
          session.setNotifySection("setup");
          requestChannelSection("channels");
        }}
      >
        <span>
          <SlidersHorizontal size={20} strokeWidth={1.5} aria-hidden />
          发送渠道
        </span>
      </button>
      {session.notifySection === "setup" ? (
        <div className="notify-channel-navigation" role="group" aria-label="发送渠道目录">
          {CHANNEL_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={channelSection === item.id || (item.id === "preview" && channelSection.startsWith("preview-")) ? "location" : undefined}
              aria-controls={`notify-channel-${item.id}`}
              onClick={() => requestChannelSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
