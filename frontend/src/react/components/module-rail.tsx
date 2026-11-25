/**
 * ModuleRail — 一级图标栏（docs/design/specification.md §4.1 / §8.2）：72px 通顶，图标 + 下方小字，设置置底。
 */

import { Events } from "@wailsio/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  FileCog,
  Gauge,
  Laptop,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import appMenuLogoUrl from "@/assets/1panel-menu-logo.svg";
import { Tag } from "@/react/components/ui/tag";
import { detectAppOs } from "@/react/lib/platform";
import { panelConfigNeedsAttention, panelConfigOverviewQuery } from "@/react/lib/panel-config-overview";
import { useSession } from "@/react/state/session";
import { useNotificationHistory } from "@/react/lib/use-notification-history";

type ModuleIcon = {
  outline: LucideIcon;
  filledPath: string;
};

const MODULE_ICONS = {
  remote: {
    outline: Server,
    filledPath: `M4 1.5h16A2.5 2.5 0 0 1 22.5 4v4a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 8V4A2.5 2.5 0 0 1 4 1.5Z
      M4 13.5h16a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 20v-4A2.5 2.5 0 0 1 4 13.5Z
      M5 6a1.1 1.1 0 1 0 2.2 0A1.1 1.1 0 0 0 5 6Z
      M5 18a1.1 1.1 0 1 0 2.2 0A1.1 1.1 0 0 0 5 18Z`,
  },
  local: {
    outline: Laptop,
    filledPath: `M6 4.5h12A2.5 2.5 0 0 1 20.5 7v8.5l1.6 3.2a1.5 1.5 0 0 1-1.34 2.17H3.24A1.5 1.5 0 0 1 1.9 18.7l1.6-3.2V7A2.5 2.5 0 0 1 6 4.5Z
      M6 15a.75.75 0 0 0 0 1.5h12a.75.75 0 0 0 0-1.5Z`,
  },
  config: {
    outline: FileCog,
    filledPath: `M6.5 1.5h7.75L21 8.25V20a2.5 2.5 0 0 1-2.5 2.5h-7.1A6.5 6.5 0 0 0 4 12.5V4a2.5 2.5 0 0 1 2.5-2.5Z
      M14.5 3.8v3.8a.9.9 0 0 0 .9.9h3.8Z
      M5.5 14h2l.33 1.45.65.38 1.42-.45 1 1.74-1.08 1v.75l1.08 1-1 1.74-1.42-.45-.65.38L7.5 23h-2l-.33-1.46-.65-.38-1.42.45-1-1.74 1.08-1v-.75l-1.08-1 1-1.74 1.42.45.65-.38Z
      M5 18.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z`,
  },
  notify: {
    outline: Bell,
    filledPath: `M12 1.5a6.75 6.75 0 0 1 6.75 6.75c0 4.05 1.24 5.47 2.5 6.8a1.6 1.6 0 0 1-1.16 2.7H3.91a1.6 1.6 0 0 1-1.16-2.7c1.26-1.33 2.5-2.75 2.5-6.8A6.75 6.75 0 0 1 12 1.5Z
      M9.3 19.5a2.7 2.7 0 0 0 5.4 0Z`,
  },
  speedtest: {
    outline: Gauge,
    filledPath: `M3.34 19a10 10 0 1 1 17.32 0c-.31.54-.88 1-1.5 1H4.84c-.62 0-1.19-.46-1.5-1Z
      M10.9 12.9a1.56 1.56 0 1 0 2.2 2.2l4.4-5.4a.85.85 0 0 0-1.2-1.2Z`,
  },
  settings: {
    outline: Settings,
    filledPath: `M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915Z
      M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0Z`,
  },
} satisfies Record<string, ModuleIcon>;

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function ModuleRail() {
  const session = useSession();
  const isMac = detectAppOs() === "mac";
  const { unread: unreadBySource } = useNotificationHistory(true);
  const unread = unreadBySource.metric + unreadBySource.app + unreadBySource.cert;
  const queryClient = useQueryClient();
  const overview = useQuery({ ...panelConfigOverviewQuery, refetchInterval: 15000 });
  const configNeedsAttention = overview.isError || panelConfigNeedsAttention(overview.data);

  useEffect(() => {
    function refresh() {
      for (const queryKey of [panelConfigOverviewQuery.queryKey, ["config-files"], ["config-readonly-state"]]) {
        void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
      }
    }
    const offs = [
      Events.On("panel-config-imported", refresh),
      Events.On("panel-config-needs-review", refresh),
      Events.On("panel-config-import-error", refresh),
    ];
    return () => offs.forEach((off) => off());
  }, [queryClient]);

  const open = !session.settingsOpen;
  const ws = session.workspace;

  return (
    <aside className="module-rail flex h-full shrink-0 flex-col items-center" aria-label="一级功能">
      {/* 顶部 40px 是窗口拖拽区：Mac 放系统红绿灯，Win/Linux 放应用图标 */}
      <div className="module-rail-drag drag-region flex h-10 w-full shrink-0 items-center justify-center">
        {isMac ? null : (
          <img
            src={appMenuLogoUrl}
            alt=""
            width={18}
            height={18}
            draggable={false}
            className="size-[18px] select-none"
            aria-hidden="true"
          />
        )}
      </div>
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 pb-2" aria-label="切换模块">
        <RailModule icon={MODULE_ICONS.remote} label="主机" active={open && ws === "remote"} onClick={() => session.goHome()} />
        <RailModule icon={MODULE_ICONS.local} label="本机" active={open && ws === "local"} onClick={() => session.setWorkspace("local")} />
        <RailModule
          icon={MODULE_ICONS.config}
          label="配置"
          active={open && ws === "config"}
          statusDot={configNeedsAttention}
          onClick={() => session.setWorkspace("config")}
        />
        <RailModule
          icon={MODULE_ICONS.notify}
          label="通知"
          active={open && ws === "notify"}
          badge={unread > 0 ? formatCount(unread) : null}
          onClick={() => session.setWorkspace("notify")}
        />
        <RailModule icon={MODULE_ICONS.speedtest} label="测速" active={open && ws === "speedtest"} onClick={() => session.setWorkspace("speedtest")} />
        <div className="flex-1" />
        <RailModule icon={MODULE_ICONS.settings} label="设置" active={session.settingsOpen} onClick={() => session.openSettings(true)} />
      </nav>
    </aside>
  );
}

function RailModule({
  icon: { outline: OutlineIcon, filledPath },
  label,
  active,
  badge,
  statusDot,
  onClick,
}: {
  icon: ModuleIcon;
  label: string;
  active: boolean;
  badge?: string | null;
  statusDot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className="module-rail-item shrink-0"
      onClick={onClick}
    >
      {active ? (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d={filledPath} />
        </svg>
      ) : (
        <OutlineIcon size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
      <span className="max-w-full truncate px-1">{label}</span>
      {badge ? (
        <Tag tone="accent" className="module-rail-badge absolute h-4 px-1 font-mono tabular-nums">
          {badge}
        </Tag>
      ) : null}
      {statusDot ? (
        <span className="module-rail-dot absolute h-1.5 w-1.5 rounded-full bg-danger" />
      ) : null}
    </button>
  );
}
